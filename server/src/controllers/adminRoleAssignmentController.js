import User from '../models/User.js';
import TimetableSlot from '../models/TimetableSlot.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { logSecurity } from '../utils/securityLog.js';
import { notifyUsers } from '../utils/notify.js';
import { ACADEMIC_YEARS, DEPARTMENTS, SECTIONS, SEMESTERS, yearOfSemester } from '../constants.js';
import { STUDENT_ROLES } from '../utils/academicScope.js';
import { revokeSessions } from './authController.js';

const norm = (s) => String(s || '').trim().toUpperCase();
const classKey = (c) => `${c.department}|${c.year}|${norm(c.section)}|${c.semester}`;

/**
 * Overview of all classes, assigned Class In-Charges, Department HODs,
 * and available faculty members for assignment in the Admin panel.
 */
export const getRoleAssignmentsOverview = asyncHandler(async (_req, res) => {
  const [studentCounts, timetableSlots, assignedFaculty, allFaculty, hodUsers] = await Promise.all([
    // Student counts aggregated by exact class
    User.aggregate([
      {
        $match: {
          role: { $in: STUDENT_ROLES },
          department: { $in: DEPARTMENTS },
          year: { $in: ACADEMIC_YEARS },
          section: { $ne: null, $nin: ['', null] },
        },
      },
      {
        $group: {
          _id: {
            department: '$department',
            year: '$year',
            section: '$section',
            semester: '$semester',
          },
          count: { $sum: 1 },
        },
      },
    ]),
    // Distinct classes actively running in timetable
    TimetableSlot.aggregate([
      {
        $match: {
          department: { $in: DEPARTMENTS },
          isActive: true,
          isBreak: { $ne: true },
        },
      },
      {
        $group: {
          _id: {
            department: '$department',
            year: '$year',
            section: '$section',
            semester: '$semester',
          },
        },
      },
    ]),
    // Active faculty currently designated as Class In-Charge
    User.find({
      role: 'faculty',
      department: { $in: DEPARTMENTS },
      inChargeYear: { $ne: null },
      inChargeSemester: { $ne: null },
      section: { $ne: null, $nin: ['', null] },
    })
      .select('name title gender email employeeId avatar department section inChargeYear inChargeSemester isActive')
      .lean(),
    // All active faculty for selection dropdowns
    User.find({
      role: 'faculty',
      isActive: true,
    })
      .select('name title gender email employeeId avatar department section inChargeYear inChargeSemester')
      .sort({ department: 1, name: 1 })
      .lean(),
    // All current HODs
    User.find({
      role: 'hod',
      department: { $in: DEPARTMENTS },
    })
      .select('name title gender email employeeId avatar department phone isActive')
      .lean(),
  ]);

  // Index student counts
  const studentCountMap = new Map();
  studentCounts.forEach((s) => {
    const sem = s._id.semester || (s._id.year ? s._id.year * 2 : 1);
    const k = `${s._id.department}|${s._id.year}|${norm(s._id.section)}|${sem}`;
    studentCountMap.set(k, (studentCountMap.get(k) || 0) + s.count);
  });

  // Index assigned faculty by class
  const assignedFacultyMap = new Map();
  assignedFaculty.forEach((f) => {
    const k = `${f.department}|${f.inChargeYear}|${norm(f.section)}|${f.inChargeSemester}`;
    assignedFacultyMap.set(k, f);
  });

  // Set of all discovered classes
  const classesMap = new Map();

  // Helper to register a class candidate
  const registerClass = (department, year, section, semester) => {
    const normSec = norm(section);
    const numYear = Number(year);
    const numSem = Number(semester) || numYear * 2;
    if (!department || !DEPARTMENTS.includes(department)) return;
    if (!numYear || !ACADEMIC_YEARS.includes(numYear)) return;
    if (!normSec || !SECTIONS.includes(normSec)) return;
    if (!numSem || !SEMESTERS.includes(numSem)) return;
    if (yearOfSemester(numSem) !== numYear) return;

    const k = `${department}|${numYear}|${normSec}|${numSem}`;
    if (!classesMap.has(k)) {
      classesMap.set(k, {
        department,
        year: numYear,
        section: normSec,
        semester: numSem,
      });
    }
  };

  studentCounts.forEach((s) => {
    registerClass(s._id.department, s._id.year, s._id.section, s._id.semester);
  });

  timetableSlots.forEach((t) => {
    registerClass(t._id.department, t._id.year, t._id.section, t._id.semester);
  });

  assignedFaculty.forEach((f) => {
    registerClass(f.department, f.inChargeYear, f.section, f.inChargeSemester);
  });

  // Ensure standard sections exist for all departments and years so new classes can be assigned
  DEPARTMENTS.forEach((dept) => {
    ACADEMIC_YEARS.forEach((yr) => {
      ['A', 'B'].forEach((sec) => {
        const sem = yr * 2; // Default to current even semester of the year
        registerClass(dept, yr, sec, sem);
      });
    });
  });

  // Build sorted classes list with student counts and in-charge info
  const classes = [...classesMap.values()]
    .map((c) => {
      const k = classKey(c);
      const studentCount = studentCountMap.get(k) || 0;
      const inCharge = assignedFacultyMap.get(k) || null;
      return {
        ...c,
        studentCount,
        inCharge,
      };
    })
    .sort((a, b) => {
      if (a.department !== b.department) return a.department.localeCompare(b.department);
      if (a.year !== b.year) return a.year - b.year;
      if (a.section !== b.section) return a.section.localeCompare(b.section);
      return a.semester - b.semester;
    });

  // Build HODs map by department
  const hodMap = new Map();
  hodUsers.forEach((h) => hodMap.set(h.department, h));
  const hods = DEPARTMENTS.map((dept) => ({
    department: dept,
    hod: hodMap.get(dept) || null,
  }));

  // Build faculty directory with inCharge summary
  const facultyList = allFaculty.map((f) => {
    const hasInCharge = f.inChargeYear != null && f.inChargeSemester != null && f.section;
    return {
      _id: f._id,
      name: f.name,
      title: f.title,
      gender: f.gender,
      email: f.email,
      employeeId: f.employeeId,
      avatar: f.avatar,
      department: f.department,
      inCharge: hasInCharge
        ? {
            department: f.department,
            year: f.inChargeYear,
            semester: f.inChargeSemester,
            section: norm(f.section),
          }
        : null,
    };
  });

  res.json({
    classes,
    hods,
    facultyList,
  });
});

