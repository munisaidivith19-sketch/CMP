/**
 * Who may see and message whom in Chat.
 *
 * One rule set, used by the chat people picker, by starting a private chat,
 * by opening / reading / sending in an existing private chat, and by the
 * socket room join — so a person outside your chat scope is never listed,
 * never reachable and never readable, whatever the client sends.
 *
 *  - Student: their own classmates (same department + year + section +
 *    semester) and the academic staff: faculty, HODs, principal, chairman,
 *    dean and AO. Never a student of another class.
 *  - Faculty: the students of the classes they handle (timetable) and of
 *    their Class In-Charge class ("Our Class"), plus the academic staff.
 *  - HOD: every student of their own department — never another
 *    department's — plus the academic staff.
 *  - Admin, principal, chairman, dean, AO: anyone (college-wide roles).
 *  - Security / Warden: unchanged — anyone (their existing behaviour).
 *  - Alumni: only the students they mentor (an accepted mentorship); a
 *    student in turn may message their accepted mentors.
 *
 * Groups are deliberately outside this rule: a member of an approved group
 * sees its other members, because an authorised creator put them there.
 */
import User from '../models/User.js';
import MentorshipRequest from '../models/MentorshipRequest.js';
import { COLLEGE_WIDE_ROLES } from '../constants.js';
import {
  STUDENT_ROLES,
  facultyAssignments,
  facultyClassInChargeScope,
  ownDepartment,
  studentsInClassesFilter,
} from './academicScope.js';

/** The staff every student, faculty member and HOD may message. */
export const CHAT_STAFF_ROLES = ['faculty', 'hod', 'principal', 'chairman', 'ao', 'dean'];
/** Roles whose chat scope is the whole campus. */
const UNRESTRICTED = [...COLLEGE_WIDE_ROLES, 'security', 'warden'];

// Everything chatContactFilter reads, for a user loaded only to check the reverse direction.
const CLASS_FIELDS = 'role department year section semester inChargeYear inChargeSemester';
const classKey = (c) => `${c.department}|${c.year}|${c.section}|${c.semester ?? ''}`;

/** The exact classes a faculty member / HOD handles through the timetable. */
async function handlingClasses(user) {
  const seen = new Map();
  for (const a of await facultyAssignments(user)) {
    const c = { department: a.department, year: a.year, section: a.section, semester: a.semester };
    seen.set(classKey(c), c);
  }
  return [...seen.values()];
}

/**
 * The students a faculty member may chat with: their handling classes and
 * their Class In-Charge class, both exact (year and semester included).
 */
export async function facultyChatClasses(user) {
  const [handling, ourClass] = await Promise.all([handlingClasses(user), facultyClassInChargeScope(user)]);
  const seen = new Map(handling.map((c) => [classKey(c), c]));
  for (const c of ourClass) seen.set(classKey(c), { department: c.department, year: c.year, section: c.section, semester: c.semester });
  return [...seen.values()];
}

/** Mongo filter over User for the people `user` may see and message in Chat. */
export async function chatContactFilter(user) {
  if (UNRESTRICTED.includes(user.role)) return {};
  const staff = { role: { $in: CHAT_STAFF_ROLES } };

  if (STUDENT_ROLES.includes(user.role)) {
    const or = [staff];
    // A student with no class on file has no classmates — only staff.
    if (user.department && user.section && user.year) {
      or.push({
        role: { $in: STUDENT_ROLES },
        department: user.department,
        section: String(user.section).toUpperCase(),
        year: user.year,
        ...(user.semester ? { semester: { $in: [user.semester, null] } } : {}),
      });
    }
    const mentors = await MentorshipRequest.find({ student: user._id, status: 'accepted' }).distinct('alumni');
    if (mentors.length) or.push({ _id: { $in: mentors } });
    return { $or: or };
  }

  if (user.role === 'faculty') {
    const classes = await facultyChatClasses(user);
    return { $or: classes.length ? [staff, studentsInClassesFilter(classes)] : [staff] };
  }

  if (user.role === 'hod') {
    return { $or: [staff, { role: { $in: STUDENT_ROLES }, department: ownDepartment(user) }] };
  }

  if (user.role === 'alumni') {
    const mentees = await MentorshipRequest.find({ alumni: user._id, status: 'accepted' }).distinct('student');
    return { _id: { $in: mentees } };
  }

  return { _id: null };
}

/** Whether `viewer` may see / start a chat with `otherId` (one direction). */
export async function canContact(viewer, otherId) {
  const filter = await chatContactFilter(viewer);
  return Boolean(await User.exists({ $and: [{ _id: otherId }, filter] }));
}

/**
 * Whether an existing private chat between `viewer` and `otherId` may be used.
 * Either direction is enough: a student may write to any HOD, and that HOD
 * must be able to answer even though the student is outside their own
 * department.
 */
export async function privateChatAllowed(viewer, otherId) {
  if (await canContact(viewer, otherId)) return true;
  const other = await User.findById(otherId).select(CLASS_FIELDS).lean();
  return Boolean(other) && canContact(other, viewer._id);
}

/**
 * Which of `otherIds` the viewer may keep a private chat with — one query for
 * the direct direction, and a reverse check only for the remainder.
 */
export async function allowedPrivatePartners(viewer, otherIds) {
  if (!otherIds.length) return new Set();
  const filter = await chatContactFilter(viewer);
  const direct = await User.find({ $and: [{ _id: { $in: otherIds } }, filter] }).distinct('_id');
  const allowed = new Set(direct.map(String));
  const rest = otherIds.map(String).filter((id) => !allowed.has(id));
  if (rest.length) {
    const others = await User.find({ _id: { $in: rest } }).select(CLASS_FIELDS).lean();
    const results = await Promise.all(others.map(async (o) => ((await canContact(o, viewer._id)) ? String(o._id) : null)));
    results.filter(Boolean).forEach((id) => allowed.add(id));
  }
  return allowed;
}
