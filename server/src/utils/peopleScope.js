import User from '../models/User.js';
import TimetableSlot from '../models/TimetableSlot.js';
import { ApiError } from './http.js';
import { STUDENT_ROLES, facultyClasses, inClasses, ownDepartment, studentsInClassesFilter } from './academicScope.js';
import { COLLEGE_WIDE_ROLES } from '../constants.js';
import { canContact } from './chatScope.js';

/**
 * A student's own class — department + year + section + semester — read from
 * their account, never the request. Null when the placement is incomplete.
 */
export function studentClass(user) {
  const section = String(user?.section || '').trim().toUpperCase();
  if (!user?.department || !section || !user.year) return null;
  return { department: user.department, year: Number(user.year), section, semester: user.semester ? Number(user.semester) : null };
}

/**
 * The faculty of a student's class: everyone the active timetable has teaching
 * that exact class, plus its Class In-Charge.
 */
export async function classFacultyIds(cls) {
  if (!cls) return [];
  const slot = { department: cls.department, year: cls.year, section: cls.section, isActive: true, isBreak: { $ne: true } };
  if (cls.semester) slot.semester = cls.semester;
  const [teaching, inCharge] = await Promise.all([
    TimetableSlot.distinct('faculty', slot),
    User.find({
      role: 'faculty',
      department: cls.department,
      section: cls.section,
      inChargeYear: cls.year,
      ...(cls.semester ? { inChargeSemester: cls.semester } : {}),
    }).distinct('_id'),
  ]);
  return [...teaching, ...inCharge];
}

/**
 * Students see a class directory: their own classmates (exact department,
 * year, section and semester) and the faculty of that class. Nothing else —
 * no other class, department or staff role.
 */
async function studentDirectoryFilter(user) {
  const cls = studentClass(user);
  if (!cls) return { _id: null };
  const classmates = {
    role: { $in: STUDENT_ROLES },
    department: cls.department,
    year: cls.year,
    section: cls.section,
    _id: { $ne: user._id },
    ...(cls.semester ? { semester: { $in: [cls.semester, null] } } : {}),
  };
  const faculty = await classFacultyIds(cls);
  return { $or: faculty.length ? [classmates, { _id: { $in: faculty }, role: 'faculty' }] : [classmates] };
}

/**
 * The Mongo filter a role's People-directory queries must be scoped to.
 * Throws ApiError(403) for roles with no directory access at all.
 *
 * Access is granted by an explicit list, never by "not one of the scoped
 * roles": students (their own class), faculty (their classes), HOD (their
 * department) and the college-wide authorities (COLLEGE_WIDE_ROLES).
 * Security and Warden are deliberately not on it — they have no academic
 * scope, so a catch-all would have handed them the whole college.
 */
export async function peopleScopeFilter(user) {
  if (STUDENT_ROLES.includes(user.role)) return studentDirectoryFilter(user);
  if (user.role === 'faculty') {
    // A faculty account's People list is a class roster: only students of the
    // exact classes (department + year + section + semester) they teach.
    return studentsInClassesFilter(await facultyClasses(user));
  }
  if (user.role === 'hod') {
    return { department: ownDepartment(user) };
  }
  // Admin, Principal, Chairman, Dean and AO: college-wide, read-only.
  if (COLLEGE_WIDE_ROLES.includes(user.role)) {
    return {};
  }
  throw new ApiError(403, 'Your role is not authorized to browse the People directory');
}

/** Field-level check for a single profile fetch (GET /users/:id). */
export async function canViewProfile(viewer, targetId) {
  if (String(viewer._id) === String(targetId)) return true;
  if (COLLEGE_WIDE_ROLES.includes(viewer.role)) return true; // college-wide authorities: unrestricted
  // Students: only the people they may chat with — their own classmates and
  // the academic staff. Another class's student profile is not visible.
  if (STUDENT_ROLES.includes(viewer.role)) {
    if (!(await User.exists({ _id: targetId }))) return true; // missing user — let the 404 in getUser handle it
    return canContact(viewer, targetId);
  }

  if (!['faculty', 'hod'].includes(viewer.role)) return false; // security / warden: no academic profiles

  const target = await User.findById(targetId).select('role department section year semester').lean();
  if (!target) return true; // missing user — let the 404 in getUser handle it

  if (viewer.role === 'hod') return target.department === viewer.department;

  // Faculty: unrestricted for other staff profiles (existing allowed scope);
  // student profiles are scoped to the classes they teach.
  if (!STUDENT_ROLES.includes(target.role)) return true;
  return inClasses(await facultyClasses(viewer), target);
}
