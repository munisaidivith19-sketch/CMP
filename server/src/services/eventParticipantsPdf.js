import { PdfDocument, asciiSafe } from '../utils/pdf.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

const fmtDate = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Generate an official Event Participant List PDF buffer with the institutional college logo.
 */
export async function generateEventParticipantsPdfBuffer(event) {
  const registrations = event.registrations || [];
  const confirmed = registrations.filter((r) => r.status !== 'waitlisted');
  const waitlist = registrations.filter((r) => r.status === 'waitlisted');
  const attended = registrations.filter((r) => r.status === 'attended');

  const coordinatorsText = (event.facultyCoordinators || [])
    .map((fc) => `${fc.name}${fc.department ? ` (${fc.department})` : ''}`)
    .join(', ');

  const doc = new PdfDocument({
    title: `Participants - ${event.title}`,
    orientation: 'portrait',
    margin: 32,
    footer: `J.N.N Institute of Engineering · Event Participants Roster · Generated ${new Date().toLocaleDateString('en-IN')}`,
  });

  // 1. Official Institutional College Logo Header
  if (!doc.logo({ maxWidth: 220, maxHeight: 52, spaceAfter: 8 })) {
    doc.line('J.N.N INSTITUTE OF ENGINEERING', { size: 14, bold: true });
  }

  doc.line('CAMPUSCONNECT - EVENT PARTICIPANT ROSTER', { size: 10.5, bold: true, color: [0.35, 0.35, 0.4] });
  doc.line(asciiSafe(event.title).toUpperCase(), { size: 13, bold: true, color: [0.15, 0.2, 0.45] });
  doc.hr();

  // 2. Event Metadata Facts Block
  doc.facts([
    ['Event Title', event.title],
    ['Category', cap(event.category || 'General')],
    ['Schedule', `${fmtDate(event.startDate)} - ${fmtDate(event.endDate)}`],
    ['Venue', event.venue || 'Campus'],
    ['Organised By', event.club?.name || event.organizer?.name || 'College'],
    ['Faculty Coordinators', coordinatorsText || 'Coordinated by Department HOD'],
    ['Registrations', `${confirmed.length} Confirmed (${attended.length} Attended)`],
    ['Waitlist Count', `${waitlist.length} Waitlisted`],
    ['Capacity', event.capacity ? `${event.capacity} Max` : 'Unlimited'],
    ['Generated On', new Date().toLocaleString('en-IN')],
  ]);
  doc.gap(4);
  doc.hr();

  // 3. Confirmed Participants Table
  doc.section(`CONFIRMED PARTICIPANTS (${confirmed.length})`);

  const columns = [
    { header: '#', width: 0.45, align: 'right' },
    { header: 'Roll No', width: 1.15 },
    { header: 'Participant Name', width: 2.7, bold: true },
    { header: 'Department', width: 1.5 },
    { header: 'Yr / Sec', width: 0.9 },
    { header: 'Status', width: 0.95, align: 'center' },
  ];

  if (confirmed.length === 0) {
    doc.line('No confirmed participants registered yet.', { size: 9.5, color: [0.5, 0.5, 0.5] });
  } else {
    const rows = confirmed.map((r, i) => [
      String(i + 1),
      r.user?.rollNo || '-',
      r.user?.name || 'Student',
      r.user?.department || '-',
      `${r.user?.year ? `Y${r.user.year}` : '-'}${r.user?.section ? ` / ${r.user.section}` : ''}`,
      r.status === 'attended' ? 'Attended' : 'Registered',
    ]);
    doc.table({ columns, rows, size: 8.5, headerSize: 8.5, zebra: true });
  }

  // 4. Waitlist Table (if any)
  if (waitlist.length > 0) {
    doc.section(`WAITLISTED REGISTRATIONS (${waitlist.length})`);
    const waitlistRows = waitlist.map((r, i) => [
      String(i + 1),
      r.user?.rollNo || '-',
      r.user?.name || 'Student',
      r.user?.department || '-',
      `${r.user?.year ? `Y${r.user.year}` : '-'}${r.user?.section ? ` / ${r.user.section}` : ''}`,
      'Waitlist',
    ]);
    doc.table({ columns, rows: waitlistRows, size: 8.5, headerSize: 8.5, zebra: true });
  }

  return doc.toBuffer();
}

