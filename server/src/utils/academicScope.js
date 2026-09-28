import TimetableSlot from '../models/TimetableSlot.js';
import { yearOfSemester } from '../constants.js';

export const STUDENT_ROLES = ['student', 'club_admin'];

const norm = (s) => String(s || '').trim().toUpperCase();
const key = (c) => `${c.department}|${c.year ?? ''}|${c.section}|${c.semester ?? ''}`;

/**
 * The classes (department + year + section + semester) a faculty member
 * actually teaches, read from the timetable — the single source of truth for
 * faculty academic scope across People, Chat, Attendance and Study Materials.
 *
 * Their class-in-charge section (User.section) is added when no timetable row
 * covers it yet. Its year comes from the declared teaching years, or from the
 * one year that section exists in college-wide; otherwise it stays
 * year-unconstrained rather than guessing.
 */
export async function facultyClasses(user) {
  const slots = await TimetableSlot.find({ faculty: user._id, isActive: true, isBreak: { $ne: true } })
    .select('department section year semester')
    .lean();
  const classes = new Map();
  const add = (c) => classes.set(key(c), c);
  slots.forEach((s) =>
    add({ department: s.department, section: norm(s.section), year: s.year ?? yearOfSemester(s.semester), semester: s.semester })
  );

  const section = norm(user.section);
  if (section && user.department && ![...classes.values()].some((c) => c.department === user.department && c.section === section)) {
    const declared = user.teachingYears?.length ? user.teachingYears : null;
    const years = declared || (await TimetableSlot.find({ department: user.department, section, isActive: true }).distinct('year'));
    if (declared || years.length === 1) years.forEach((year) => add({ department: user.department, section, year }));
    else add({ department: user.department, section });
  }
  return [...classes.values()];
}

/**
 * Whether a student belongs to one of `classes`. Year must match exactly, so
 * "3rd Year Section A" never matches "2nd Year Section A". A student with no
 * semester on file (legacy data, flagged by the migration) matches on year.
 */
export const inClasses = (classes, student) =>
  classes.some(
    (c) =>
      c.department === student.department &&
      c.section === norm(student.section) &&
      (c.year === undefined || c.year === student.year) &&
      (c.semester === undefined || student.semester == null || c.semester === student.semester)
  );

/** Mongo filter matching the students of any of `classes` (same rules as inClasses). */
export function studentsInClassesFilter(classes) {
  if (!classes.length) return { _id: null };
  return {
    role: { $in: STUDENT_ROLES },
    $or: classes.map((c) => ({
      department: c.department,
      section: c.section,
      ...(c.year !== undefined ? { year: c.year } : {}),
      ...(c.semester !== undefined ? { semester: { $in: [c.semester, null] } } : {}),
    })),
  };
}