/**
 * Assign a faculty member as Class In-Charge of a specific class.
 * If another faculty member was in-charge, they are safely vacated with zero data loss.
 */
export const assignClassInCharge = asyncHandler(async (req, res) => {
  const { facultyId, department, year, section, semester } = req.body;
  const numYear = Number(year);
  const numSem = Number(semester);
  const normSec = norm(section);

  if (!facultyId) throw new ApiError(400, 'Faculty ID is required');
  if (!department || !DEPARTMENTS.includes(department)) throw new ApiError(400, 'Valid department is required');
  if (!numYear || !ACADEMIC_YEARS.includes(numYear)) throw new ApiError(400, 'Valid year (1–4) is required');
  if (!normSec || !SECTIONS.includes(normSec)) throw new ApiError(400, 'Valid section is required');
  if (!numSem || !SEMESTERS.includes(numSem)) throw new ApiError(400, 'Valid semester (1–8) is required');
  if (yearOfSemester(numSem) !== numYear) {
    throw new ApiError(422, `Semester ${numSem} belongs to year ${yearOfSemester(numSem)}, not year ${numYear}`);
  }

  const faculty = await User.findById(facultyId).select('+tokenVersion');
  if (!faculty) throw new ApiError(404, 'Faculty not found');
  if (faculty.role !== 'faculty') throw new ApiError(400, 'Only faculty members can be assigned as Class In-Charge');

  // Vacate any existing in-charge for this exact class
  const previousInCharge = await User.findOne({
    role: 'faculty',
    _id: { $ne: faculty._id },
    department,
    inChargeYear: numYear,
    inChargeSemester: numSem,
    section: normSec,
  }).select('+tokenVersion');

  if (previousInCharge) {
    previousInCharge.inChargeYear = undefined;
    previousInCharge.inChargeSemester = undefined;
    previousInCharge.section = undefined;
    previousInCharge.tokenVersion = (previousInCharge.tokenVersion || 0) + 1;
    await previousInCharge.save();
    await revokeSessions({ user: previousInCharge._id }, 'class_in_charge_vacated');
    logSecurity(req, 'CLASS_IN_CHARGE_CHANGED', {
      target: previousInCharge,
      details: { action: 'vacated_by_reassignment', class: { department, year: numYear, semester: numSem, section: normSec } },
    });
    notifyUsers([previousInCharge._id], {
      type: 'system',
      title: 'Class In-Charge Assignment Relieved',
      message: `Your Class In-Charge assignment for ${department} Year ${numYear} Section ${normSec} has been reassigned.`,
    });
  }

  // Assign to target faculty
  faculty.department = department;
  faculty.inChargeYear = numYear;
  faculty.inChargeSemester = numSem;
  faculty.section = normSec;
  faculty.tokenVersion = (faculty.tokenVersion || 0) + 1;
  await faculty.save();
  await revokeSessions({ user: faculty._id }, 'class_in_charge_assigned');

  logActivity(req, 'admin.class_in_charge_assign', {
    entityType: 'user',
    entityId: faculty._id,
    summary: `${faculty.name} assigned Class In-Charge of ${department} Yr ${numYear}-${normSec}`,
  });
  logSecurity(req, 'CLASS_IN_CHARGE_CHANGED', {
    target: faculty,
    details: { action: 'assigned', class: { department, year: numYear, semester: numSem, section: normSec } },
  });
  notifyUsers([faculty._id], {
    type: 'system',
    title: 'Class In-Charge Assignment',
    message: `You are now the Class In-Charge of ${department} Year ${numYear} Section ${normSec}.`,
  });

  res.json({
    message: 'Class In-Charge assigned successfully',
    faculty: {
      _id: faculty._id,
      name: faculty.name,
      department: faculty.department,
      inChargeYear: faculty.inChargeYear,
      inChargeSemester: faculty.inChargeSemester,
      section: faculty.section,
    },
  });
});

