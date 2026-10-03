/**
 * Renders an authorized attendance report (built by attendanceReport.js) to a
 * PDF buffer. It only ever draws the report object it is handed, so no student
 * list or academic label can reach a PDF without having passed authorization.
 */
import { PdfDocument } from '../utils/pdf.js';
import { YEAR_LABEL } from '../constants.js';

const to12h = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const yearLabel = (y) => (y ? YEAR_LABEL[y] || `Year ${y}` : null);

/** The scope facts printed under every report heading. */
function headerFacts(header) {
  const scopeLabel = { class: 'Our Class (Class In-Charge)', handling: 'Handling Class' }[header.scope];
  return [
    ['Scope', scopeLabel],
    ['Class In-Charge', header.classInCharge],
    ['Date', header.date],
    ['From', header.from],
    ['To', header.to],
    ['Department', header.department],
    ['Program', header.program],
    ['Year', yearLabel(header.year)],
    ['Section', header.section],
    ['Semester', header.semester],
    ['Subject', header.subject],
    ['Subject code', header.subjectCode],
    ['Period', header.period],
    ['Period time', header.startTime ? `${to12h(header.startTime)} - ${to12h(header.endTime)}` : null],
    ['Room', header.room],
    ['Handling faculty', header.facultyName],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
}

const NAME_COLUMNS = [
  { header: '#', width: 0.45, align: 'right' },
  { header: 'Roll No', width: 1.1 },
  { header: 'Student Name', width: 3.1 },
  { header: 'Department', width: 2.1 },
  { header: 'Year', width: 0.8 },
  { header: 'Sec', width: 0.6 },
  { header: 'Status', width: 0.9 },
];

const nameRows = (students, status) =>
  students.map((s, i) => [
    String(i + 1),
    s.rollNo || '-',
    s.name,
    s.department || '-',
    s.year ? String(s.year) : '-',
    s.section || '-',
    status || (s.status === 'present' ? 'Present' : 'Absent'),
  ]);

const SUMMARY_COLUMNS = [
  { header: '#', width: 0.45, align: 'right' },
  { header: 'Roll No', width: 1.1 },
  { header: 'Student Name', width: 2.9 },
  { header: 'Dept', width: 1.7 },
  { header: 'Yr', width: 0.45 },
  { header: 'Sec', width: 0.5 },
  { header: 'Held', width: 0.7, align: 'right' },
  { header: 'Present', width: 0.85, align: 'right' },
  { header: 'Absent', width: 0.8, align: 'right' },
  { header: '%', width: 0.8, align: 'right' },
];

const summaryRows = (students) =>
  students.map((s, i) => [
    String(i + 1),
    s.rollNo || '-',
    s.name,
    s.department || '-',
    s.year ? String(s.year) : '-',
    s.section || '-',
    String(s.totalPeriods),
    String(s.presentPeriods),
    String(s.absentPeriods),
    `${s.percentage}%`,
  ]);

/** Present-then-absent lists, both ordered by roll number. */
function presentAbsentSections(doc, { present, absent }) {
  doc.section(`PRESENT STUDENTS (${present.length})`);
  if (present.length) doc.table({ columns: NAME_COLUMNS, rows: nameRows(present, 'Present') });
  else doc.line('None.', { size: 9.5 });

  doc.section(`ABSENT STUDENTS (${absent.length})`);
  if (absent.length) doc.table({ columns: NAME_COLUMNS, rows: nameRows(absent, 'Absent') });
  else doc.line('None.', { size: 9.5 });
}

/** Render a report object to a PDF buffer. */
export function renderReportPdf(report) {
  const h = report.header;
  const doc = new PdfDocument({
    title: `${h.collegeName} ${report.title}`,
    footer: `${h.collegeName} - ${report.title} - generated ${h.generatedAt} (server time)`,
  });

  doc.line(h.collegeName, { size: 19, bold: true });
  doc.line(report.title, { size: 12 });
  doc.hr();
  doc.facts(headerFacts(h));
  doc.gap(4);
  doc.hr();

  if (report.type === 'period') {
    if (report.notTaken) {
      doc.section('ATTENDANCE NOT TAKEN');
      doc.paragraph('The period has finished, but no attendance was recorded for it.', { size: 9.5 });
      return doc.toBuffer();
    }
    doc.section('SUMMARY');
    doc.facts([
      ['Total students', report.totals.total],
      ['Attendance', `${report.totals.percentage}%`],
      ['Total present', report.totals.present],
      ['Total absent', report.totals.absent],
    ]);
    presentAbsentSections(doc, report);
    return doc.toBuffer();
  }

  if (report.type === 'date' || report.type === 'current') {
    doc.section('SUMMARY');
    doc.facts([
      ['Periods conducted', report.totals.periodsConducted],
      ['Students', report.totals.students],
      ['Total present', report.totals.present],
      ['Total absent', report.totals.absent],
      ['Present + absent', report.totals.total],
      ['Attendance', `${report.totals.percentage}%`],
    ]);

    if (!report.periods.length) {
      doc.section('NO COMPLETED PERIODS');
      doc.paragraph('No attendance has been recorded for a completed period on this date.', { size: 9.5 });
      return doc.toBuffer();
    }

    doc.section('DAY TOTALS BY STUDENT');
    doc.table({ columns: SUMMARY_COLUMNS, rows: summaryRows(report.students) });

    for (const p of report.periods) {
      doc.section(
        `PERIOD ${p.period} - ${p.subjectCode || ''} ${p.subject || ''}`.replace(/\s+/g, ' ').trim()
      );
      doc.facts([
        ['Time', `${to12h(p.startTime)} - ${to12h(p.endTime)}`],
        ['Handling faculty', p.facultyName],
        ['Section', p.section],
        ['Room', p.room],
        ['Present', p.totals.present],
        ['Absent', p.totals.absent],
      ]);
      presentAbsentSections(doc, p);
    }
    return doc.toBuffer();
  }

  // Weekly / monthly / semester.
  doc.section('SUMMARY');
  doc.facts([
    ['Periods conducted', report.totals.periodsConducted],
    ['Students', report.totals.students],
    ['Total present', report.totals.present],
    ['Total absent', report.totals.absent],
    ['Present + absent', report.totals.total],
    ['Attendance', `${report.totals.percentage}%`],
  ]);

  doc.section('ATTENDANCE BY STUDENT');
  if (report.students.length) doc.table({ columns: SUMMARY_COLUMNS, rows: summaryRows(report.students) });
  else doc.line('No students in this class.', { size: 9.5 });

  if (report.sessions.length) {
    doc.section('PERIODS CONDUCTED');
    doc.table({
      columns: [
        { header: 'Date', width: 1.2 },
        { header: 'Period', width: 0.7, align: 'right' },
        { header: 'Time', width: 1.6 },
        { header: 'Subject', width: 2.6 },
        { header: 'Code', width: 1 },
        { header: 'Sec', width: 0.5 },
        { header: 'Faculty', width: 2 },
      ],
      rows: report.sessions.map((s) => [
        s.date,
        String(s.period),
        `${to12h(s.startTime)} - ${to12h(s.endTime)}`,
        s.subject || '-',
        s.subjectCode || '-',
        s.section || '-',
        s.facultyName || '-',
      ]),
    });
  }

  return doc.toBuffer();
}
