import Subject from '../models/Subject.js';
import TimetableSlot from '../models/TimetableSlot.js';
import User from '../models/User.js';
import { ApiError, asyncHandler, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { emitToRoles } from '../config/socket.js';
import { campusParts, toDay } from '../utils/dates.js';
import { COLLEGE_WIDE_ROLES, FIRST_YEAR_HOD_DEPT, TIMETABLE_VIEW_ROLES, isBranchHod, isFirstYearHod, yearOfSemester } from '../constants.js';
import { STUDENT_ROLES, classInChargeFilter, facultyClassInChargeScope, ownDepartment } from '../utils/academicScope.js';
import { annotateWeek, findHoliday, toApi as toHolidayApi } from '../services/holidays.js';
import { clock } from '../utils/clock.js';
import { assertPeriodOrder, spareBreakPeriod, suggestClassPeriod } from '../services/timetablePeriods.js';

// Warden/Security must never receive a timetable event, even a bare
// department/section identifier — emit only to the roles that can see timetables.
const broadcastTimetable = (payload) => emitToRoles(TIMETABLE_VIEW_ROLES, 'timetable:updated', payload);

/** HOD writes are confined to their own department (or 1st year for Science & Humanities HOD) — never trust the client. */
function assertOwnDepartment(user, department, year, semester) {
  if (user.role !== 'hod') return;
  const y = year ?? (semester ? yearOfSemester(semester) : undefined);
  if (isFirstYearHod(user)) {
    if (y !== undefined && y !== 1) {
      throw new ApiError(403, 'First Year HOD can only manage 1st year subjects and timetables');
    }
    return;
  }
  if (department !== user.department) {
    throw new ApiError(403, 'You can only manage your own department’s timetable');
  }
  if (y === 1) {
    throw new ApiError(403, 'First year subjects and timetables are managed by the Science & Humanities HOD');
  }
}

/**
 * The Mongo filter a role's timetable *reads* are confined to. The academic
 * scope is derived from the authenticated account and its teaching
 * assignments; a client may only narrow it (semester, and for an HOD year /
 * section), never widen it.
 *
 * - Student: their own class, from the account.
 * - Faculty, `scope=handling` (default): their own periods only. Department,
 *   year and section come from their teaching assignments, so a sent
 *   department/year/section/faculty is ignored outright rather than trusted.
 * - Faculty, `scope=class`: the COMPLETE timetable of their Class In-Charge
 *   class (every subject and faculty), from facultyClassInChargeScope — the
 *   exact department + year + section + semester on their account. Not
 *   filtered by faculty. No in-charge class → nothing.
 * - HOD: their own department, optionally narrowed to a year/section/faculty.
 *   `view=mine` narrows it further to the HOD's own teaching periods.
 * - Admin, Principal, Chairman, Dean, AO (COLLEGE_WIDE_ROLES): any class in
 *   any department; `view=mine` narrows to their own periods.
 * - Anything else (Security, Warden): no timetable scope at all.
 */
async function timetableReadScope(user, query = {}) {
  const filter = { isActive: true };
  const semester = query.semester ? Number(query.semester) : undefined;

  if (STUDENT_ROLES.includes(user.role)) {
    // Class identity comes only from the account, never from the query string.
    if (!user.section || !user.department || !user.year) return null;
    filter.section = user.section;
    filter.department = user.department;
    filter.year = user.year;
    if (user.semester) filter.semester = user.semester;
    return filter;
  }

  if (user.role === 'faculty') {
    if (query.scope === 'class') {
      const ourClass = await facultyClassInChargeScope(user);
      if (!ourClass.length) return { _id: null };
      // The class decides department/year/section/semester; a sent semester
      // can only narrow it, and one that differs simply matches nothing.
      Object.assign(filter, classInChargeFilter(ourClass));
      if (semester && !ourClass.some((c) => c.semester === semester)) return { _id: null };
      return filter;
    }
    filter.faculty = user._id;
    if (semester) filter.semester = semester;
    return filter;
  }

  if (user.role === 'hod') {
    if (isFirstYearHod(user)) {
      filter.year = 1;
      if (query.department) filter.department = String(query.department);
      if (query.view === 'mine') filter.faculty = user._id;
      else if (query.faculty) filter.faculty = query.faculty;
      if (query.section) filter.section = String(query.section).toUpperCase();
      if (semester) {
        if (![1, 2].includes(semester)) return { _id: null };
        filter.semester = semester;
      }
      return filter;
    }

    filter.department = ownDepartment(user);
    if (query.year) {
      const qYear = Number(query.year);
      if (qYear === 1) return { _id: null };
      filter.year = qYear;
    } else {
      filter.year = { $in: [2, 3, 4] };
    }
    if (query.view === 'mine') filter.faculty = user._id;
    else if (query.faculty) filter.faculty = query.faculty;
    if (query.section) filter.section = String(query.section).toUpperCase();
    if (semester) {
      if ([1, 2].includes(semester)) return { _id: null };
      filter.semester = semester;
    }
    return filter;
  }

  if (!COLLEGE_WIDE_ROLES.includes(user.role)) return { _id: null };

  // College-wide authorities: a free lookup across every department.
  if (query.view === 'mine') filter.faculty = user._id;
  else if (query.faculty) filter.faculty = query.faculty;
  if (query.section) filter.section = String(query.section).toUpperCase();
  if (query.department) filter.department = String(query.department);
  if (query.year) filter.year = Number(query.year);
  if (semester) filter.semester = semester;
  return filter;
}

const SLOT_FIELDS = [
  'subject', 'faculty', 'section', 'department', 'room',
  'dayOfWeek', 'period', 'startTime', 'endTime',
  'semester', 'year', 'academicYear', 'isBreak', 'breakLabel',
];
const SUBJECT_FIELDS = ['name', 'code', 'department', 'semester', 'year', 'credits', 'type', 'faculty', 'sections'];
const DAY_ORDER = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

const populateSlot = (q) => q.populate('subject', 'name code type credits').populate('faculty', 'name email avatar designation');
const sortSlots = (slots) =>
  slots.sort((a, b) => (DAY_ORDER[a.dayOfWeek] || 9) - (DAY_ORDER[b.dayOfWeek] || 9) || a.period - b.period);

// ── Subjects CRUD ──────────────────────────────────────────────────

export const listSubjects = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.query.department) filter.department = String(req.query.department);
  if (req.query.semester) filter.semester = Number(req.query.semester);
  if (req.query.faculty) filter.faculty = req.query.faculty;
  // Faculty picking a class to mark: only subjects they teach.
  if (req.query.mine === 'true') filter.faculty = req.user._id;
  // Scope the catalogue to the account, after the query filters so a sent
  // department or faculty id can only narrow the result, never widen it. A
  // faculty member's own subjects are the ones they are listed on plus the
  // ones the timetable actually schedules them for (the authoritative source).
  if (req.user.role === 'faculty') {
    const scheduled = await TimetableSlot.find({ faculty: req.user._id, isActive: true, isBreak: { $ne: true } }).distinct('subject');
    filter.$and = [{ $or: [{ faculty: req.user._id }, { _id: { $in: scheduled } }] }];
  } else if (req.user.role === 'hod') {
    // A requested semester only narrows the scope below; outside it the answer is empty.
    const sem = filter.semester;
    if (isFirstYearHod(req.user)) {
      if (sem !== undefined && ![1, 2].includes(sem)) return res.json([]);
      const firstYear = sem ?? { $in: [1, 2] };
      if (req.query.department) {
        filter.$or = [{ department: String(req.query.department), semester: firstYear }, { department: FIRST_YEAR_HOD_DEPT }];
        delete filter.department;
      } else {
        filter.$or = [{ department: FIRST_YEAR_HOD_DEPT }, { semester: firstYear }];
      }
    } else {
      if ([1, 2].includes(sem)) return res.json([]);
      filter.department = ownDepartment(req.user);
      filter.semester = sem ?? { $nin: [1, 2] };
    }
  } else if (!COLLEGE_WIDE_ROLES.includes(req.user.role)) {
    return res.json([]);
  }

  const subjects = await Subject.find(filter)
    .populate('faculty', 'name email avatar department')
    .sort('code')
    .lean();
  res.json(subjects);
});