/**
 * Atomically swap Class In-Charge assignments between two faculty members.
 * Guarantees ZERO data loss:
 * - Student accounts, attendance records, sessions, and OD requests are untouched.
 * - Staff 1 immediately sees Staff 2's class data, and vice versa.
 */
export const swapClassInCharge = asyncHandler(async (req, res) => {
  const { faculty1Id, faculty2Id } = req.body;
  if (!faculty1Id || !faculty2Id) throw new ApiError(400, 'Both faculty IDs are required');
  if (String(faculty1Id) === String(faculty2Id)) {
    throw new ApiError(400, 'Cannot swap a faculty member with themselves');
  }

  const [f1, f2] = await Promise.all([
    User.findById(faculty1Id).select('+tokenVersion'),
    User.findById(faculty2Id).select('+tokenVersion'),
  ]);

  if (!f1 || !f2) throw new ApiError(404, 'One or both faculty members not found');
  if (f1.role !== 'faculty' || f2.role !== 'faculty') {
    throw new ApiError(400, 'Both users must have the faculty role');
  }

  const f1Scope =
    f1.inChargeYear != null && f1.inChargeSemester != null && f1.section
      ? {
          department: f1.department,
          year: f1.inChargeYear,
          semester: f1.inChargeSemester,
          section: norm(f1.section),
        }
      : null;

  const f2Scope =
    f2.inChargeYear != null && f2.inChargeSemester != null && f2.section
      ? {
          department: f2.department,
          year: f2.inChargeYear,
          semester: f2.inChargeSemester,
          section: norm(f2.section),
        }
      : null;

  if (!f1Scope && !f2Scope) {
    throw new ApiError(400, 'Neither faculty member currently has a Class In-Charge assignment to swap');
  }

  // Perform atomic swap
  if (f2Scope) {
    f1.department = f2Scope.department;
    f1.inChargeYear = f2Scope.year;
    f1.inChargeSemester = f2Scope.semester;
    f1.section = f2Scope.section;
  } else {
    f1.inChargeYear = undefined;
    f1.inChargeSemester = undefined;
    f1.section = undefined;
  }
  f1.tokenVersion = (f1.tokenVersion || 0) + 1;

  if (f1Scope) {
    f2.department = f1Scope.department;
    f2.inChargeYear = f1Scope.year;
    f2.inChargeSemester = f1Scope.semester;
    f2.section = f1Scope.section;
  } else {
    f2.inChargeYear = undefined;
    f2.inChargeSemester = undefined;
    f2.section = undefined;
  }
  f2.tokenVersion = (f2.tokenVersion || 0) + 1;

  await Promise.all([f1.save(), f2.save()]);
  await Promise.all([
    revokeSessions({ user: f1._id }, 'class_in_charge_swapped'),
    revokeSessions({ user: f2._id }, 'class_in_charge_swapped'),
  ]);

  logActivity(req, 'admin.class_in_charge_swap', {
    entityType: 'user',
    entityId: f1._id,
    summary: `Swapped Class In-Charge roles between ${f1.name} and ${f2.name}`,
  });
  logSecurity(req, 'CLASS_IN_CHARGE_CHANGED', {
    target: f1,
    details: { action: 'swap', counterpart: f2._id, newScope: f2Scope },
  });
  logSecurity(req, 'CLASS_IN_CHARGE_CHANGED', {
    target: f2,
    details: { action: 'swap', counterpart: f1._id, newScope: f1Scope },
  });

  if (f2Scope) {
    notifyUsers([f1._id], {
      type: 'system',
      title: 'Class In-Charge Handover',
      message: `You are now the Class In-Charge of ${f2Scope.department} Year ${f2Scope.year} Section ${f2Scope.section}.`,
    });
  } else {
    notifyUsers([f1._id], {
      type: 'system',
      title: 'Class In-Charge Relieved',
      message: 'You have been relieved of your Class In-Charge duties and are now general faculty.',
    });
  }

  if (f1Scope) {
    notifyUsers([f2._id], {
      type: 'system',
      title: 'Class In-Charge Handover',
      message: `You are now the Class In-Charge of ${f1Scope.department} Year ${f1Scope.year} Section ${f1Scope.section}.`,
    });
  } else {
    notifyUsers([f2._id], {
      type: 'system',
      title: 'Class In-Charge Relieved',
      message: 'You have been relieved of your Class In-Charge duties and are now general faculty.',
    });
  }

  res.json({
    message: 'Class In-Charge assignments swapped successfully with zero data loss',
    faculty1: {
      _id: f1._id,
      name: f1.name,
      inCharge: f2Scope,
    },
    faculty2: {
      _id: f2._id,
      name: f2.name,
      inCharge: f1Scope,
    },
  });
});

