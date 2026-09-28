/**
 * Academic-year backfill. Dry run by default; pass --apply to write.
 *
 *   node scripts/migrate-academic-year.mjs          # report only
 *   node scripts/migrate-academic-year.mjs --apply  # backfill + index swap
 *
 * - Timetable slots, attendance sessions and study materials missing `year`
 *   get it from their own semester (year = ceil(semester / 2)). Existing
 *   values are never overwritten, so historical attendance snapshots keep
 *   whatever they recorded.
 * - Students are never guessed: missing/inconsistent placements are only
 *   listed for an admin to correct in User management.
 * - Superseded indexes are dropped and the new class indexes are built.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import TimetableSlot from '../src/models/TimetableSlot.js';
import AttendanceSession from '../src/models/AttendanceSession.js';
import StudyMaterial from '../src/models/StudyMaterial.js';
import { yearOfSemester } from '../src/constants.js';

const APPLY = process.argv.includes('--apply');
const STUDENT_ROLES = ['student', 'club_admin'];
const derivedYear = { $ceil: { $divide: ['$semester', 2] } };

const SUPERSEDED_INDEXES = [
  [User, 'role_1_department_1_section_1_isActive_1'],
  [AttendanceSession, 'department_1_section_1_date_-1'],
  [StudyMaterial, 'department_1_semester_1_section_1_isActive_1'],
];

async function backfillYear(Model, label) {
  const missing = { year: null, semester: { $gte: 1 } };
  const count = await Model.countDocuments(missing);
  const underivable = await Model.countDocuments({ year: null, semester: null });
  const mismatched = await Model.find({ year: { $ne: null }, semester: { $ne: null }, $expr: { $ne: ['$year', derivedYear] } })
    .select('_id year semester')
    .lean();
  console.log(`${label}: ${count} missing year (derivable)${underivable ? `, ${underivable} with no semester (left as-is)` : ''}`);
  mismatched.forEach((d) => console.log(`  ! ${label} ${d._id}: year ${d.year} but semester ${d.semester} (→ year ${yearOfSemester(d.semester)}) — left as-is, review manually`));
  if (APPLY && count) {
    const res = await Model.collection.updateMany(missing, [{ $set: { year: derivedYear } }]);
    console.log(`  ✔ backfilled ${res.modifiedCount}`);
  }
}

async function flagStudents() {
  const students = await User.find({ role: { $in: STUDENT_ROLES } }).select('name email department year section semester').lean();
  const problems = students
    .map((s) => {
      const issues = [];
      if (!s.department) issues.push('no department');
      if (!s.year) issues.push('no year');
      if (!s.section) issues.push('no section');
      if (s.year && s.semester && yearOfSemester(s.semester) !== s.year) issues.push(`year ${s.year} ≠ semester ${s.semester}`);
      return issues.length ? `  ! ${s.name} <${s.email}>: ${issues.join(', ')}` : null;
    })
    .filter(Boolean);
  console.log(`Students: ${students.length} total, ${problems.length} need admin correction (not changed automatically)`);
  problems.forEach((p) => console.log(p));
}

async function flagFaculty() {
  const faculty = await User.find({ role: 'faculty', $or: [{ teachingYears: { $in: [null, []] } }, { teachingSections: { $in: [null, []] } }] })
    .select('name email')
    .lean();
  console.log(`Faculty without declared years/sections handled: ${faculty.length} (timetable assignment is unrestricted until set)`);
  faculty.forEach((f) => console.log(`  - ${f.name} <${f.email}>`));
}

async function swapIndexes() {
  for (const [Model, name] of SUPERSEDED_INDEXES) {
    const exists = (await Model.collection.indexes()).some((i) => i.name === name);
    if (!exists) continue;
    console.log(`${Model.modelName}: superseded index ${name}${APPLY ? ' — dropping' : ' — would drop'}`);
    if (APPLY) await Model.collection.dropIndex(name);
  }
  if (APPLY) {
    await Promise.all([User, TimetableSlot, AttendanceSession, StudyMaterial].map((M) => M.createIndexes()));
    console.log('✔ class indexes built');
  }
}

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
console.log(APPLY ? '── APPLYING ──' : '── DRY RUN (pass --apply to write) ──');
await backfillYear(TimetableSlot, 'Timetable slots');
await backfillYear(AttendanceSession, 'Attendance sessions');
await backfillYear(StudyMaterial, 'Study materials');
await flagStudents();
await flagFaculty();
await swapIndexes();
await mongoose.disconnect();