async function assertFaculty(ids = []) {
  if (!ids.length) return;
  const n = await User.countDocuments({ _id: { $in: ids }, role: { $in: ['faculty', 'hod', 'admin'] }, isActive: true });
  if (n !== new Set(ids.map(String)).size) throw new ApiError(422, 'Every assigned faculty member must be an active faculty account');
}

const normaliseSections = (sections) =>
  Array.isArray(sections) ? [...new Set(sections.map((s) => String(s).trim().toUpperCase()).filter(Boolean))] : sections;

export const createSubject = asyncHandler(async (req, res) => {
  const data = pick(req.body, SUBJECT_FIELDS);
  if (req.user.role === 'hod') {
    if (isFirstYearHod(req.user)) {
      if (!data.department) data.department = FIRST_YEAR_HOD_DEPT;
      assertOwnDepartment(req.user, data.department, data.year, data.semester);
    } else {
      data.department = req.user.department;
      assertOwnDepartment(req.user, data.department, data.year, data.semester);
    }
  }
  data.sections = normaliseSections(data.sections);
  await assertFaculty(data.faculty);
  const dup = await Subject.exists({ code: String(data.code).toUpperCase(), department: data.department, semester: data.semester, isActive: true });
  if (dup) throw new ApiError(409, `${String(data.code).toUpperCase()} already exists for this department and semester`);
  const subject = await Subject.create(data);
  logActivity(req, 'subject.create', { entityType: 'subject', entityId: subject._id, summary: subject.code });
  res.status(201).json(await Subject.findById(subject._id).populate('faculty', 'name email avatar department'));
});

