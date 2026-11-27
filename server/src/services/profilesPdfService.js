import mongoose from 'mongoose';
import '../models/User.js';
import { PdfDocument, asciiSafe } from '../utils/pdf.js';

/** Who each directory group contains. Everyone else (principal, admin, warden …) is "staff". */
export const DIRECTORY_GROUPS = {
  student: { label: 'Students', roles: ['student', 'club_admin'] },
  faculty: { label: 'Faculty', roles: ['faculty'] },
  hod: { label: 'HODs', roles: ['hod'] },
  staff: { label: 'Leadership & administration', roles: null },
  alumni: { label: 'Alumni', roles: ['alumni'] },
  all: { label: 'All users', roles: null },
};
const NON_STAFF = ['student', 'club_admin', 'faculty', 'hod', 'alumni'];

/**
 * The Mongo filter for one export. Department applies to every group that has
 * one; year and section only to students (validated by the route).
 */
export function directoryFilter({ role = 'all', department, year, section } = {}) {
  const f = {};
  if (role === 'staff') f.role = { $nin: NON_STAFF };
  else if (DIRECTORY_GROUPS[role]?.roles) f.role = { $in: DIRECTORY_GROUPS[role].roles };
  if (department && role !== 'staff') f.department = department;
  if (role === 'student') {
    if (year) f.year = Number(year);
    if (section) f.section = String(section).toUpperCase();
  }
  return f;
}

