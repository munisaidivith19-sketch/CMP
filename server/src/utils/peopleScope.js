import User from '../models/User.js';
import TimetableSlot from '../models/TimetableSlot.js';
import { ApiError } from './http.js';

// Students (and club admins, who are students too) have no People-directory
// access at all — see peopleScopeFilter and canViewProfile below.
const NO_DIRECTORY_ROLES = ['student', 'club_admin'];

/**
 * The exact (section, year) pairs a faculty member is actually assigned to
 * teach, derived from real teaching data rather than assumed from the section
 * letter alone — the same section letter (e.g. "C") is commonly reused across
 * different years, so section alone is not a precise scope.
 *
 * Primary source: the timetable, which links this faculty to a concrete
 * department + section + year per class. Falls back to their class-in-charge
 * section (User.section) when no timetable row exists yet for it — narrowed
 * to a year only if that department+section maps to exactly one year
 * college-wide (otherwise left year-unconstrained rather than guessing).
 */
async function facultyScope(user) {
  const taught = await TimetableSlot.find({ faculty: user._id, department: user.department, isActive: true })
    .select('section year')
    .lean();
  const pairs = new Map();
  taught.forEach((t) => pairs.set(`${t.section}|${t.year ?? ''}`, { section: t.section, year: t.year }));

  if (user.section && ![...pairs.values()].some((p) => p.section === user.section)) {
    const years = await TimetableSlot.find({ department: user.department, section: user.section, isActive: true }).distinct('year');
    if (years.length === 1) pairs.set(`${user.section}|${years[0]}`, { section: user.section, year: years[0] });
    else pairs.set(`${user.section}|`, { section: user.section, year: undefined });
  }
  return [...pairs.values()];
}

const matchesFacultyScope = (pairs, target) =>
  pairs.some((p) => p.section === target.section && (p.year === undefined || p.year === target.year));

/**
 * The Mongo filter a role's People-directory queries must be scoped to.
 * Throws ApiError(403) for roles with no directory access at all (students).
 */
export async function peopleScopeFilter(user) {
  if (NO_DIRECTORY_ROLES.includes(user.role)) {
    throw new ApiError(403, 'Students are not authorized to browse the People directory');
  }
  if (user.role === 'faculty') {
    // A faculty account's People list is a class roster: only students in
    // their assigned section(s)/year — no other faculty at all.
    const pairs = await facultyScope(user);
    if (!pairs.length) return { _id: null };
    return {
      role: { $in: NO_DIRECTORY_ROLES },
      department: user.department,
      $or: pairs.map((p) => (p.year !== undefined ? { section: p.section, year: p.year } : { section: p.section })),
    };
  }
  if (user.role === 'hod') {
    return { department: user.department };
  }
  // Principal, admin and other college-wide authorities: unrestricted (existing behaviour).
  return {};
}

/** Field-level check for a single profile fetch (GET /users/:id). */
export async function canViewProfile(viewer, targetId) {
  if (String(viewer._id) === String(targetId)) return true;
  if (NO_DIRECTORY_ROLES.includes(viewer.role)) return true; // students: directory browsing is blocked, single lookups are not
  if (!['faculty', 'hod'].includes(viewer.role)) return true; // principal/admin/etc: unrestricted

  const target = await User.findById(targetId).select('role department section year').lean();
  if (!target) return true; // missing user — let the 404 in getUser handle it

  if (viewer.role === 'hod') return target.department === viewer.department;

  // Faculty: unrestricted for other staff profiles (existing allowed scope);
  // student profiles are scoped to the assigned section + year.
  if (!NO_DIRECTORY_ROLES.includes(target.role)) return true;
  if (target.department !== viewer.department) return false;
  const pairs = await facultyScope(viewer);
  return matchesFacultyScope(pairs, target);
}