/**
 * Demote / Unassign a Class In-Charge back to regular faculty.
 * Guarantees ZERO data loss:
 * - Historical data remains completely intact.
 * - The faculty member will simply no longer see the class data on their dashboard.
 */
export const unassignClassInCharge = asyncHandler(async (req, res) => {
  const { facultyId } = req.body;
  if (!facultyId) throw new ApiError(400, 'Faculty ID is required');

  const faculty = await User.findById(facultyId).select('+tokenVersion');
  if (!faculty) throw new ApiError(404, 'Faculty not found');
  if (faculty.role !== 'faculty') throw new ApiError(400, 'User is not a faculty member');

  const prevScope = {
    department: faculty.department,
    year: faculty.inChargeYear,
    semester: faculty.inChargeSemester,
    section: faculty.section,
  };

  faculty.inChargeYear = undefined;
  faculty.inChargeSemester = undefined;
  faculty.section = undefined;
  faculty.tokenVersion = (faculty.tokenVersion || 0) + 1;
  await faculty.save();
  await revokeSessions({ user: faculty._id }, 'class_in_charge_unassigned');

  logActivity(req, 'admin.class_in_charge_unassign', {
    entityType: 'user',
    entityId: faculty._id,
    summary: `${faculty.name} relieved of Class In-Charge duties`,
  });
  logSecurity(req, 'CLASS_IN_CHARGE_CHANGED', {
    target: faculty,
    details: { action: 'unassigned', previousScope: prevScope },
  });
  notifyUsers([faculty._id], {
    type: 'system',
    title: 'Class In-Charge Relieved',
    message: 'You have been relieved of Class In-Charge responsibilities and reverted to department faculty.',
  });

  res.json({
    message: 'Class In-Charge successfully relieved with zero data loss',
    faculty: {
      _id: faculty._id,
      name: faculty.name,
      role: faculty.role,
    },
  });
});

/**
 * Assign or transfer the HOD role for a department.
 * - If target faculty was a Class In-Charge, their class in-charge role is auto-cleared.
 * - If there was a previous HOD, they are safely demoted to regular faculty.
 * - Dashboard updates to HOD dashboard immediately.
 */
