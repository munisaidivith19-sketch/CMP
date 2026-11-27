/**
 * Weekly class timetable as a downloadable PDF or Word (.docx) file: days as
 * rows, the day's time slots (periods and breaks) as columns, then a subject
 * list. Built from exactly the slots the viewer may see (the controller scopes
 * them), so an export never reveals more than the Week view on screen.
 */
import { PdfDocument, asciiSafe, wrap } from '../utils/pdf.js';
import { buildDocx, contentTwips, logoParagraph, paragraph, run, table } from '../utils/docx.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export const to12h = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export const classLabel = (s) => `${s.department} · Year ${s.year} · Sec ${s.section}`;

/**
 * The week as a grid: the days that have periods, the distinct time slots in
 * start-time order (a column is a break only when everything in it is one),
 * the slots in each cell, and a per-subject summary.
 */
export function weekModel(slots = []) {
  const cols = new Map();
  const cells = new Map();
  const classes = new Set();
  for (const s of slots) {
    const key = `${s.startTime}-${s.endTime}`;
    if (!cols.has(key)) cols.set(key, { key, startTime: s.startTime, endTime: s.endTime, isBreak: true, periods: new Set(), breakLabel: '' });
    const col = cols.get(key);
    if (s.isBreak) col.breakLabel = col.breakLabel || s.breakLabel || 'Break';
    else {
      col.isBreak = false;
      col.periods.add(s.period);
    }
    const cellKey = `${s.dayOfWeek}|${key}`;
    if (!cells.has(cellKey)) cells.set(cellKey, []);
    cells.get(cellKey).push(s);
    if (!s.isBreak) classes.add(`${s.department}|${s.year}|${s.section}|${s.semester}`);
  }
  const columns = [...cols.values()].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
  const days = DAYS.filter((d) => slots.some((s) => s.dayOfWeek === d));

  const subjects = new Map();
  for (const s of slots) {
    if (s.isBreak || !s.subject) continue;
    const id = String(s.subject._id || s.subject);
    if (!subjects.has(id)) subjects.set(id, { code: s.subject.code || '', name: s.subject.name || '', type: s.subject.type || '', faculty: new Set(), periods: 0 });
    const sub = subjects.get(id);
    sub.periods += 1;
    if (s.faculty?.name) sub.faculty.add(s.faculty.name);
  }
  return {
    days,
    columns,
    cell: (day, col) => (cells.get(`${day}|${col.key}`) || []).sort((a, b) => classLabel(a).localeCompare(classLabel(b))),
    multiClass: classes.size > 1,
    classCount: classes.size,
    periodsPerWeek: slots.filter((s) => !s.isBreak).length,
    subjects: [...subjects.values()].sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name)),
  };
}

const columnTitle = (c) => (c.isBreak ? c.breakLabel || 'Break' : c.periods.size ? `Period ${[...c.periods].sort((a, b) => a - b).join(' / ')}` : 'Period');
const columnTime = (c) => `${to12h(c.startTime)} - ${to12h(c.endTime)}`;

/** Text lines for one cell (shared by both formats). */
function cellLines(list, multiClass, col) {
  if (col.isBreak) return { lines: [{ text: (col.breakLabel || 'Break').toUpperCase(), bold: true, color: [0.4, 0.4, 0.45] }], bg: [0.93, 0.93, 0.95] };
  const real = list.filter((s) => !s.isBreak);
  if (!real.length) {
    const brk = list.find((s) => s.isBreak);
    return brk ? { lines: [{ text: (brk.breakLabel || 'Break').toUpperCase(), bold: true, color: [0.4, 0.4, 0.45] }], bg: [0.93, 0.93, 0.95] } : { lines: [{ text: '-', color: [0.65, 0.65, 0.7] }] };
  }
  const lines = [];
  real.forEach((s, i) => {
    if (i > 0) lines.push({ text: ' ', size: 4 });
    const code = s.subject?.code || '';
    const name = s.subject?.name || 'Subject';
    lines.push({ text: code ? `${code} - ${name}` : name, bold: true });
    lines.push({ text: s.faculty?.name || 'Faculty not assigned', color: [0.25, 0.25, 0.35] });
    const extra = [s.room ? `Room ${s.room}` : '', multiClass ? classLabel(s) : ''].filter(Boolean).join(' · ');
    if (extra) lines.push({ text: extra, color: [0.4, 0.4, 0.5] });
  });
  return { lines };
}

const SUBJECT_TYPE = { theory: 'Theory', lab: 'Lab', practical: 'Practical', elective: 'Elective', project: 'Project' };

/* ── PDF ── */

