import mongoose from 'mongoose';
import AttendanceRecord from '../models/AttendanceRecord.js';
import FacultyAttendance from '../models/FacultyAttendance.js';
import User from '../models/User.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { emitToRoles, emitToUsers } from '../config/socket.js';
import { studentTotals } from '../services/attendanceTotals.js';
import { dayFilter, dayKey, resolveRange, toDay, today } from '../utils/dates.js';
import { LOW_ATTENDANCE_THRESHOLD, STUDENT_ROLES, percentage } from './attendanceController.js';
import { ACADEMIC_OVERSIGHT_ROLES, ATTENDANCE_READ_ONLY_ROLES, DEPARTMENTS, FIRST_YEAR_HOD_DEPT, isBranchHod, isFirstYearHod } from '../constants.js';

// Staff whose daily attendance is tracked.
const TRACKED_STAFF = ['faculty', 'hod'];
const FACULTY_FIELDS = 'name employeeId department designation phone avatar role';
const STUDENT_FIELDS = 'name rollNo section department year semester phone parentPhone avatar stayType';
/**
 * Read-only oversight roles (ATTENDANCE_READ_ONLY_ROLES: principal / dean / AO /
 * chairman, COE, Office, Super Admin) look at attendance, they never contact a
 * family: the parent's mobile is left out of what they receive.
 */
const withoutParentPhone = (fields, user) =>
  ATTENDANCE_READ_ONLY_ROLES.includes(user?.role) ? fields.split(' ').filter((f) => f !== 'parentPhone').join(' ') : fields;
// An approved On Duty period counts as attended, exactly as in attendanceController.
const attendedExpr = { $sum: { $cond: [{ $in: ['$status', ['present', 'od']] }, 1, 0] } };

/**
 * Department a request may look at. HOD: always their own, except First Year HOD
 * who can look across all departments (or filter by one). Admin / Principal:
 * whatever they ask for, or the whole college when they ask for nothing.
 */