/** "Students · CSE · 2nd Year · Section A" — what the export contains, in words. */
export function directoryScopeLabel({ role = 'all', department, year, section } = {}) {
  const yearText = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
  return [
    DIRECTORY_GROUPS[role]?.label || 'All users',
    role !== 'staff' ? department || 'All departments' : null,
    role === 'student' ? (year ? yearText[year] || `Year ${year}` : 'All years') : null,
    role === 'student' ? (section ? `Section ${String(section).toUpperCase()}` : 'All sections') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const byName = (a, b) => (a.name || '').localeCompare(b.name || '');

/**
 * The profiles directory PDF for the chosen group and class. Returns the
 * buffer and how many accounts it lists (for the security log).
 */
export async function generateProfilesPdfBuffer(filters = {}) {
  const User = mongoose.model('User');
  const role = filters.role || 'all';
  const users = await User.find(directoryFilter(filters))
    .select('name email role department designation employeeId rollNo year semester section isActive')
    .lean();

  const today = new Date().toISOString().slice(0, 10);
  const scope = directoryScopeLabel(filters);
  const doc = new PdfDocument({
    title: `Profiles Directory - ${scope}`,
    footer: `J.N.N Institute of Engineering - Profiles Directory - ${scope} - Generated ${today} - Confidential`,
  });

  if (!doc.logo({ maxWidth: 220, maxHeight: 55, spaceAfter: 10 })) {
    doc.line('J.N.N INSTITUTE OF ENGINEERING', { size: 18, bold: true });
  }
  doc.line('PROFILES DIRECTORY', { size: 13, bold: true });
  doc.line(asciiSafe(scope), { size: 10, color: [0.35, 0.35, 0.4] });
  doc.hr();

  const students = users.filter((u) => ['student', 'club_admin'].includes(u.role));
  const faculty = users.filter((u) => u.role === 'faculty');
  const hods = users.filter((u) => u.role === 'hod');
  const alumni = users.filter((u) => u.role === 'alumni');
  const staff = users.filter((u) => !NON_STAFF.includes(u.role));

  doc.facts([
    ['Report date', today],
    ['Accounts listed', String(users.length)],
    ['Group', DIRECTORY_GROUPS[role]?.label || 'All users'],
    ['Department', role === 'staff' ? '-' : filters.department || 'All departments'],
    ...(role === 'student' ? [['Year', filters.year ? `Year ${filters.year}` : 'All years'], ['Section', filters.section ? String(filters.section).toUpperCase() : 'All sections']] : []),
    ['Inactive accounts', String(users.filter((u) => u.isActive === false).length)],
  ]);
  doc.gap(4);
  doc.paragraph('Confidential: contains personal contact details. Every download of this directory is recorded in the security log.', { size: 8 });

  if (!users.length) {
    doc.gap(12);
    doc.line('No accounts match this selection.', { size: 10, color: [0.5, 0.5, 0.5] });
    return { buffer: doc.toBuffer(), count: 0 };
  }

  const status = (u) => (u.isActive === false ? ' (inactive)' : '');
  let n = 0;
  const section = (title, rows, columns, size = 8.5) => {
    if (!rows.length) return;
    n += 1;
    doc.gap(6);
    doc.section(`${n}. ${title} (${rows.length})`);
    doc.table({ columns, rows, size, headerSize: 8 });
  };

  section(
    'LEADERSHIP & ADMINISTRATION',
    staff.sort(byName).map((u, i) => [String(i + 1), asciiSafe(u.name) + status(u), asciiSafe(u.designation || u.role.toUpperCase()), asciiSafe(u.department || 'Central office'), asciiSafe(u.email), asciiSafe(u.employeeId || '-')]),
    [
      { header: '#', width: 0.35, align: 'right' },
      { header: 'Name', width: 2.1, bold: true },
      { header: 'Designation / Role', width: 2.2 },
      { header: 'Department / Office', width: 1.8 },
      { header: 'Email', width: 2.4, shrink: true },
      { header: 'Staff ID', width: 1.3, shrink: true },
    ]
  );
  const staffColumns = [
    { header: '#', width: 0.35, align: 'right' },
    { header: 'Name', width: 2.2, bold: true },
    { header: 'Designation', width: 2.3 },
    { header: 'Department', width: 2.0 },
    { header: 'Email', width: 2.2, shrink: true },
    { header: 'Employee ID', width: 1.3, shrink: true },
  ];
  const staffRow = (fallback) => (u, i) => [String(i + 1), asciiSafe(u.name) + status(u), asciiSafe(u.designation || fallback), asciiSafe(u.department || '-'), asciiSafe(u.email), asciiSafe(u.employeeId || '-')];
  const byDept = (a, b) => (a.department || '').localeCompare(b.department || '') || byName(a, b);
  section('HEADS OF DEPARTMENT', hods.sort(byDept).map(staffRow('Head of Department')), staffColumns);
  section('FACULTY', faculty.sort(byDept).map(staffRow('Faculty')), staffColumns);

  students.sort((a, b) => (a.department || '').localeCompare(b.department || '') || (a.year || 0) - (b.year || 0) || (a.section || '').localeCompare(b.section || '') || (a.rollNo || '').localeCompare(b.rollNo || '') || byName(a, b));
  section(
    'STUDENTS',
    students.map((u, i) => [
      String(i + 1),
      asciiSafe(u.rollNo || '-'),
      asciiSafe(u.name) + status(u),
      asciiSafe(u.department || '-'),
      `Y${u.year || '-'} S${u.semester || '-'} ${u.section || '-'}`,
      asciiSafe(u.email),
      u.role === 'club_admin' ? 'Club admin' : 'Student',
    ]),
    [
      { header: '#', width: 0.35, align: 'right' },
      { header: 'Roll No', width: 1.5, shrink: true },
      { header: 'Name', width: 2.0, bold: true },
      { header: 'Department', width: 1.7 },
      { header: 'Yr/Sem/Sec', width: 1.1 },
      { header: 'Email', width: 2.2, shrink: true },
      { header: 'Role', width: 1.1 },
    ],
    8.2
  );
  section(
    'ALUMNI',
    alumni.sort(byDept).map((u, i) => [String(i + 1), asciiSafe(u.name) + status(u), asciiSafe(u.department || '-'), asciiSafe(u.designation || 'Alumni'), asciiSafe(u.email)]),
    [
      { header: '#', width: 0.35, align: 'right' },
      { header: 'Name', width: 2.4, bold: true },
      { header: 'Department', width: 1.5 },
      { header: 'Current role', width: 2.8 },
      { header: 'Email', width: 2.5, shrink: true },
    ]
  );

  return { buffer: doc.toBuffer(), count: users.length };
}
