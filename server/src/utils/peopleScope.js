import User from '../models/User.js';
import { ApiError } from './http.js';
import { STUDENT_ROLES, facultyClasses, inClasses, studentsInClassesFilter } from './academicScope.js';

// Students (and club admins, who are students too) have no People-directory
// access at all — see peopleScopeFilter and canViewProfile below.
const NO_DIRECTORY_ROLES = STUDENT_ROLES;

/**
 * The Mongo filter a role's People-directory queries must be scoped to.
 * Throws ApiError(403) for roles with no directory access at all (students).
 */
export async function peopleScopeFilter(user) {
  if (NO_DIRECTORY_ROLES.includes(user.role)) {
    throw new ApiError(403, 'Students are not authorized to browse the People directory');
  }
  if (user.role === 'faculty') {
    // A faculty account's People list is a class roster: only students of the
    // exact classes (department + year + section + semester) they teach.
    return studentsInClassesFilter(await facultyClasses(user));
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

  const target = await User.findById(targetId).select('role department section year semester').lean();
  if (!target) return true; // missing user — let the 404 in getUser handle it

  if (viewer.role === 'hod') return target.department === viewer.department;

  // Faculty: unrestricted for other staff profiles (existing allowed scope);
  // student profiles are scoped to the classes they teach.
  if (!NO_DIRECTORY_ROLES.includes(target.role)) return true;
  return inClasses(await facultyClasses(viewer), target);
}
