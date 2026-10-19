/**
 * Live attendance updates. Whenever a class's attendance is written, every
 * screen that shows it is told to refresh at once (web and Android re-read
 * over REST, which applies each viewer's own permissions):
 *
 *   - the person who wrote it, on every device they are signed in on;
 *   - the class's Class In-Charge ("Our Class");
 *   - the HOD of the department (and the Science & Humanities HOD for 1st year);
 *   - the campus-wide readers (principal, chairman, dean, AO, admin, COE).
 *
 * Students whose own marks changed are told separately by the caller. The
 * payload only names the class and date — never a student — and nobody
 * outside this list receives it. Best effort: a failed lookup never fails the
 * write that triggered it.
 */
import User from '../models/User.js';
import { emitToRoles, emitToUsers } from '../config/socket.js';
import { ACADEMIC_OVERSIGHT_ROLES, FIRST_YEAR_HOD_DEPT } from '../constants.js';
import { dayKey } from '../utils/dates.js';
import { pastAttendanceChanged } from './attendanceTotals.js';

export async function announceClassAttendance({ department, year, section, semester, day }, actorId) {
  // Every attendance write passes through here, so this is where cached
  // totals of earlier days are dropped when an earlier day changes.
  pastAttendanceChanged(day);
  const payload = { kind: 'class', department, section: section || null, date: day ? dayKey(day) : null };
  try {
    const watchers = await User.find({
      isActive: true,
      $or: [
        {
          role: 'faculty',
          department,
          ...(section ? { section } : {}),
          ...(year != null ? { inChargeYear: year } : {}),
          ...(semester != null ? { inChargeSemester: semester } : {}),
        },
        { role: 'hod', department },
        ...(Number(year) === 1 ? [{ role: 'hod', department: FIRST_YEAR_HOD_DEPT }] : []),
      ],
    }).distinct('_id');
    emitToUsers([...(actorId ? [actorId] : []), ...watchers], 'attendance:updated', payload);
  } catch (err) {
    console.error('[attendance] live update lookup failed:', err.message);
    if (actorId) emitToUsers([actorId], 'attendance:updated', payload);
  }
  emitToRoles(ACADEMIC_OVERSIGHT_ROLES, 'attendance:updated', payload);
}
