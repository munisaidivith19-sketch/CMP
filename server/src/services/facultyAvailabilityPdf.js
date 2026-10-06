import { PdfDocument, asciiSafe } from '../utils/pdf.js';

const to12h = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/**
 * Generates an official Faculty Availability PDF buffer in landscape A4.
 */
export async function generateFacultyAvailabilityPdfBuffer({
  faculties = [],
  periods = [],
  dayOfWeek = 'monday',
  department = '',
  isFirstYearHod = false,
} = {}) {
  const dayName = cap(dayOfWeek);
  const today = new Date().toISOString().slice(0, 10);
  const deptTitle = isFirstYearHod
    ? `Science & Humanities · Faculty Availability Schedule (${department || 'All Departments'})`
    : `Department of ${department}`;

  const doc = new PdfDocument({
    title: `Faculty Availability - ${department} - ${dayName}`,
    orientation: 'landscape',
    margin: 30,
    footer: `J.N.N Institute of Engineering - CampusConnect Faculty Availability - Generated ${today}`,
  });

  // 1. Official Institutional Logo & Header
  if (!doc.logo({ maxWidth: 210, maxHeight: 46, spaceAfter: 8 })) {
    doc.line('J.N.N INSTITUTE OF ENGINEERING', { size: 15, bold: true });
  }
  doc.line('CAMPUSCONNECT - FACULTY AVAILABILITY & STAGE SCHEDULE', { size: 11.5, bold: true });
  doc.line(deptTitle, { size: 9, color: [0.35, 0.35, 0.4] });
  doc.hr();

  // 2. Summary Facts
  const activePeriodsCount = periods.filter((p) => !p.isBreak).length;
  doc.facts([
    ['Department', department || 'Academic'],
    ['Schedule Day', dayName],
    ['Total Department Faculty', `${faculties.length} Member(s)`],
    ['Academic Periods', `${activePeriodsCount} Teaching Periods`],
    ['Scope', isFirstYearHod ? 'Science & Humanities' : 'Department Faculty'],
    ['Generated On', today],
  ]);
  doc.gap(4);
  doc.hr();

  // 3. Faculty-by-Period Grid Table
  doc.section(`FACULTY SCHEDULE & AVAILABILITY MATRIX - ${dayName.toUpperCase()}`);

  if (faculties.length === 0 || periods.length === 0) {
    doc.line('No faculty or periods found for the selected schedule day.', { size: 9.5, color: [0.5, 0.5, 0.5] });
    return doc.toBuffer();
  }

  // Column definitions
  const columns = [
    {
      header: ['Faculty Member', 'Designation / Staff ID'],
      width: 1.5,
      bold: true,
    },
    ...periods.map((p) => ({
      header: p.isBreak
        ? [p.breakLabel || 'Break', `${to12h(p.startTime)} -\n${to12h(p.endTime)}`]
        : [`Period ${p.period}`, `${to12h(p.startTime)} -\n${to12h(p.endTime)}`],
      width: p.isBreak ? 0.9 : 1.25,
      align: 'left',
    })),
  ];

  // Rows definitions
  const rows = faculties.map((f) => {
    const facultyCell = [
      { text: asciiSafe(f.name), bold: true, size: 7.5 },
      {
        text: `${asciiSafe(f.designation || 'Faculty')}${f.employeeId ? ` · ${asciiSafe(f.employeeId)}` : ''}`,
        size: 6.5,
        color: [0.3, 0.3, 0.4],
      },
      {
        text: `${f.freePeriods ?? 0} Free / ${f.busyPeriods ?? 0} In Class`,
        size: 6,
        color: [0.15, 0.5, 0.25],
      },
    ];

    const periodCells = periods.map((p) => {
      if (p.isBreak) {
        return {
          lines: [
            {
              text: asciiSafe(p.breakLabel || 'BREAK').toUpperCase(),
              bold: true,
              size: 6.5,
              color: [0.4, 0.4, 0.45],
            },
          ],
          bg: [0.93, 0.93, 0.95],
        };
      }

      // Find faculty period status
      const periodStatus = f.periods?.find(
        (item) => item.period === p.period || (!p.isBreak && item.startTime === p.startTime)
      );

      if (!periodStatus || periodStatus.status === 'free') {
        return {
          lines: [
            { text: 'AVAILABLE', bold: true, size: 7, color: [0.1, 0.55, 0.25] },
            { text: 'Free Period', size: 6, color: [0.15, 0.5, 0.25] },
          ],
          bg: [0.92, 0.97, 0.93],
        };
      }

      if (periodStatus.status === 'holiday') {
        return {
          lines: [
            { text: 'HOLIDAY', bold: true, size: 7, color: [0.8, 0.2, 0.2] },
            { text: asciiSafe(periodStatus.title || 'Holiday'), size: 6, color: [0.6, 0.2, 0.2] },
          ],
          bg: [0.98, 0.92, 0.92],
        };
      }

      // Busy / In Class
      const slot = periodStatus.slot;
      const subCode = slot?.subject?.code ? asciiSafe(slot.subject.code) : 'CLASS';
      const subName = slot?.subject?.name ? asciiSafe(slot.subject.name) : '';
      const cls = slot ? `${slot.department || ''} Y${slot.year || ''} · ${slot.section || ''}` : '';
      const room = slot?.room ? `Rm ${asciiSafe(slot.room)}` : '';

      const lines = [
        { text: `${subCode}${subName ? ` (${subName})` : ''}`, bold: true, size: 7 },
        ...(cls ? [{ text: cls, size: 6.5, color: [0.25, 0.25, 0.35] }] : []),
        ...(room ? [{ text: room, size: 6, color: [0.4, 0.4, 0.5] }] : []),
      ];

      return { lines };
    });

    return [facultyCell, ...periodCells];
  });

  doc.table({
    columns,
    rows,
    size: 7,
    headerSize: 7,
    grid: true,
    zebra: true,
    minRowHeight: 32,
  });

  return doc.toBuffer();
}

