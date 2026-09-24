/**
 * DEVELOPMENT / DEMO DATA ONLY — academic records for the demo campus.
 *
 * Adds class sections to demo students, a few demo classmates, CSE semester-5
 * subjects, a weekly timetable and ~4 weeks of attendance so the timetable,
 * attendance and analytics screens have something to show. Idempotent: running
 * it twice does not duplicate anything. Nothing in the application reads from
 * this file — production data is entered through the admin screens.
 *
 * Standalone: `npm run seed:academic` (does NOT wipe other data).
 * Also called at the end of `npm run seed`.
 */
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import User from '../models/User.js';
import Subject from '../models/Subject.js';
import TimetableSlot from '../models/TimetableSlot.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import { addDays, today, weekdayOf } from '../utils/dates.js';

const PASSWORD = 'Password@123';
const SECTION = 'A';
const DEPT = 'CSE';
const SEMESTER = 5;

const CLASSMATES = [
  ['Harini Subramanian', 'harini@campus.edu'],
  ['Manoj Kumar', 'manoj@campus.edu'],
  ['Sanjana Iyer', 'sanjana@campus.edu'],
  ['Deepak Varma', 'deepak@campus.edu'],
  ['Kavya Reddy', 'kavya@campus.edu'],
  ['Naveen Prakash', 'naveen@campus.edu'],
];

const SUBJECTS = [
  { code: 'CS501', name: 'Compiler Design', type: 'theory', credits: 4 },
  { code: 'CS502', name: 'Computer Networks', type: 'theory', credits: 4 },
  { code: 'CS503', name: 'Database Management Systems', type: 'theory', credits: 3 },
  { code: 'CS504', name: 'Software Engineering', type: 'theory', credits: 3 },
  { code: 'CS505', name: 'Networks Lab', type: 'lab', credits: 2 },
];

const PERIODS = [
  [1, '09:00', '09:50'],
  [2, '09:50', '10:40'],
  [3, '11:00', '11:50'],
  [4, '11:50', '12:40'],
  [5, '13:30', '14:20'],
  [6, '14:20', '15:10'],
];

// Weekly grid: subject code per period (null = free period).
const WEEK = {
  monday: ['CS501', 'CS502', 'CS503', 'CS504', 'CS505', 'CS505'],
  tuesday: ['CS502', 'CS501', 'CS504', 'CS503', null, null],
  wednesday: ['CS503', 'CS504', 'CS501', 'CS502', 'CS501', null],
  thursday: ['CS504', 'CS503', 'CS502', 'CS501', 'CS505', 'CS505'],
  friday: ['CS501', 'CS502', 'CS503', 'CS504', null, null],
  saturday: ['CS502', 'CS503', null, null, null, null],
};

