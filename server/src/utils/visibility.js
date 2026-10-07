import Club from '../models/Club.js';
import User from '../models/User.js';
import { ANNOUNCEMENT_READ_ALL_ROLES, FIRST_YEAR_HOD_DEPT, isFirstYearHod } from '../constants.js';

const STUDENT_ROLES = ['student', 'club_admin'];
const DEPARTMENT_STAFF_ROLES = ['faculty', 'hod'];
// An audience with no department reaches every department ("All departments").
const ANY_DEPARTMENT = [null, ''];

/**
 * Mongo filter for announcements a user may see. Everything is derived from the
 * authenticated account — never from client input:
 *  - all        → everyone on campus
 *  - department → that department's students and staff
 *  - year       → students of that year (in that department, or every department),
 *                 plus that department's faculty / HOD
 *  - section    → students of that department + year + section, plus that
 *                 department's faculty / HOD
 *  - club       → club members
 * Admin and the college-wide roles (Principal, Chairman, Dean, AO) read them all.
 */
export function announcementVisibility(user) {
  if (ANNOUNCEMENT_READ_ALL_ROLES.includes(user.role)) return {};
  const or = [
    { 'audience.scope': 'all' },
    { author: user._id },
    { 'audience.scope': 'club', 'audience.club': { $in: user.clubs || [] } },
  ];
  const dept = user.department || undefined;
  if (dept) or.push({ 'audience.scope': 'department', 'audience.department': dept });

  if (STUDENT_ROLES.includes(user.role) && user.year) {
    const deptMatch = dept ? [dept, ...ANY_DEPARTMENT] : ANY_DEPARTMENT;
    or.push({ 'audience.scope': 'year', 'audience.year': user.year, 'audience.department': { $in: deptMatch } });
    if (dept && user.section) {
      or.push({
        'audience.scope': 'section',
        'audience.department': dept,
        'audience.year': user.year,
        'audience.section': user.section,
      });
    }
  } else if (DEPARTMENT_STAFF_ROLES.includes(user.role) && dept) {
    or.push({ 'audience.scope': { $in: ['year', 'section'] }, 'audience.department': dept });
    // The Science & Humanities HOD runs 1st year across every department.
    if (isFirstYearHod(user)) or.push({ 'audience.scope': { $in: ['year', 'section'] }, 'audience.year': 1 });
  }
  return { $or: or };
}

/** User filter for the people an audience reaches — the mirror of announcementVisibility. */
function audienceUserFilter(audience) {
  const base = { isActive: true };
  const { department, year, section } = audience;
  switch (audience.scope) {
    case 'department':
      return { ...base, department };
    case 'year':
    case 'section': {
      const students = { role: { $in: STUDENT_ROLES }, year };
      if (department) students.department = department;
      if (audience.scope === 'section') students.section = section;
      const or = [students];
      if (department) or.push({ role: { $in: DEPARTMENT_STAFF_ROLES }, department });
      if (year === 1) or.push({ role: 'hod', department: FIRST_YEAR_HOD_DEPT });
      return { ...base, $or: or };
    }
    default:
      return base;
  }
}

/** Resolve the user ids that belong to an announcement audience. */
export async function audienceUserIds(audience = {}) {
  if (audience.scope === 'club') {
    const club = await Club.findById(audience.club).select('members admins').lean();
    return club ? [...club.members, ...club.admins] : [];
  }
  return User.find(audienceUserFilter(audience)).distinct('_id');
}
