import { PdfDocument, asciiSafe } from '../utils/pdf.js';

const to12h = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/**
 * Generates an official Master Timetable PDF buffer in landscape A4.
 */
export async function generateMasterTimetablePdfBuffer({
  slots = [],
  classes = [],
  periods = [],
  faculties = [],
  department = '',
  isFirstYearHod = false,
  dayOfWeek = 'monday',
  year = null,
} = {}) {
  const dayName = cap(dayOfWeek);
  const today = new Date().toISOString().slice(0, 10);
  const deptTitle = isFirstYearHod
    ? `Science & Humanities · First Year Master Schedule (${department || 'All Departments'})`
    : `Department of ${department}`;

  const doc = new PdfDocument({
    title: `Master Timetable - ${department} - ${dayName}`,
    orientation: 'landscape',
    margin: 30,
    footer: `J.N.N Institute of Engineering - CampusConnect Master Timetable - Generated ${today}`,
  });

  // 1. College Logo & Official Institutional Header
  if (!doc.logo({ maxWidth: 210, maxHeight: 46, spaceAfter: 8 })) {
    doc.line('J.N.N INSTITUTE OF ENGINEERING', { size: 15, bold: true });
  }
  doc.line('CAMPUSCONNECT - ACADEMIC MASTER TIMETABLE', { size: 11.5, bold: true });
  doc.line(deptTitle, { size: 9, color: [0.35, 0.35, 0.4] });
  doc.hr();

  // 2. Summary Facts
  const activePeriodsCount = periods.filter((p) => !p.isBreak).length;
  doc.facts([
    ['Department', department || 'Academic'],
    ['Schedule Day', dayName],
    ['Academic Scope', year ? `Year ${year}` : isFirstYearHod ? '1st Year (All Branches)' : 'Years 2 - 4'],
    ['Active Sections', `${classes.length} Class(es)`],
    ['Total Periods', `${activePeriodsCount} Period Slots Scheduled`],
    ['Teaching Faculty', `${faculties.length} Assigned Member(s)`],
  ]);
  doc.gap(4);
  doc.hr();

  // 3. Master Timetable Grid
  doc.section(`MASTER SCHEDULE - ${dayName.toUpperCase()}`);

  if (classes.length === 0 || periods.length === 0) {
    doc.line('No timetable slots scheduled for the selected filters.', { size: 9.5, color: [0.5, 0.5, 0.5] });
    return doc.toBuffer();
  }

  // Construct Columns: Class column + each period
  const columns = [
    {
      header: ['Class / Sec', 'Department'],
      width: 1.35,
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

  // Construct Rows: For each class, evaluate each period
  const rows = classes.map((cls) => {
    const classCell = [
      { text: `${cls.department} · Y${cls.year}`, bold: true, size: 7.5 },
      { text: `Sec ${cls.section} (Sem ${cls.semester})`, size: 6.5, color: [0.3, 0.3, 0.4] },
    ];

    const periodCells = periods.map((p) => {
      // Find matching slot for this class and period
      const slot = slots.find(
        (s) =>
          s.department === cls.department &&
          s.year === cls.year &&
          s.section === cls.section &&
          s.dayOfWeek === dayOfWeek &&
          (p.isBreak
            ? s.isBreak && s.startTime === p.startTime
            : !s.isBreak && (s.period === p.period || s.startTime === p.startTime))
      );

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

      if (!slot) {
        return {
          lines: [{ text: '-', size: 8, color: [0.65, 0.65, 0.7] }],
        };
      }

      if (slot.holiday) {
        return {
          lines: [
            { text: 'HOLIDAY', bold: true, size: 7, color: [0.8, 0.2, 0.2] },
            { text: asciiSafe(slot.holiday.title || 'Holiday'), size: 6, color: [0.6, 0.2, 0.2] },
          ],
          bg: [0.98, 0.92, 0.92],
        };
      }

      const subCode = slot.subject?.code ? asciiSafe(slot.subject.code) : 'SUB';
      const subName = slot.subject?.name ? asciiSafe(slot.subject.name) : '';
      const facName = slot.faculty?.name ? asciiSafe(slot.faculty.name) : 'Unassigned';
      const room = slot.room ? `Room ${asciiSafe(slot.room)}` : '';

      const lines = [
        { text: `${subCode}${subName ? ` (${subName})` : ''}`, bold: true, size: 7 },
        { text: facName, size: 6.5, color: [0.25, 0.25, 0.35] },
      ];
      if (room) {
        lines.push({ text: room, size: 6, color: [0.4, 0.4, 0.5] });
      }

      return { lines };
    });

    return [classCell, ...periodCells];
  });

  doc.table({
    columns,
    rows,
    size: 7,
    headerSize: 7,
    grid: true,
    zebra: true,
    minRowHeight: 28,
  });

  // 4. Faculty Allocation Summary
  if (faculties.length > 0) {
    doc.gap(8);
    doc.section(`FACULTY ALLOCATION & TEACHING SCHEDULE - ${dayName.toUpperCase()}`);

    const FAC_COLUMNS = [
      { header: '#', width: 0.35, align: 'right' },
      { header: 'Faculty Name', width: 2.3, bold: true },
      { header: 'Department', width: 1.8 },
      { header: 'Email Address', width: 2.6 },
      { header: 'Periods & Sections Handling', width: 3.5 },
    ];

    const facRows = faculties.map((f, i) => {
      // Find periods this faculty teaches on this day
      const facSlots = slots.filter(
        (s) => s.dayOfWeek === dayOfWeek && !s.isBreak && String(s.faculty?._id || s.faculty) === String(f._id)
      );
      const summary = facSlots
        .map((s) => `P${s.period}: ${s.subject?.code || 'Sub'} (${s.section || 'A'}${s.room ? `, ${s.room}` : ''})`)
        .join('; ');

      return [
        String(i + 1),
        asciiSafe(f.name),
        asciiSafe(f.department || department),
        asciiSafe(f.email || '-'),
        summary || 'No scheduled periods',
      ];
    });

    doc.table({
      columns: FAC_COLUMNS,
      rows: facRows,
      size: 7.5,
      headerSize: 7.5,
      zebra: true,
      grid: true,
    });
  }

  return doc.toBuffer();
}