// Deterministic pseudo-random so re-seeding produces the same attendance.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export async function seedAcademic({ log = console.log } = {}) {
  const faculty = await User.findOne({ email: 'faculty@campus.edu' });
  const faculty2 = await User.findOne({ email: 'meera@campus.edu' });
  if (!faculty) {
    log('[seed:academic] demo faculty not found — run `npm run seed` first');
    return;
  }

  // Sections / semesters for existing demo students: section A, semester from year.
  const demoStudents = await User.find({ role: { $in: ['student', 'club_admin'] }, email: /@campus\.edu$/, year: { $gte: 1 } });
  for (const s of demoStudents) {
    let changed = false;
    if (!s.section) {
      s.section = SECTION;
      changed = true;
    }
    if (!s.semester && s.year) {
      s.semester = s.year * 2 - 1;
      changed = true;
    }
    if (changed) await s.save({ validateModifiedOnly: true });
  }

  // Demo classmates for CSE-A semester 5 so a class roster has more than one student.
  let added = 0;
  for (const [i, [name, email]] of CLASSMATES.entries()) {
    if (await User.exists({ email })) continue;
    await User.create({
      name,
      email,
      password: PASSWORD,
      role: 'student',
      department: DEPT,
      year: 3,
      semester: SEMESTER,
      section: SECTION,
      rollNo: `23CS${String(201 + i)}`,
      bio: 'CSE student · Year 3',
      interests: ['technical'],
    });
    added += 1;
  }
  log(`[seed:academic] sections assigned; ${added} demo classmates added`);

  // Subjects.
  const subjects = {};
  for (const def of SUBJECTS) {
    const teacher = def.code === 'CS503' && faculty2 ? faculty2 : faculty;
    let subject = await Subject.findOne({ code: def.code, department: DEPT, semester: SEMESTER, isActive: true });
    if (!subject) {
      subject = await Subject.create({ ...def, department: DEPT, semester: SEMESTER, year: 3, faculty: [teacher._id], sections: [SECTION] });
    }
    subjects[def.code] = subject;
  }

  // Timetable.
  let slots = 0;
  for (const [day, codes] of Object.entries(WEEK)) {
    for (const [idx, code] of codes.entries()) {
      if (!code) continue;
      const [period, startTime, endTime] = PERIODS[idx];
      const exists = await TimetableSlot.exists({ section: SECTION, department: DEPT, dayOfWeek: day, period, semester: SEMESTER, isActive: true });
      if (exists) continue;
      const subject = subjects[code];
      await TimetableSlot.create({
        subject: subject._id,
        faculty: subject.faculty[0],
        section: SECTION,
        department: DEPT,
        room: subject.type === 'lab' ? 'Networks Lab (B-204)' : 'LH-301',
        dayOfWeek: day,
        period,
        startTime,
        endTime,
        semester: SEMESTER,
        year: 3,
        academicYear: '2026-27',
      });
      slots += 1;
    }
    // Lunch break between periods 4 and 5. Breaks use period 12 as a spare key;
    // screens order slots by start time, so it still shows in the right place.
    const hasBreak = await TimetableSlot.exists({ section: SECTION, department: DEPT, dayOfWeek: day, isBreak: true, isActive: true });
    if (!hasBreak) {
      await TimetableSlot.create({
        section: SECTION,
        department: DEPT,
        dayOfWeek: day,
        period: 12,
        startTime: '12:40',
        endTime: '13:30',
        semester: SEMESTER,
        isBreak: true,
        breakLabel: 'Lunch break',
      });
    }
  }
  log(`[seed:academic] ${Object.keys(subjects).length} subjects, ${slots} new timetable slots`);

  // Attendance for the past 4 weeks (up to yesterday), for the CSE-A semester-5 class.
  const hasAttendance = await AttendanceRecord.exists({ subject: { $in: Object.values(subjects).map((s) => s._id) } });
  if (hasAttendance) {
    log('[seed:academic] attendance already present — skipped');
    return;
  }
  const roster = await User.find({ role: { $in: ['student', 'club_admin'] }, department: DEPT, section: SECTION, semester: SEMESTER, isActive: true }).lean();
  const rand = rng(42);
  const docs = [];
  for (let back = 28; back >= 1; back -= 1) {
    const day = addDays(today(), -back);
    const codes = WEEK[weekdayOf(day)];
    if (!codes) continue; // Sunday
    codes.forEach((code, idx) => {
      if (!code) return;
      const subject = subjects[code];
      roster.forEach((student, k) => {
        // One demo student sits around 65% so low-attendance warnings have data.
        const presentChance = k === 1 ? 0.62 : 0.9;
        docs.push({
          student: student._id,
          subject: subject._id,
          date: day,
          period: PERIODS[idx][0],
          status: rand() < presentChance ? 'present' : 'absent',
          section: SECTION,
          department: DEPT,
          markedBy: subject.faculty[0],
          markedAt: new Date(day.getTime() + 10 * 3600000),
        });
      });
    });
  }
  if (docs.length) await AttendanceRecord.insertMany(docs, { ordered: false });
  log(`[seed:academic] ${docs.length} attendance records for ${roster.length} students`);
}

// Run directly: node src/seed/academic.js
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { connectDB } = await import('../config/db.js');
  await connectDB();
  try {
    await seedAcademic();
    console.log('✅ Academic demo data ready');
  } catch (err) {
    console.error('[seed:academic] failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
