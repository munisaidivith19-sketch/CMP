import crypto from 'node:crypto';
import GatePass, { generateGatePassSecurityCode, normalizeGateCode } from '../models/GatePass.js';
import TimetableSlot from '../models/TimetableSlot.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/http.js';
import { distanceMeters } from '../utils/geo.js';
import { facultyClasses, inClasses } from '../utils/academicScope.js';
import { notifyUsers } from '../utils/notify.js';
import { sendParentMessage } from './otp/otpService.js';
import { renderReturnSms } from './otp/providers/collegeSmsProvider.js';

export const RETURN_QR_PREFIX = 'CCRT:';

export const LOCATION_MESSAGES = {
  outside_geofence: 'Your current location could not be verified as being within the campus area. Please enter the campus and try again.',
  low_accuracy: 'Your current location is not accurate enough. Please move to an open area and try again.',
  stale_location: 'Your location information is outdated. Please try again.',
};

/**
 * Decide a single location reading against the configured campus geofence.
 * Distance is computed here from the raw coordinates; nothing the client
 * claims about distance or verification is used. Distance is compared at
 * centimeter precision so a reading exactly on the radius counts as inside.
 */
export function evaluateLocation({ latitude, longitude, accuracy, timestamp }, now = Date.now()) {
  const cfg = env.location;
  const distance = distanceMeters({ latitude: cfg.collegeLatitude, longitude: cfg.collegeLongitude }, { latitude, longitude });
  let reason = null;
  if (Math.abs(now - new Date(timestamp).getTime()) > cfg.maxAgeSeconds * 1000) reason = 'stale_location';
  else if (accuracy > cfg.maxAccuracyMeters) reason = 'low_accuracy';
  else if (Math.round(distance * 100) / 100 > cfg.radiusMeters) reason = 'outside_geofence';
  return { distance, reason };
}

/**
 * Give an active (student-outside) pass a fresh return credential: an opaque
 * random QR token plus a short spoken code in the existing gate-code format.
 * Any earlier return credential for the pass stops working.
 */
export async function issueReturnCredential(passId, studentId, now = new Date()) {
  const expiresAt = new Date(now.getTime() + env.location.returnCredentialMinutes * 60000);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const token = crypto.randomBytes(24).toString('base64url');
    const code = generateGatePassSecurityCode();
    try {
      const pass = await GatePass.findOneAndUpdate(
        { _id: passId, student: studentId, status: 'active', actualExit: { $ne: null } },
        { $set: { returnToken: token, returnCode: code, returnCredentialExpiresAt: expiresAt, returnLocationVerifiedAt: now } },
        { new: true }
      );
      if (!pass) throw new ApiError(409, 'This gate pass is no longer waiting for your return');
      return { token, code, expiresAt };
    } catch (err) {
      if (err?.code !== 11000) throw err; // another pass holds this code right now — draw again
    }
  }
  throw new ApiError(503, 'Could not create a return code. Please try again.');
}

/** "CCRT:<token>" from a scanned QR, or a typed 4-character return code. */
export function parseReturnCredential(input) {
  const raw = String(input ?? '').trim();
  if (raw.toUpperCase().startsWith(RETURN_QR_PREFIX)) {
    const token = raw.slice(RETURN_QR_PREFIX.length);
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new ApiError(422, 'This QR code is not a return pass');
    return { returnToken: token };
  }
  const code = normalizeGateCode(raw);
  if (!code) throw new ApiError(422, 'Enter a valid 4-character return code (letters and numbers)');
  return { returnCode: code };
}

/**
 * Faculty assigned to the student's current class (department + year +
 * section + semester), via the same timetable / class in-charge assignment
 * used for faculty scope everywhere else. Never the whole department.
 */
export async function assignedFacultyIds(student) {
  if (!student?.department || !student?.section) return [];
  const teaching = await TimetableSlot.find({ department: student.department, section: student.section, isActive: true, isBreak: { $ne: true } }).distinct('faculty');
  const candidates = await User.find({
    role: 'faculty',
    isActive: true,
    $or: [{ _id: { $in: teaching } }, { department: student.department, section: student.section }],
  })
    .select('department section teachingYears')
    .lean();
  const assigned = await Promise.all(candidates.map(async (f) => (inClasses(await facultyClasses(f), student) ? f._id : null)));
  return assigned.filter(Boolean);
}

const fmtParts = (date) => {
  const tz = env.timezone;
  return {
    date: new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    time24: new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date),
    time12: new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(date).toUpperCase(),
  };
};

/**
 * Tell the parent (SMS provider) and the student's assigned class faculty
 * (in-app + push) that the student is back. Call only after the return has
 * been committed. Never throws.
 */
export async function notifyReturned({ pass, student, returnedAt }) {
  const { date, time24, time12 } = fmtParts(returnedAt);
  const [parentSent, facultyIds] = await Promise.all([
    sendParentMessage({ to: pass.parentPhone, kind: 'gate_pass_return', message: renderReturnSms({ studentName: student.name, date, time: time12 }) }),
    assignedFacultyIds(student).catch((err) => {
      console.error('[gate-pass] could not resolve class faculty:', err.message);
      return [];
    }),
  ]);
  await notifyUsers(facultyIds, {
    type: 'gate_pass',
    title: '🔔 Student Returned to Campus',
    message: `${student.name} — Roll No: ${student.rollNo || '—'} has returned to the campus.\nDate: ${date}\nTime: ${time24}`,
    link: `/gate-pass/${pass._id}`,
  });
  return { parentSent, facultyNotified: facultyIds.length };
}
