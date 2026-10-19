import FacultyAttendance from '../models/FacultyAttendance.js';
import { sameId } from '../utils/permissions.js';
import { toDay } from '../utils/dates.js';
import { clock } from '../utils/clock.js';

// Staff whose daily attendance is tracked (same set as staffAttendanceController).
const TRACKED_STAFF = ['faculty', 'hod'];

/**
 * Taking attendance in your own class proves you are on campus: the first
 * time a faculty member (or an HOD teaching their own period) marks a class
 * today, they are recorded present for the whole day.
 *
 * Only for the slot's own scheduled faculty, only for today on the server
 * clock — an admin's correction, an HOD editing someone else's class, or a
 * back-dated mark never marks anyone present.
 *
 * Insert-only: a status the HOD or an admin already recorded (present,
 * absent or leave) is never overwritten, and later periods change nothing.
 *
 * Returns true when this call created the day's record.
 */
export async function markPresentFromClass(user, { slot, session, cover, subject, day, section, period }) {
  if (!user || !TRACKED_STAFF.includes(user.role)) return false;
  // The scheduled faculty member, or the substitute assigned to this period —
  // whoever actually did the work is the one recorded present.
  const isSubstitute = cover?.kind === 'substitute' && sameId(cover.substitute, user);
  if (!slot || !(sameId(slot.faculty, user) || isSubstitute)) return false;
  if (day.getTime() !== toDay(clock.now()).getTime()) return false;

  const now = clock.now();
  try {
    const res = await FacultyAttendance.updateOne(
      { faculty: user._id, date: day },
      {
        $setOnInsert: {
          faculty: user._id,
          date: day,
          status: 'present',
          source: 'auto',
          markedBy: user._id,
          markedAt: now,
          ...(user.department ? { department: user.department } : {}),
          autoFrom: {
            period: session?.period ?? period ?? slot.period,
            subjectCode: subject?.code,
            department: session?.department || slot.department,
            section: section || slot.section,
            at: now,
            ...(isSubstitute ? { substituteFor: slot.faculty } : {}),
          },
        },
      },
      { upsert: true }
    );
    return res.upsertedCount > 0;
  } catch (err) {
    // Two periods saved at the same instant: the other request created it.
    if (err.code === 11000) return false;
    throw err;
  }
}
