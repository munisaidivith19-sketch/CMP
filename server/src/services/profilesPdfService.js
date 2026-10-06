import mongoose from 'mongoose';
import '../models/User.js';
import { PdfDocument, asciiSafe } from '../utils/pdf.js';

export async function generateProfilesPdfBuffer() {
  const User = mongoose.model('User');
  const users = await User.find({}).sort({ role: 1, department: 1, year: 1, section: 1, name: 1 }).lean();

  const today = new Date().toISOString().slice(0, 10);
  const doc = new PdfDocument({
    title: 'Institutional Profiles Directory',
    footer: `J.N.N Institute of Engineering - CampusConnect Directory - Generated ${today}`,
  });

  // 1. College Logo & Header
  if (!doc.logo({ maxWidth: 220, maxHeight: 55, spaceAfter: 10 })) {
    doc.line('J.N.N INSTITUTE OF ENGINEERING', { size: 18, bold: true });
  }
  doc.line('CAMPUSCONNECT - INSTITUTIONAL PROFILES DIRECTORY', { size: 13, bold: true });
  doc.line('Official Master Roster of Leadership, Faculty, Students & Alumni Accounts', { size: 9.5, color: [0.35, 0.35, 0.4] });
  doc.hr();

  // 2. Summary Facts
  const leadership = users.filter((u) => ['principal', 'chairman', 'dean', 'admin', 'ao', 'warden', 'security'].includes(u.role));
  const facultyAndHod = users.filter((u) => ['hod', 'faculty'].includes(u.role));
  const students = users.filter((u) => ['student', 'club_admin'].includes(u.role));
  const alumni = users.filter((u) => u.role === 'alumni');

  doc.facts([
    ['Report Date', today],
    ['Total Registered Profiles', String(users.length)],
    ['Leadership & Administration', String(leadership.length)],
    ['HODs & Faculty Members', String(facultyAndHod.length)],
    ['Active Student Profiles', String(students.length)],
    ['Alumni Network Members', String(alumni.length)],
    ['First Year Common HOD', 'Dr. K. Radhakrishnan (Science & Humanities)'],
    ['Universal Account Password', 'Password@123'],
  ]);
  doc.gap(4);
  doc.hr();

  // 3. Section 1: Executive Leadership & Administration
  doc.section(`1. EXECUTIVE LEADERSHIP & ADMINISTRATIVE PROFILES (${leadership.length})`);
  doc.paragraph(
    'Key institutional administrators responsible for campus governance, academic direction, student affairs, security, and operations.',
    { size: 8.5 }
  );
  doc.gap(4);

  const LEADERSHIP_COLUMNS = [
    { header: '#', width: 0.35, align: 'right' },
    { header: 'Official Name', width: 2.1, bold: true },
    { header: 'Designation / Role', width: 2.2 },
    { header: 'Department / Office', width: 1.8 },
    { header: 'Email Address', width: 2.4 },
    { header: 'Staff ID', width: 1.3 },
  ];

  const leadershipRows = leadership.map((u, i) => [
    String(i + 1),
    asciiSafe(u.name),
    asciiSafe(u.designation || u.role.toUpperCase()),
    asciiSafe(u.department || 'Central Admin'),
    asciiSafe(u.email),
    asciiSafe(u.employeeId || '-'),
  ]);

  doc.table({ columns: LEADERSHIP_COLUMNS, rows: leadershipRows, size: 8.5, headerSize: 8 });

  // 4. Section 2: Department Heads (HODs) & Faculty
  doc.gap(6);
  doc.section(`2. DEPARTMENT HEADS (HODs) & TEACHING FACULTY (${facultyAndHod.length})`);
  doc.paragraph(
    'Heads of Department and teaching faculty members. Note: First Year students across all branches report to the common First Year HOD (Dr. K. Radhakrishnan, Science & Humanities).',
    { size: 8.5 }
  );
  doc.gap(4);

  const FACULTY_COLUMNS = [
    { header: '#', width: 0.35, align: 'right' },
    { header: 'Faculty Name', width: 2.2, bold: true },
    { header: 'Designation / Role', width: 2.3 },
    { header: 'Department', width: 2.0 },
    { header: 'Email Address', width: 2.2 },
    { header: 'Employee ID', width: 1.3 },
  ];

  const facultyRows = facultyAndHod.map((u, i) => [
    String(i + 1),
    asciiSafe(u.name),
    asciiSafe(u.designation || (u.role === 'hod' ? 'Head of Department' : 'Faculty')),
    asciiSafe(u.department || '-'),
    asciiSafe(u.email),
    asciiSafe(u.employeeId || '-'),
  ]);

  doc.table({ columns: FACULTY_COLUMNS, rows: facultyRows, size: 8.5, headerSize: 8 });

  // 5. Section 3: Student Community & Club Leadership
  doc.gap(6);
  doc.section(`3. STUDENT COMMUNITY & CLUB LEADERSHIP PROFILES (${students.length})`);
  doc.paragraph(
    'Enrolled students across academic programs, years, semesters, and sections. Includes newly registered 1st Year AI & DS student Athira.R.',
    { size: 8.5 }
  );
  doc.gap(4);

  const STUDENT_COLUMNS = [
    { header: '#', width: 0.35, align: 'right' },
    { header: 'Roll No', width: 1.1 },
    { header: 'Student Name', width: 2.1, bold: true },
    { header: 'Department', width: 2.1 },
    { header: 'Yr/Sem/Sec', width: 1.1 },
    { header: 'Email Address', width: 2.2 },
    { header: 'Role / Designation', width: 1.4 },
  ];

  // Sort students: Year ascending, Department ascending, Section ascending, Name ascending
  students.sort((a, b) => {
    if ((a.year || 0) !== (b.year || 0)) return (a.year || 0) - (b.year || 0);
    if ((a.department || '').localeCompare(b.department || '') !== 0) return (a.department || '').localeCompare(b.department || '');
    return (a.name || '').localeCompare(b.name || '');
  });

  const studentRows = students.map((u, i) => [
    String(i + 1),
    asciiSafe(u.rollNo || '-'),
    asciiSafe(u.name),
    asciiSafe(u.department || '-'),
    `Y${u.year || '-'} S${u.semester || '-'} ${u.section || '-'}`,
    asciiSafe(u.email),
    u.role === 'club_admin' ? 'Club Admin' : 'Student',
  ]);

  doc.table({ columns: STUDENT_COLUMNS, rows: studentRows, size: 8.2, headerSize: 8 });

  // 6. Section 4: Alumni Network Profiles
  doc.gap(6);
  doc.section(`4. ALUMNI NETWORK PROFILES (${alumni.length})`);
  doc.paragraph(
    'Graduated alumni registered on the CampusConnect mentorship, referral, and community networking portal.',
    { size: 8.5 }
  );
  doc.gap(4);

  const ALUMNI_COLUMNS = [
    { header: '#', width: 0.35, align: 'right' },
    { header: 'Alumni Name', width: 2.4, bold: true },
    { header: 'Department', width: 1.5 },
    { header: 'Designation / Current Role', width: 2.8 },
    { header: 'Email Address', width: 2.5 },
  ];

  const alumniRows = alumni.map((u, i) => [
    String(i + 1),
    asciiSafe(u.name),
    asciiSafe(u.department || '-'),
    asciiSafe(u.designation || 'Alumni Member'),
    asciiSafe(u.email),
  ]);

  doc.table({ columns: ALUMNI_COLUMNS, rows: alumniRows, size: 8.5, headerSize: 8 });

  return doc.toBuffer();
}