export const updateSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.id);
  if (!subject) throw new ApiError(404, 'Subject not found');
  assertOwnDepartment(req.user, subject.department, subject.year, subject.semester);
  const data = pick(req.body, [...SUBJECT_FIELDS, 'isActive']);
  if (req.user.role === 'hod') {
    if (isFirstYearHod(req.user)) {
      assertOwnDepartment(req.user, data.department || subject.department, data.year ?? subject.year, data.semester ?? subject.semester);
    } else {
      data.department = req.user.department;
      assertOwnDepartment(req.user, data.department, data.year ?? subject.year, data.semester ?? subject.semester);
    }
  }
  if (data.sections) data.sections = normaliseSections(data.sections);
  if (data.faculty) await assertFaculty(data.faculty);
  Object.assign(subject, data);
  await subject.save();
  logActivity(req, 'subject.update', { entityType: 'subject', entityId: subject._id, summary: subject.code });
  res.json(await Subject.findById(subject._id).populate('faculty', 'name email avatar department'));
});

export const deleteSubject = asyncHandler(async (req, res) => {
  const existing = await Subject.findById(req.params.id).select('department year semester').lean();
  if (!existing) throw new ApiError(404, 'Subject not found');
  assertOwnDepartment(req.user, existing.department, existing.year, existing.semester);
  const subject = await Subject.findByIdAndUpdate(req.params.id, { isActive: false });
  // Its timetable slots go too, so nobody is scheduled for a retired subject.
  await TimetableSlot.updateMany({ subject: subject._id, isActive: true }, { isActive: false });
  logActivity(req, 'subject.delete', { entityType: 'subject', entityId: subject._id, summary: subject.code });
  broadcastTimetable({ department: subject.department });
  res.json({ message: 'Subject deactivated' });
});

// ── Timetable reads ────────────────────────────────────────────────

/**
 * Timetable for the current user. Every academic-scope decision is made by
 * timetableReadScope from the authenticated account — a faculty account can
 * never reach another department, year or section by sending parameters.
 */
export const getMyTimetable = asyncHandler(async (req, res) => {
  const filter = await timetableReadScope(req.user, req.query);
  if (!filter) return res.json({ slots: [], needsSection: true });
  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  // Each slot carries this week's date for its weekday and the holiday (if
  // any) that cancels that meeting; the stored schedule is never changed.
  const week = await annotateWeek(slots);
  const body = { slots: sortSlots(slots), needsSection: false, week };
  // Our Class view: say which class it is (or that there is none), so the UI
  // never has to work it out — or guess — on its own.
  if (req.user.role === 'faculty' && req.query.scope === 'class') {
    body.classInCharge = (await facultyClassInChargeScope(req.user))[0] || null;
  }
  res.json(body);
});

