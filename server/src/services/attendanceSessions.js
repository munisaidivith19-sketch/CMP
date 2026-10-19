import AttendanceSession from '../models/AttendanceSession.js';
import User from '../models/User.js';
import { yearOfSemester } from '../constants.js';

/**
 * Freeze a timetable entry as it is now, for one class meeting (`day`). An
 * existing session wins; a concurrent creator losing the unique-index race
 * reads the winner's. Used by regular marking and by the exam auto-marking,
 * so both snapshot a period the same way.
 *
 * `subject` must carry `_id`, `name` and `code`.
 */
export async function ensureSession({ slot, session, subject, day }, user) {
  if (session || !slot) return session;
  const faculty = slot.faculty ? await User.findById(slot.faculty).select('name').lean() : null;
  try {
    return (
      await AttendanceSession.create({
        timetableSlot: slot._id,
        date: day,
        period: slot.period,
        startTime: slot.startTime,
        endTime: slot.endTime,
        subject: subject._id,
        subjectName: subject.name,
        subjectCode: subject.code,
        faculty: slot.faculty,
        facultyName: faculty?.name,
        department: slot.department,
        section: slot.section,
        semester: slot.semester,
        year: slot.year ?? yearOfSemester(slot.semester),
        room: slot.room,
        createdBy: user._id,
      })
    ).toObject();
  } catch (err) {
    if (err.code === 11000) return AttendanceSession.findOne({ timetableSlot: slot._id, date: day }).lean();
    throw err;
  }
}