export const setDepartmentHod = asyncHandler(async (req, res) => {
  const { department, facultyId } = req.body;
  if (!department || !DEPARTMENTS.includes(department)) throw new ApiError(400, 'Valid department is required');
  if (!facultyId) throw new ApiError(400, 'Faculty ID is required');

  const candidate = await User.findById(facultyId).select('+tokenVersion');
  if (!candidate) throw new ApiError(404, 'Selected faculty not found');

  // Demote previous HOD of this department if different
  const previousHod = await User.findOne({
    role: 'hod',
    department,
    _id: { $ne: candidate._id },
  }).select('+tokenVersion');

  if (previousHod) {
    previousHod.role = 'faculty';
    previousHod.tokenVersion = (previousHod.tokenVersion || 0) + 1;
    await previousHod.save();
    await revokeSessions({ user: previousHod._id }, 'hod_reassigned_to_faculty');
    logActivity(req, 'admin.hod_demote', {
      entityType: 'user',
      entityId: previousHod._id,
      summary: `${previousHod.name} demoted from HOD to Faculty (${department})`,
    });
    logSecurity(req, 'ROLE_CHANGED', {
      target: previousHod,
      details: { oldRole: 'hod', newRole: 'faculty', department },
    });
    notifyUsers([previousHod._id], {
      type: 'system',
      title: 'Department Role Update',
      message: `Your role has been updated to Faculty in ${department}.`,
    });
  }

  // Promote candidate to HOD; auto-clear any class in-charge assignment
  candidate.role = 'hod';
  candidate.department = department;
  candidate.inChargeYear = undefined;
  candidate.inChargeSemester = undefined;
  candidate.section = undefined;
  candidate.tokenVersion = (candidate.tokenVersion || 0) + 1;
  await candidate.save();
  await revokeSessions({ user: candidate._id }, 'promoted_to_hod');

  logActivity(req, 'admin.hod_assign', {
    entityType: 'user',
    entityId: candidate._id,
    summary: `${candidate.name} promoted to HOD of ${department}`,
  });
  logSecurity(req, 'ROLE_CHANGED', {
    target: candidate,
    details: { oldRole: 'faculty', newRole: 'hod', department },
  });
  notifyUsers([candidate._id], {
    type: 'system',
    title: 'Department Role Update',
    message: `Congratulations! You have been appointed as HOD of ${department}.`,
  });

  res.json({
    message: `HOD of ${department} assigned successfully`,
    hod: {
      _id: candidate._id,
      name: candidate.name,
      department: candidate.department,
      role: candidate.role,
    },
    previousHod: previousHod
      ? {
          _id: previousHod._id,
          name: previousHod.name,
          role: previousHod.role,
        }
      : null,
  });
});

/**
 * Demote an HOD to regular department faculty.
 * Dashboard automatically switches back to staff dashboard with zero data loss.
 */
export const demoteDepartmentHod = asyncHandler(async (req, res) => {
  const { hodId } = req.body;
  if (!hodId) throw new ApiError(400, 'HOD ID is required');

  const hod = await User.findById(hodId).select('+tokenVersion');
  if (!hod) throw new ApiError(404, 'User not found');
  if (hod.role !== 'hod') throw new ApiError(400, 'User is not currently an HOD');

  const department = hod.department;
  hod.role = 'faculty';
  hod.tokenVersion = (hod.tokenVersion || 0) + 1;
  await hod.save();
  await revokeSessions({ user: hod._id }, 'hod_demoted_to_faculty');

  logActivity(req, 'admin.hod_demote', {
    entityType: 'user',
    entityId: hod._id,
    summary: `${hod.name} demoted from HOD to Faculty (${department})`,
  });
  logSecurity(req, 'ROLE_CHANGED', {
    target: hod,
    details: { oldRole: 'hod', newRole: 'faculty', department },
  });
  notifyUsers([hod._id], {
    type: 'system',
    title: 'Department Role Update',
    message: `Your role has been updated to Faculty in ${department}. Your dashboard has switched to Staff Dashboard.`,
  });

  res.json({
    message: `HOD demoted to faculty in ${department} successfully`,
    user: {
      _id: hod._id,
      name: hod.name,
      department: hod.department,
      role: hod.role,
    },
  });
});

