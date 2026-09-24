import mongoose from 'mongoose';
import AttendanceRecord from '../models/AttendanceRecord.js';
import FacultyAttendance from '../models/FacultyAttendance.js';
import User from '../models/User.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { emitToUsers } from '../config/socket.js';
import { dayKey, toDay, today } from '../utils/dates.js';
import { STUDENT_ROLES, percentage } from './attendanceController.js';

// Staff whose daily attendance is tracked.
const TRACKED_STAFF = ['faculty', 'hod'];
const FACULTY_FIELDS = 'name employeeId department designation phone avatar role';
const STUDENT_FIELDS = 'name rollNo section department year semester phone parentPhone avatar stayType';

/**
 * Department a request may look at. HOD: always their own. Admin / Principal:
 * whatever they ask for, or the whole college when they ask for nothing.
 */
function scopedDepartment(user, requested) {
  if (user.role === 'hod') {
    if (requested && requested !== user.department) {
      throw new ApiError(403, 'You can only view your own department');
    }
    if (!user.department) throw new ApiError(422, 'Your account has no department — ask an admin to set it');
    return user.department;
  }
  return requested ? String(requested) : null;
}

const dayOf = (value) => (value ? toDay(value) : today());

/** Per-student day status: present if marked present in at least one period that day. */
async function studentDayStatus(day, department) {
  const rows = await AttendanceRecord.aggregate([
    { $match: { date: day, ...(department ? { department } : {}) } },
    {
      $group: {
        _id: '$student',
        presentPeriods: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        totalPeriods: { $sum: 1 },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { ...r, status: r.presentPeriods > 0 ? 'present' : 'absent' }]));
}

async function facultyDayStatus(day, department) {
  const rows = await FacultyAttendance.find({ date: day, ...(department ? { department } : {}) })
    .populate('markedBy', 'name')
    .lean();
  return new Map(rows.map((r) => [String(r.faculty), r]));
}

const studentFilter = (department, section) => ({
  role: { $in: STUDENT_ROLES },
  isActive: true,
  ...(department ? { department } : {}),
  ...(section ? { section: String(section).toUpperCase() } : {}),
});

const staffFilter = (department) => ({
  role: { $in: TRACKED_STAFF },
  isActive: true,
  ...(department ? { department } : {}),
});

// ── Daily summary (admin: college, HOD: own department) ────────────

export const attendanceSummary = asyncHandler(async (req, res) => {
  const department = scopedDepartment(req.user, req.query.department);
  const day = dayOf(req.query.date);

  const [studentIds, staffIds, studentStatus, staffStatus] = await Promise.all([
    User.find(studentFilter(department)).distinct('_id'),
    User.find(staffFilter(department)).distinct('_id'),
    studentDayStatus(day, department),
    facultyDayStatus(day, department),
  ]);

  const tally = (ids, map) => {
    const t = { total: ids.length, present: 0, absent: 0, leave: 0, unmarked: 0 };
    ids.forEach((id) => {
      const s = map.get(String(id))?.status;
      if (s && s in t) t[s] += 1;
      else t.unmarked += 1;
    });
    // % of those actually marked, so an unmarked morning does not read as 0%.
    const marked = t.total - t.unmarked;
    t.percentage = percentage(t.present, marked);
    return t;
  };

  res.json({
    date: dayKey(day),
    department: department || 'All departments',
    students: tally(studentIds, studentStatus),
    faculty: tally(staffIds, staffStatus),
  });
});

/** "View all" list of students for a day, optionally filtered by status. */
export const summaryStudents = asyncHandler(async (req, res) => {
  const department = scopedDepartment(req.user, req.query.department);
  const day = dayOf(req.query.date);
  const wanted = ['present', 'absent', 'unmarked'].includes(req.query.status) ? req.query.status : null;

  const [students, status] = await Promise.all([
    User.find(studentFilter(department, req.query.section)).select(STUDENT_FIELDS).sort({ department: 1, section: 1, rollNo: 1 }).limit(2000).lean(),
    studentDayStatus(day, department),
  ]);

  const rows = students
    .map((s) => {
      const st = status.get(String(s._id));
      return { ...s, status: st?.status || 'unmarked', presentPeriods: st?.presentPeriods || 0, totalPeriods: st?.totalPeriods || 0 };
    })
    .filter((s) => !wanted || s.status === wanted);

  res.json({ date: dayKey(day), department: department || 'All departments', students: rows });
});

/** "View all" list of faculty for a day, optionally filtered by status. */
export const summaryFaculty = asyncHandler(async (req, res) => {
  const department = scopedDepartment(req.user, req.query.department);
  const day = dayOf(req.query.date);
  const wanted = ['present', 'absent', 'leave', 'unmarked'].includes(req.query.status) ? req.query.status : null;

  const [staff, status] = await Promise.all([
    User.find(staffFilter(department)).select(FACULTY_FIELDS).sort({ department: 1, name: 1 }).lean(),
    facultyDayStatus(day, department),
  ]);

  const rows = staff
    .map((f) => {
      const st = status.get(String(f._id));
      return { ...f, status: st?.status || 'unmarked', note: st?.note || null, markedBy: st?.markedBy || null, markedAt: st?.markedAt || null };
    })
    .filter((f) => !wanted || f.status === wanted);

  res.json({ date: dayKey(day), department: department || 'All departments', faculty: rows });
});

// ── Faculty attendance marking (HOD: own department, admin: anyone) ─

export const facultyRoster = asyncHandler(async (req, res) => {
  const department = scopedDepartment(req.user, req.query.department);
  const day = dayOf(req.query.date);

  const [staff, status] = await Promise.all([
    User.find(staffFilter(department)).select(FACULTY_FIELDS).sort({ department: 1, name: 1 }).lean(),
    facultyDayStatus(day, department),
  ]);

  const future = day > today();
  const editable = ['admin', 'hod'].includes(req.user.role) && !future;
  res.json({
    date: dayKey(day),
    department: department || 'All departments',
    editable,
    lockedReason: editable ? null : future ? 'Attendance cannot be marked for a future date' : 'Read-only access',
    // An HOD does not mark their own attendance — an admin does.
    faculty: staff
      .filter((f) => !(req.user.role === 'hod' && String(f._id) === String(req.user._id)))
      .map((f) => ({ ...f, status: status.get(String(f._id))?.status || null, note: status.get(String(f._id))?.note || null })),
  });
});

export const markFaculty = asyncHandler(async (req, res) => {
  const day = toDay(req.body.date);
  if (day > today()) throw new ApiError(422, 'Attendance cannot be marked for a future date');

  const byId = new Map();
  req.body.records.forEach((r) => byId.set(String(r.faculty), r));
  if (byId.size !== req.body.records.length) throw new ApiError(422, 'A staff member appears more than once');
  const ids = [...byId.keys()];

  const filter = { _id: { $in: ids }, ...staffFilter(req.user.role === 'hod' ? req.user.department : null) };
  const staff = await User.find(filter).select('_id department').lean();
  if (staff.length !== ids.length) {
    throw new ApiError(422, req.user.role === 'hod' ? 'You can only mark faculty in your own department' : 'Some staff members were not found');
  }
  if (req.user.role === 'hod' && ids.includes(String(req.user._id))) {
    throw new ApiError(403, 'Your own attendance is marked by an administrator');
  }

  const deptOf = Object.fromEntries(staff.map((s) => [String(s._id), s.department]));
  const now = new Date();
  await FacultyAttendance.bulkWrite(
    ids.map((id) => {
      const set = { status: byId.get(id).status, markedBy: req.user._id, markedAt: now };
      if (byId.get(id).note) set.note = byId.get(id).note;
      if (deptOf[id]) set.department = deptOf[id];
      return {
        updateOne: {
          filter: { faculty: new mongoose.Types.ObjectId(id), date: day },
          update: { $set: set, $setOnInsert: { faculty: new mongoose.Types.ObjectId(id), date: day } },
          upsert: true,
        },
      };
    }),
    { ordered: false }
  );

  logActivity(req, 'attendance.faculty_mark', { summary: `${dayKey(day)}: ${ids.length} staff` });
  emitToUsers(ids, 'attendance:updated', { kind: 'faculty', date: dayKey(day) });
  res.json({ message: `Saved attendance for ${ids.length} staff member${ids.length === 1 ? '' : 's'}` });
});
