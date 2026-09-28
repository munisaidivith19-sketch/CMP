import TimetableSlot from '../models/TimetableSlot.js';
import { ApiError } from './http.js';

/**
 * A faculty member's real teaching assignments right now, deduped by
 * class (department + section + semester + subject). This — not role alone —
 * is what authorizes uploading/editing/deleting a study material, and it's
 * also what the "Teaching Assignment" picker in the upload form is built from.
 */
export async function facultyAssignments(userId) {
  const slots = await TimetableSlot.find({ faculty: userId, isActive: true, isBreak: { $ne: true } })
    .populate('subject', 'name code semester year')
    .select('department section semester year subject')
    .lean();
  const seen = new Map();
  slots.forEach((s) => {
    if (!s.subject) return;
    const key = `${s.department}|${s.section}|${s.semester}|${s.subject._id}`;
    if (!seen.has(key)) {
      seen.set(key, {
        department: s.department,
        section: s.section,
        semester: s.semester,
        year: s.year,
        subject: { _id: s.subject._id, name: s.subject.name, code: s.subject.code },
      });
    }
  });
  return [...seen.values()];
}

export const STUDY_MATERIAL_STUDENT_ROLES = ['student', 'club_admin'];

/**
 * Mongo filter for the study materials `user` may READ, derived only from the
 * authenticated account — never from client-supplied department/section/etc.
 * Students see their own class (department + semester, and their section or
 * section-less uploads); staff roles allowed into the module see all active
 * materials. Shared by the list/detail endpoints and Study Assistant retrieval
 * so all three always agree on what a user can see.
 */
export function materialReadFilter(user) {
  const filter = { isActive: true };
  if (STUDY_MATERIAL_STUDENT_ROLES.includes(user.role)) {
    filter.department = user.department || '__none__';
    // Year is always pinned, so a student with no semester on file still never sees another year's material.
    filter.year = user.year || -1;
    if (user.semester) filter.semester = user.semester;
    if (user.section) filter.$or = [{ section: user.section }, { section: '' }, { section: null }];
  }
  return filter;
}

/** Throws unless the faculty member is currently assigned to teach exactly this class. */
export async function assertFacultyAssignment(userId, { department, section, semester, subjectId }) {
  const ok = await TimetableSlot.exists({
    faculty: userId,
    department,
    section: section || { $in: ['', null] },
    semester,
    subject: subjectId,
    isActive: true,
  });
  if (!ok) throw new ApiError(403, 'You are not assigned to this subject/class');
}

/**
 * Whether `user` may upload/edit/delete a material with this academic scope
 * (an existing StudyMaterial doc, or the scope about to be saved). Always
 * follows the *current* assignment — never who originally uploaded a file.
 */
export async function canManageStudyMaterial(user, { department, section, semester, subject }) {
  if (user.role === 'admin') return true;
  if (user.role === 'hod') return department === user.department;
  if (user.role === 'faculty') {
    return Boolean(
      await TimetableSlot.exists({
        faculty: user._id,
        department,
        section: section || { $in: ['', null] },
        semester,
        subject,
        isActive: true,
      })
    );
  }
  return false;
}