export function timetablePdf({ slots, title, facts = [], footer = '' }) {
  const m = weekModel(slots);
  const doc = new PdfDocument({ title: `Timetable - ${title}`, orientation: 'landscape', margin: 30, footer });
  if (!doc.logo({ maxWidth: 190, maxHeight: 38, spaceAfter: 4 })) doc.line('J.N.N INSTITUTE OF ENGINEERING', { size: 15, bold: true });
  doc.line('CLASS TIMETABLE', { size: 12, bold: true });
  doc.line(asciiSafe(title), { size: 9.5, color: [0.35, 0.35, 0.4] });
  doc.hr();
  doc.facts(facts.map(([k, v]) => [k, asciiSafe(v)]), { size: 8.5 });

  if (!m.days.length) {
    doc.gap(10);
    doc.line('No periods are scheduled for this class yet.', { size: 10, color: [0.5, 0.5, 0.5] });
    return doc.toBuffer();
  }

  doc.section('WEEKLY SCHEDULE', { size: 10 });
  const SIZE = 7;
  const shares = [0.8, ...m.columns.map((c) => (c.isBreak ? 0.72 : 1.25))];
  const total = shares.reduce((a, b) => a + b, 0);
  const widthOf = (i) => (shares[i] / total) * doc.contentWidth - 6;
  const columns = [
    { header: ['Day'], width: shares[0], bold: true },
    ...m.columns.map((c, i) => ({ header: c.isBreak ? [columnTitle(c), `${to12h(c.startTime)} -`, to12h(c.endTime)] : [columnTitle(c), columnTime(c)], width: shares[i + 1] })),
  ];
  const rows = m.days.map((day) => [
    { lines: [{ text: cap(day), bold: true, size: 8 }] },
    ...m.columns.map((col, i) => {
      const cell = cellLines(m.cell(day, col), m.multiClass, col);
      // The PDF table clips; wrap each line to its column first.
      const lines = cell.lines.flatMap((l) =>
        wrap(asciiSafe(l.text), widthOf(i + 1), l.size || SIZE, Boolean(l.bold)).map((t) => ({ ...l, text: t, size: l.size || (l.bold ? SIZE : SIZE - 0.5) }))
      );
      return { lines, bg: cell.bg };
    }),
  ]);
  doc.table({ columns, rows, size: SIZE, headerSize: 7, grid: true, zebra: false });

  if (m.subjects.length) {
    doc.gap(8);
    doc.section('SUBJECTS');
    doc.table({
      columns: [
        { header: 'Code', width: 1 },
        { header: 'Subject', width: 3, bold: true },
        { header: 'Type', width: 0.9 },
        { header: 'Faculty', width: 3 },
        { header: 'Periods / week', width: 1, align: 'right' },
      ],
      rows: m.subjects.map((s) => [asciiSafe(s.code || '-'), asciiSafe(s.name), SUBJECT_TYPE[s.type] || cap(s.type) || '-', asciiSafe([...s.faculty].join(', ') || '-'), String(s.periods)]),
      size: 8,
      headerSize: 8,
      zebra: true,
      grid: true,
    });
  }
  return doc.toBuffer();
}

/* ── Word (.docx) ── */

export function timetableDocx({ slots, title, facts = [], footer = '' }) {
  const m = weekModel(slots);
  const layout = { landscape: true, margin: 600 };
  const width = contentTwips(layout);
  const parts = [];
  const logo = logoParagraph({ maxWidth: 210, maxHeight: 46 });
  parts.push(logo || paragraph('J.N.N INSTITUTE OF ENGINEERING', { bold: true, size: 15, align: 'center', after: 40 }));
  parts.push(paragraph('CLASS TIMETABLE', { bold: true, size: 13, align: 'center', after: 20 }));
  parts.push(paragraph(title, { size: 10, align: 'center', color: [0.35, 0.35, 0.4], after: 120 }));
  if (facts.length) {
    parts.push(paragraph(facts.flatMap(([k, v], i) => [run(`${i ? '     ' : ''}${k}: `, { bold: true, size: 9 }), run(v, { size: 9 })]), { after: 160 }));
  }
  if (!m.days.length) {
    parts.push(paragraph('No periods are scheduled for this class yet.', { size: 10, color: [0.5, 0.5, 0.5] }));
  } else {
    parts.push(paragraph('Weekly schedule', { bold: true, size: 11.5, after: 60, keepNext: true }));
    parts.push(
      table({
        widthTwips: width,
        size: 8,
        columns: [{ header: ['Day'], width: 0.8 }, ...m.columns.map((c) => ({ header: [columnTitle(c), { text: columnTime(c), size: 6.5 }], width: c.isBreak ? 0.72 : 1.25 }))],
        rows: m.days.map((day) => [{ lines: [{ text: cap(day), bold: true }] }, ...m.columns.map((col) => cellLines(m.cell(day, col), m.multiClass, col))]),
      })
    );
    if (m.subjects.length) {
      parts.push(paragraph('Subjects', { bold: true, size: 11.5, before: 240, after: 60, keepNext: true }));
      parts.push(
        table({
          widthTwips: width,
          size: 9,
          columns: [{ header: 'Code', width: 1 }, { header: 'Subject', width: 3 }, { header: 'Type', width: 0.9 }, { header: 'Faculty', width: 3 }, { header: 'Periods / week', width: 1 }],
          rows: m.subjects.map((s) => [s.code || '-', { lines: [{ text: s.name, bold: true }] }, SUBJECT_TYPE[s.type] || cap(s.type) || '-', [...s.faculty].join(', ') || '-', String(s.periods)]),
        })
      );
    }
  }
  return buildDocx({ body: parts.join(''), title: `Timetable - ${title}`, footer, ...layout });
}