function scopedDepartment(user, requested) {
  if (user.role === 'hod') {
    if (isFirstYearHod(user)) {
      return requested ? String(requested) : null;
    }
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
async function studentDayStatus(day, department, studentIds) {
  const match = { date: day };
  if (studentIds && studentIds.length) {
    match.student = { $in: studentIds };
    if (department) match.department = department;
  } else if (department) {
    match.department = department;
  }
  const rows = await AttendanceRecord.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$student',
        presentPeriods: attendedExpr,
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

const studentFilter = (department, { section, year, semester, stayType } = {}, user) => {
  const f = {
    role: { $in: STUDENT_ROLES },
    isActive: true,
    ...(department ? { department } : {}),
    ...(stayType ? { stayType: String(stayType) } : {}),
    ...(section ? { section: String(section).toUpperCase() } : {}),
    ...(year ? { year: Number(year) } : {}),
    ...(semester ? { semester: Number(semester) } : {}),
  };
  if (user && isFirstYearHod(user)) {
    f.year = 1;
    if (semester) f.semester = Number(semester);
  } else if (user && isBranchHod(user)) {
    f.department = user.department;
    // 1st year belongs to the Science & Humanities HOD: asking for it matches no one.
    if (Number(year) === 1) f._id = null;
    else if (!year) f.year = { $in: [2, 3, 4] };
  }
  return f;
};

/** Class filters (all optional; "All" = absent) from the already-validated query. */
const classFilters = (q) => ({ section: q.section, year: q.year, semester: q.semester, stayType: q.stayType });
const isNarrowed = (f) => Boolean(f.section || f.year || f.semester || f.stayType);

const staffFilter = (department) => ({
  role: { $in: TRACKED_STAFF },
  isActive: true,
  ...(department ? { department } : {}),
});

// ── Daily summary (admin: college, HOD: own department) ────────────

export const attendanceSummary = asyncHandler(async (req, res) => {
  const department = scopedDepartment(req.user, req.query.department);
  const day = dayOf(req.query.date);

  const filters = classFilters(req.query);
  const sFilter = studentFilter(department, filters, req.user);
  const studentIds = await User.find(sFilter).distinct('_id');
  const needsNarrowing = isNarrowed(filters) || isFirstYearHod(req.user) || isBranchHod(req.user);
  const [staffIds, studentStatus, staffStatus] = await Promise.all([
    User.find(staffFilter(department)).distinct('_id'),
    studentDayStatus(day, department, needsNarrowing ? studentIds : null),
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
    department: department || (isFirstYearHod(req.user) ? '1st Year (All Departments)' : 'All departments'),
    students: tally(studentIds, studentStatus),
    faculty: tally(staffIds, staffStatus),
  });
});

/** "View all" list of students for a day, optionally filtered by status. */
export const summaryStudents = asyncHandler(async (req, res) => {
  const department = scopedDepartment(req.user, req.query.department);
  const day = dayOf(req.query.date);
  const wanted = ['present', 'absent', 'unmarked'].includes(req.query.status) ? req.query.status : null;

  const filters = classFilters(req.query);
  const sFilter = studentFilter(department, filters, req.user);
  const students = await User.find(sFilter).select(withoutParentPhone(STUDENT_FIELDS, req.user)).sort({ department: 1, section: 1, rollNo: 1 }).limit(2000).lean();
  const studentIds = students.map((s) => s._id);
  const needsNarrowing = isNarrowed(filters) || isFirstYearHod(req.user) || isBranchHod(req.user);
  const status = await studentDayStatus(day, department, needsNarrowing ? studentIds : null);

  const rows = students
    .map((s) => {
      const st = status.get(String(s._id));
      return { ...s, status: st?.status || 'unmarked', presentPeriods: st?.presentPeriods || 0, totalPeriods: st?.totalPeriods || 0 };
    })
    .filter((s) => !wanted || s.status === wanted);

  res.json({ date: dayKey(day), department: department || 'All departments', students: rows });
});

/**
 * Department overview for the HOD attendance dashboard, one row per year
 * (per department for the Science & Humanities HOD, who owns every
 * department's 1st year): today's present / absent / unmarked headcount,
 * the same for hostellers only, and the students below the attendance
 * threshold over the current semester window (with their parent's mobile,
 * which this audience already sees on the "View all" list).
 *
 * The student set comes from the same scopedDepartment + studentFilter as
 * every other summary read, so an HOD can never widen it with a query.
 */
const BREAKDOWN_FIELDS = 'name title rollNo section department year semester parentPhone stayType avatar';

export const departmentBreakdown = asyncHandler(async (req, res) => {
  const department = scopedDepartment(req.user, req.query.department);
  const day = dayOf(req.query.date);
  // Principal & the other college-wide roles, no department picked: the whole
  // college, one row per department with its years inside (counts only — the
  // student lists come from the per-department call, made on drill-down).
  const collegeOverview = ACADEMIC_OVERSIGHT_ROLES.includes(req.user.role) && !department;
  const byDepartment = isFirstYearHod(req.user) || collegeOverview;

  const students = await User.find(studentFilter(department, {}, req.user)).select(withoutParentPhone(BREAKDOWN_FIELDS, req.user)).lean();
  const ids = students.map((s) => s._id);
  // Semester totals: earlier days come from a cache that every attendance
  // write invalidates, today is always read fresh (services/attendanceTotals).
  const [status, periods] = await Promise.all([
    studentDayStatus(day, department, ids.length ? ids : [null]),
    studentTotals(resolveRange({ range: 'semester' }).from),
  ]);
  const threshold = LOW_ATTENDANCE_THRESHOLD;

  const emptyTally = () => ({ total: 0, present: 0, absent: 0, unmarked: 0 });
  const groups = new Map();
  const groupOf = (s) => {
    const key = byDepartment ? s.department || '—' : String(s.year || '—');
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        year: collegeOverview ? null : byDepartment ? 1 : s.year || null,
        department: byDepartment ? s.department || null : department,
        students: emptyTally(),
        hostellers: emptyTally(),
        lowAttendance: [],
        ...(collegeOverview ? { years: new Map([1, 2, 3, 4].map((y) => [y, { year: y, students: emptyTally(), hostellers: emptyTally(), lowCount: 0 }])) } : {}),
      });
    }
    return groups.get(key);
  };

  for (const s of students) {
    const g = groupOf(s);
    const yr = g.years?.get(s.year);
    const st = status.get(String(s._id))?.status || 'unmarked';
    for (const t of yr ? [g, yr] : [g]) {
      t.students.total += 1;
      t.students[st] += 1;
      if (s.stayType === 'hosteler') {
        t.hostellers.total += 1;
        t.hostellers[st] += 1;
      }
    }
    const p = periods.get(String(s._id));
    const pct = p ? percentage(p.present, p.total) : null;
    if (p && pct < threshold) {
      if (yr) yr.lowCount += 1;
      g.lowAttendance.push({
        _id: s._id, name: s.name, title: s.title, rollNo: s.rollNo, section: s.section, department: s.department, year: s.year,
        parentPhone: s.parentPhone || null, presentPeriods: p.present, totalPeriods: p.total, percentage: pct,
      });
    }
  }

  // Every year in scope gets a row, even when it has no students yet.
  if (!byDepartment) {
    const years = isBranchHod(req.user) ? [2, 3, 4] : [1, 2, 3, 4];
    years.forEach((y) => groupOf({ year: y }));
  }
  // …and, college-wide, every teaching department (Science & Humanities owns no students).
  if (collegeOverview) DEPARTMENTS.filter((d) => d !== FIRST_YEAR_HOD_DEPT).forEach((d) => groupOf({ department: d }));
  const rows = [...groups.values()]
    .map((g) => {
      const row = { ...g, lowCount: g.lowAttendance.length, lowAttendance: g.lowAttendance.sort((a, b) => a.percentage - b.percentage) };
      if (collegeOverview) {
        row.years = [...g.years.values()];
        delete row.lowAttendance;
      }
      return row;
    })
    .sort((a, b) => (byDepartment ? String(a.key).localeCompare(String(b.key)) : (a.year || 99) - (b.year || 99)));

  const sum = (pick) => rows.reduce((t, g) => ({ total: t.total + pick(g).total, present: t.present + pick(g).present, absent: t.absent + pick(g).absent, unmarked: t.unmarked + pick(g).unmarked }), emptyTally());
  res.json({
    date: dayKey(day),
    department: department || (isFirstYearHod(req.user) ? '1st Year (All Departments)' : 'All departments'),
    groupBy: byDepartment ? 'department' : 'year',
    threshold,
    totals: { students: sum((g) => g.students), hostellers: sum((g) => g.hostellers), lowAttendance: rows.reduce((t, g) => t + g.lowCount, 0) },
    groups: rows,
  });
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
      return { ...f, status: st?.status || 'unmarked', note: st?.note || null, source: st?.source || null, autoFrom: st?.autoFrom || null, markedBy: st?.markedBy || null, markedAt: st?.markedAt || null };
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
      .map((f) => {
        const st = status.get(String(f._id));
        return { ...f, status: st?.status || null, note: st?.note || null, source: st?.source || null, autoFrom: st?.autoFrom || null };
      }),
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
      const set = { status: byId.get(id).status, markedBy: req.user._id, markedAt: now, source: 'manual' };
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
  emitToUsers([...ids, req.user._id], 'attendance:updated', { kind: 'faculty', date: dayKey(day) });
  // The college dashboards (principal, COE …) show faculty attendance too.
  emitToRoles(ACADEMIC_OVERSIGHT_ROLES, 'attendance:updated', { kind: 'faculty', date: dayKey(day) });
  res.json({ message: `Saved attendance for ${ids.length} staff member${ids.length === 1 ? '' : 's'}` });
});