async function resolveMasterTimetableData(user, query = {}) {
  const filter = { isActive: true };
  const isFYH = isFirstYearHod(user);

  if (isFYH) {
    filter.year = 1;
    if (query.department) {
      filter.department = String(query.department);
    }
  } else {
    filter.department = ownDepartment(user);
    if (query.year) {
      const qYear = Number(query.year);
      if (qYear === 1) {
        return { slots: [], classes: [], periods: [], faculties: [], department: user.department, isFirstYearHod: false, week: {} };
      }
      filter.year = qYear;
    } else {
      filter.year = { $in: [2, 3, 4] };
    }
  }

  if (query.dayOfWeek) {
    filter.dayOfWeek = String(query.dayOfWeek).toLowerCase();
  }
  if (query.semester) {
    filter.semester = Number(query.semester);
  }

  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  const week = await annotateWeek(slots);
  const sorted = sortSlots(slots);

  // Group and derive distinct classes: { department, year, section, semester, label }
  const classMap = new Map();
  sorted.forEach((s) => {
    if (!s.section) return;
    const key = `${s.department}-${s.year}-${s.section}-${s.semester}`;
    if (!classMap.has(key)) {
      classMap.set(key, {
        department: s.department,
        year: s.year,
        section: s.section,
        semester: s.semester,
        label: `${s.department} · Year ${s.year} · Sec ${s.section} (Sem ${s.semester})`,
      });
    }
  });

  const classes = [...classMap.values()].sort(
    (a, b) =>
      (a.department || '').localeCompare(b.department || '') ||
      a.year - b.year ||
      (a.section || '').localeCompare(b.section || '') ||
      a.semester - b.semester
  );

  // Distinct periods across the day: { period, startTime, endTime, isBreak, breakLabel }
  const periodMap = new Map();
  sorted.forEach((s) => {
    const key = `${s.startTime}-${s.endTime}`;
    if (!periodMap.has(key)) {
      periodMap.set(key, {
        period: s.period,
        startTime: s.startTime,
        endTime: s.endTime,
        isBreak: Boolean(s.isBreak),
        breakLabel: s.breakLabel || '',
      });
    }
  });

  const periods = [...periodMap.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Distinct faculty list for filtering
  const facultyMap = new Map();
  sorted.forEach((s) => {
    if (s.faculty && s.faculty._id) {
      facultyMap.set(String(s.faculty._id), {
        _id: s.faculty._id,
        name: s.faculty.name,
        email: s.faculty.email,
        avatar: s.faculty.avatar,
        designation: s.faculty.designation,
      });
    }
  });

  const faculties = [...facultyMap.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return {
    slots: sorted,
    classes,
    periods,
    faculties,
    department: isFYH ? (query.department || FIRST_YEAR_HOD_DEPT) : user.department,
    isFirstYearHod: isFYH,
    week,
  };
}

/**
 * Master Timetable: available exclusively to HODs. Combines all class timetables
 * of their department (Years 2-4 for Branch HODs, Year 1 across branch departments
 * for First-Year S&H HOD) into a single master schedule.
 */
export const getMasterTimetable = asyncHandler(async (req, res) => {
  if (req.user.role !== 'hod') {
    throw new ApiError(403, 'Master timetable is only accessible to HODs');
  }
  if (req.query.format === 'pdf') {
    return exportMasterTimetablePdf(req, res);
  }
  const result = await resolveMasterTimetableData(req.user, req.query);
  res.json(result);
});

/**
 * Export Master Timetable as official PDF in landscape A4.
 */
export const exportMasterTimetablePdf = asyncHandler(async (req, res) => {
  if (req.user.role !== 'hod') {
    throw new ApiError(403, 'Master timetable is only accessible to HODs');
  }
  const { generateMasterTimetablePdfBuffer } = await import('../services/masterTimetablePdf.js');
  const dayOfWeek = req.query.dayOfWeek ? String(req.query.dayOfWeek).toLowerCase() : 'monday';
  const data = await resolveMasterTimetableData(req.user, { ...req.query, dayOfWeek });

  const buffer = await generateMasterTimetablePdfBuffer({
    ...data,
    dayOfWeek,
    year: req.query.year ? Number(req.query.year) : null,
  });

  const deptSlug = (data.department || 'Department').replace(/[^a-zA-Z0-9]+/g, '_');
  const dayCap = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1);
  const filename = `Master_Timetable_${deptSlug}_${dayCap}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
});

/**
 * Helper to compute faculty teaching vs free matrix for a selected day.
 */
async function resolveFacultyAvailabilityData(user, query = {}) {
  const isFYH = isFirstYearHod(user);
  const { weekday: currentWeekday, time: currentTime } = campusParts(new Date());
  const dayOfWeek = query.dayOfWeek ? String(query.dayOfWeek).toLowerCase() : currentWeekday || 'monday';

  // 1. Fetch faculties for this HOD
  let facultyFilter = { role: 'faculty', isActive: true };
  if (isFYH) {
    if (query.department) {
      const branchSlotsFaculty = await TimetableSlot.find({
        department: String(query.department),
        year: 1,
        isActive: true,
      }).distinct('faculty');
      facultyFilter.$or = [
        { department: FIRST_YEAR_HOD_DEPT },
        { _id: { $in: branchSlotsFaculty } },
      ];
    } else {
      facultyFilter.department = FIRST_YEAR_HOD_DEPT;
    }
  } else {
    facultyFilter.department = ownDepartment(user);
  }

  const faculties = await User.find(facultyFilter)
    .select('name email avatar department designation employeeId')
    .sort('name')
    .lean();

  const facultyIds = faculties.map((f) => f._id);

  // 2. Fetch distinct periods on dayOfWeek
  let periodFilter = { dayOfWeek, isActive: true };
  if (isFYH) {
    if (query.department) {
      periodFilter.department = String(query.department);
      periodFilter.year = 1;
    } else {
      periodFilter.$or = [{ department: FIRST_YEAR_HOD_DEPT }, { year: 1 }];
    }
  } else {
    periodFilter.department = ownDepartment(user);
  }

  let dayDeptSlots = await TimetableSlot.find(periodFilter).lean();
  if (dayDeptSlots.length === 0) {
    dayDeptSlots = await TimetableSlot.find({ dayOfWeek, isActive: true }).lean();
  }

  const periodMap = new Map();
  dayDeptSlots.forEach((s) => {
    const key = `${s.startTime}-${s.endTime}`;
    if (!periodMap.has(key)) {
      periodMap.set(key, {
        period: s.period,
        startTime: s.startTime,
        endTime: s.endTime,
        isBreak: Boolean(s.isBreak),
        breakLabel: s.breakLabel || '',
      });
    }
  });

  const periods = [...periodMap.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));

  // 3. Fetch all teaching slots for these faculties on dayOfWeek (college-wide)
  const facSlotsRaw = await populateSlot(
    TimetableSlot.find({
      faculty: { $in: facultyIds },
      dayOfWeek,
      isActive: true,
      isBreak: { $ne: true },
    })
  ).lean();
  await annotateWeek(facSlotsRaw);

  // 4. Map each faculty member across each period
  let freeNowCount = 0;
  let busyNowCount = 0;
  const isToday = dayOfWeek === currentWeekday;

  const facultyMatrix = faculties.map((f) => {
    const fSlots = facSlotsRaw.filter((s) => String(s.faculty?._id || s.faculty) === String(f._id));

    let freePeriods = 0;
    let busyPeriods = 0;
    let isFreeNow = true;

    const periodResults = periods.map((p) => {
      if (p.isBreak) {
        return {
          period: p.period,
          startTime: p.startTime,
          endTime: p.endTime,
          isBreak: true,
          status: 'break',
          breakLabel: p.breakLabel || 'Break',
        };
      }

      const matchingSlot = fSlots.find(
        (s) =>
          s.period === p.period ||
          (s.startTime <= p.startTime && s.endTime > p.startTime) ||
          (s.startTime >= p.startTime && s.startTime < p.endTime)
      );

      if (matchingSlot) {
        if (matchingSlot.holiday) {
          return {
            period: p.period,
            startTime: p.startTime,
            endTime: p.endTime,
            isBreak: false,
            status: 'holiday',
            title: matchingSlot.holiday.title,
            holiday: matchingSlot.holiday,
          };
        }

        busyPeriods += 1;
        if (isToday && currentTime >= p.startTime && currentTime < p.endTime) {
          isFreeNow = false;
        }

        return {
          period: p.period,
          startTime: p.startTime,
          endTime: p.endTime,
          isBreak: false,
          status: 'busy',
          slot: {
            _id: matchingSlot._id,
            subject: matchingSlot.subject,
            room: matchingSlot.room,
            department: matchingSlot.department,
            year: matchingSlot.year,
            section: matchingSlot.section,
            semester: matchingSlot.semester,
            period: matchingSlot.period,
            startTime: matchingSlot.startTime,
            endTime: matchingSlot.endTime,
          },
        };
      }

      freePeriods += 1;
      return {
        period: p.period,
        startTime: p.startTime,
        endTime: p.endTime,
        isBreak: false,
        status: 'free',
      };
    });

    if (isToday) {
      if (isFreeNow) freeNowCount += 1;
      else busyNowCount += 1;
    }

    return {
      _id: f._id,
      name: f.name,
      email: f.email,
      avatar: f.avatar,
      department: f.department,
      designation: f.designation || 'Faculty',
      employeeId: f.employeeId || '',
      freePeriods,
      busyPeriods,
      totalPeriods: freePeriods + busyPeriods,
      isFreeNow,
      periods: periodResults,
    };
  });

  // Filter if period parameter provided
  let filteredFaculties = facultyMatrix;
  if (query.period) {
    const targetPeriod = Number(query.period);
    filteredFaculties = filteredFaculties.filter((f) => {
      const p = f.periods.find((item) => item.period === targetPeriod && !item.isBreak);
      return p && p.status === 'free';
    });
  }

  if (query.freeNow === 'true' && isToday) {
    filteredFaculties = filteredFaculties.filter((f) => f.isFreeNow);
  }

  return {
    faculties: filteredFaculties,
    allFacultiesCount: facultyMatrix.length,
    periods,
    dayOfWeek,
    department: isFYH ? (query.department || FIRST_YEAR_HOD_DEPT) : user.department,
    isFirstYearHod: isFYH,
    isToday,
    stats: {
      totalFaculties: facultyMatrix.length,
      freeNow: freeNowCount,
      busyNow: busyNowCount,
    },
  };
}

/**
 * Faculty Availability Schedule: exclusively for HODs.
 * Shows which periods each department faculty member is teaching vs free on a specific day.
 */
export const getFacultyAvailability = asyncHandler(async (req, res) => {
  if (req.user.role !== 'hod') {
    throw new ApiError(403, 'Faculty availability schedule is only accessible to HODs');
  }
  if (req.query.format === 'pdf') {
    return exportFacultyAvailabilityPdf(req, res);
  }
  const result = await resolveFacultyAvailabilityData(req.user, req.query);
  res.json(result);
});

/**
 * Export Faculty Availability Schedule as official PDF in landscape A4.
 */
export const exportFacultyAvailabilityPdf = asyncHandler(async (req, res) => {
  if (req.user.role !== 'hod') {
    throw new ApiError(403, 'Faculty availability schedule is only accessible to HODs');
  }
  const { generateFacultyAvailabilityPdfBuffer } = await import('../services/facultyAvailabilityPdf.js');
  const { weekday: currentWeekday } = campusParts(new Date());
  const dayOfWeek = req.query.dayOfWeek ? String(req.query.dayOfWeek).toLowerCase() : currentWeekday || 'monday';
  const data = await resolveFacultyAvailabilityData(req.user, { ...req.query, dayOfWeek });

  const buffer = await generateFacultyAvailabilityPdfBuffer({
    ...data,
    dayOfWeek,
  });

  const deptSlug = (data.department || 'Department').replace(/[^a-zA-Z0-9]+/g, '_');
  const dayCap = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1);
  const filename = `Faculty_Availability_${deptSlug}_${dayCap}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
});

/**
 * "My Schedule": the classes the authenticated user personally teaches,
 * across the week, with their full academic context. Always the caller's own
 * assignments — there is no way to ask for another faculty member's.
 */
export const getMySchedule = asyncHandler(async (req, res) => {
  const filter = { faculty: req.user._id, isActive: true, isBreak: { $ne: true } };
  if (req.query.semester) filter.semester = Number(req.query.semester);
  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  const semesters = await TimetableSlot.find({ faculty: req.user._id, isActive: true, isBreak: { $ne: true } }).distinct('semester');
  const week = await annotateWeek(slots);
  res.json({ slots: sortSlots(slots), semesters: semesters.sort((a, b) => a - b), week });
});

export const getSectionTimetable = asyncHandler(async (req, res) => {
  // The role's scope is applied first, then the requested section — so a
  // section outside the caller's authorization simply matches nothing.
  const scope = await timetableReadScope(req.user, req.query);
  if (!scope) return res.json([]);
  const section = String(req.params.section).toUpperCase();
  // A student's scope is their own class, and a sibling section of the same
  // year is still somebody else's timetable.
  if (STUDENT_ROLES.includes(req.user.role) && scope.section !== section) return res.json([]);
  const filter = { ...scope, section };
  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  await annotateWeek(slots);
  res.json(sortSlots(slots));
});

export const getFacultyTimetable = asyncHandler(async (req, res) => {
  const { user } = req;
  const self = String(req.params.id) === String(user._id);
  // Faculty (and students) may only ever read their own schedule; an HOD may
  // read one of their own department's, within that department.
  if (!self && (STUDENT_ROLES.includes(user.role) || user.role === 'faculty')) {
    throw new ApiError(403, 'You can only view your own teaching schedule');
  }
  const filter = { faculty: req.params.id, isActive: true };
  if (!self && user.role === 'hod') filter.department = ownDepartment(user);
  if (req.query.semester) filter.semester = Number(req.query.semester);
  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  await annotateWeek(slots);
  res.json(sortSlots(slots));
});

/** Current and next class for the user, on the campus clock (APP_TIMEZONE). */
export const getCurrentClass = asyncHandler(async (req, res) => {
  const user = req.user;
  const { weekday, time } = campusParts(new Date());

  const filter = { dayOfWeek: weekday, isActive: true };
  if (['student', 'club_admin'].includes(user.role) && user.section && user.department && user.year) {
    filter.section = user.section;
    filter.department = user.department;
    filter.year = user.year;
    if (user.semester) filter.semester = user.semester;
  } else if (user.role === 'faculty') {
    filter.faculty = user._id;
  } else {
    return res.json({ current: null, next: null, today: [], weekday, time });
  }

  const slots = await populateSlot(TimetableSlot.find(filter)).sort({ period: 1 }).lean();
  await annotateWeek(slots);
  let current = null;
  let next = null;
  // A period cancelled by a holiday is never "current" or "next".
  for (const slot of slots) {
    if (slot.holiday) continue;
    if (slot.startTime <= time && slot.endTime > time) current = slot;
    else if (slot.startTime > time && !slot.isBreak && !next) next = slot;
  }
  // The holiday for the viewer's own class today (students), or the one that
  // empties a faculty member's whole day.
  const holiday = STUDENT_ROLES.includes(user.role)
    ? toHolidayApi(await findHoliday({ department: user.department, year: user.year, section: user.section }, toDay(clock.now())))
    : slots.length && slots.every((s) => s.holiday)
      ? slots[0].holiday
      : null;
  res.json({ current, next, today: slots, weekday, time, holiday });
});

// ── Timetable writes (admin) ───────────────────────────────────────

const overlaps = (startTime, endTime) => ({ startTime: { $lt: endTime }, endTime: { $gt: startTime } });

/** Reject obvious clashes: same section, same faculty or same room at overlapping times. */
async function assertNoConflict(slot, excludeId) {
  const base = { isActive: true, dayOfWeek: slot.dayOfWeek, ...overlaps(slot.startTime, slot.endTime) };
  if (excludeId) base._id = { $ne: excludeId };

  const [sectionClash, facultyClash, roomClash] = await Promise.all([
    TimetableSlot.findOne({ ...base, section: slot.section, department: slot.department, year: slot.year, semester: slot.semester }).populate('subject', 'code').lean(),
    slot.isBreak || !slot.faculty ? null : TimetableSlot.findOne({ ...base, faculty: slot.faculty, isBreak: { $ne: true } }).populate('subject', 'code').lean(),
    slot.isBreak || !slot.room ? null : TimetableSlot.findOne({ ...base, room: slot.room, isBreak: { $ne: true } }).populate('subject', 'code').lean(),
  ]);
  const at = (c) => `${c.dayOfWeek} ${c.startTime}–${c.endTime}`;
  if (sectionClash) throw new ApiError(409, `Section ${slot.section} already has ${sectionClash.subject?.code || sectionClash.breakLabel || 'a slot'} on ${at(sectionClash)}`);
  if (facultyClash) throw new ApiError(409, `This faculty is already assigned during this time — ${facultyClash.subject?.code}, ${facultyClash.department} section ${facultyClash.section}, ${at(facultyClash)}`);
  if (roomClash) throw new ApiError(409, `Room ${slot.room} is already booked for ${roomClash.subject?.code} (section ${roomClash.section}) on ${at(roomClash)}`);
}

// Who can be scheduled to teach a period — any department, college-wide.
const TEACHING_ROLES = ['faculty', 'hod'];

async function assertSubjectFaculty(slot) {
  if (slot.isBreak) return;
  // The subject and faculty lookups are independent, so fetch them in one
  // parallel round trip rather than two sequential ones (matters on Atlas).
  const [subject, faculty] = await Promise.all([
    Subject.findOne({ _id: slot.subject, isActive: true }).lean(),
    // Cross-department teaching is allowed, and any active faculty/HOD account can
    // be scheduled for any year/section college-wide — a faculty member's declared
    // teachingYears/teachingSections (used elsewhere as a class-in-charge fallback)
    // do not restrict who can be assigned a period here.
    User.findOne({ _id: slot.faculty, role: { $in: TEACHING_ROLES }, isActive: true }).select('name').lean(),
  ]);
  if (!subject) throw new ApiError(404, 'Subject not found');
  if (subject.department !== slot.department && !(subject.department === FIRST_YEAR_HOD_DEPT && (slot.year === 1 || [1, 2].includes(Number(slot.semester))))) {
    throw new ApiError(422, `${subject.code} belongs to ${subject.department}, not ${slot.department}`);
  }
  if (Number(subject.semester) !== Number(slot.semester)) {
    throw new ApiError(422, `${subject.code} is a semester ${subject.semester} subject, not semester ${slot.semester}`);
  }
  if (subject.sections?.length && !subject.sections.map((s) => s.toUpperCase()).includes(slot.section)) {
    throw new ApiError(422, `${subject.code} is not taught to section ${slot.section}`);
  }
  if (!faculty) throw new ApiError(422, 'Choose an active faculty member');
}

/**
 * Attendance marking is gated on Subject.faculty, so a faculty member scheduled
 * for a period (possibly from another department) is added to that subject.
 */
async function linkFacultyToSubject(slot) {
  if (slot.isBreak || !slot.subject || !slot.faculty) return;
  await Subject.updateOne({ _id: slot.subject }, { $addToSet: { faculty: slot.faculty } });
}

/** Every active teaching account in the college, for the "Add period" picker. */
export const listFacultyOptions = asyncHandler(async (_req, res) => {
  const faculty = await User.find({ role: { $in: TEACHING_ROLES }, isActive: true })
    .select('name department')
    .sort({ name: 1 })
    .lean();
  res.json(faculty.map((f) => ({ _id: f._id, name: f.name, department: f.department || '' })));
});

export const createSlot = asyncHandler(async (req, res) => {
  const data = pick(req.body, SLOT_FIELDS);
  data.section = String(data.section).trim().toUpperCase();
  if (data.semester && data.year == null) data.year = yearOfSemester(data.semester);
  if (req.user.role === 'hod') {
    if (isFirstYearHod(req.user)) {
      assertOwnDepartment(req.user, data.department, data.year, data.semester);
    } else {
      data.department = req.user.department;
      assertOwnDepartment(req.user, data.department, data.year, data.semester);
    }
  }
  if (data.isBreak) {
    delete data.subject;
    delete data.faculty;
  }
  await assertSubjectFaculty(data);
  await assertNoConflict(data);
  // Only classes are periods: a break never takes a class number (it gets a
  // hidden spare key), and a class sent without a number gets the next one.
  if (data.isBreak) data.period = await spareBreakPeriod(data);
  else if (data.period == null) data.period = await suggestClassPeriod(data);
  await assertPeriodOrder(data);
  const slot = await TimetableSlot.create(data);
  // The faculty→subject link write and the populated re-read don't depend on
  // each other, so run them together instead of back to back.
  const [, populated] = await Promise.all([linkFacultyToSubject(slot), populateSlot(TimetableSlot.findById(slot._id))]);
  logActivity(req, 'timetable.create', { entityType: 'timetable', entityId: slot._id, summary: `${slot.section} ${slot.dayOfWeek} P${slot.period}` });
  broadcastTimetable({ section: slot.section, department: slot.department });
  res.status(201).json(populated);
});

export const updateSlot = asyncHandler(async (req, res) => {
  const slot = await TimetableSlot.findById(req.params.id);
  if (!slot || !slot.isActive) throw new ApiError(404, 'Timetable slot not found');
  assertOwnDepartment(req.user, slot.department, slot.year, slot.semester);
  const data = pick(req.body, SLOT_FIELDS);
  if (data.section) data.section = String(data.section).trim().toUpperCase();
  if (data.semester !== undefined && data.year === undefined) data.year = yearOfSemester(data.semester);
  if (req.user.role === 'hod') {
    if (isFirstYearHod(req.user)) {
      assertOwnDepartment(req.user, data.department || slot.department, data.year ?? slot.year, data.semester ?? slot.semester);
    } else {
      data.department = req.user.department;
      assertOwnDepartment(req.user, data.department, data.year ?? slot.year, data.semester ?? slot.semester);
    }
  }
  const before = { section: slot.section, department: slot.department };
  const AUDITED = ['subject', 'faculty', 'dayOfWeek', 'period', 'startTime', 'endTime', 'room', 'section', 'department', 'semester', 'year'];
  const prior = Object.fromEntries(AUDITED.map((k) => [k, slot[k] == null ? '' : String(slot[k])]));
  const wasBreak = Boolean(slot.isBreak);
  Object.assign(slot, data);
  if (slot.isBreak) {
    slot.subject = undefined;
    slot.faculty = undefined;
  }
  await assertSubjectFaculty(slot);
  await assertNoConflict(slot, slot._id);
  if (slot.isBreak) slot.period = await spareBreakPeriod(slot, slot._id);
  else if (wasBreak && data.period === undefined) slot.period = await suggestClassPeriod(slot, slot._id);
  await assertPeriodOrder(slot, slot._id);
  await slot.save();
  const linked = linkFacultyToSubject(slot);
  // Past attendance keeps its own session snapshot; only future sessions pick this up.
  const diff = AUDITED.filter((k) => prior[k] !== (slot[k] == null ? '' : String(slot[k]))).map((k) => `${k}: ${prior[k] || '—'}→${slot[k] ?? '—'}`);
  logActivity(req, 'timetable.changed', {
    entityType: 'timetable',
    entityId: slot._id,
    summary: `[${req.user.role}] ${slot.department}-${slot.section} ${slot.dayOfWeek} P${slot.period}${diff.length ? ` · ${diff.join('; ')}` : ' · no changes'}`,
  });
  broadcastTimetable(before);
  if (before.section !== slot.section) broadcastTimetable({ section: slot.section, department: slot.department });
  const [, populated] = await Promise.all([linked, populateSlot(TimetableSlot.findById(slot._id))]);
  res.json(populated);
});

export const deleteSlot = asyncHandler(async (req, res) => {
  const existing = await TimetableSlot.findOne({ _id: req.params.id, isActive: true }).select('department year semester').lean();
  if (!existing) throw new ApiError(404, 'Timetable slot not found');
  assertOwnDepartment(req.user, existing.department, existing.year, existing.semester);
  const slot = await TimetableSlot.findOneAndUpdate({ _id: req.params.id, isActive: true }, { isActive: false });
  logActivity(req, 'timetable.delete', { entityType: 'timetable', entityId: slot._id, summary: `${slot.section} ${slot.dayOfWeek} P${slot.period}` });
  broadcastTimetable({ section: slot.section, department: slot.department });
  res.json({ message: 'Slot removed' });
});
