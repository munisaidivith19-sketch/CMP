export const ROLES = ['student', 'club_admin', 'faculty', 'hod', 'principal', 'admin', 'security', 'dean', 'ao', 'chairman', 'warden'];
// Can mark attendance, moderate content and see beyond their own record.
export const MODERATOR_ROLES = ['admin', 'faculty', 'hod', 'principal'];
// Department-scoped management: sees/acts on their own department only.
export const HOD_ROLES = ['hod'];

// ── Academic visibility ─────────────────────────────────────────────
// The ONLY roles with college-wide academic visibility: People, Timetable,
// Attendance and attendance reports across every department. Every other role
// is scoped to its own department (HOD) or its own teaching assignment
// (faculty); Security and Warden get no academic directory at all.
// This single list is what People, Timetable, Attendance and the report
// service all consult — there is no second definition anywhere.
export const COLLEGE_WIDE_ROLES = ['admin', 'principal', 'chairman', 'dean', 'ao'];
// College-wide authority is read-only: marking attendance and timetable writes
// stay with admin / HOD / faculty.
export const ACADEMIC_READ_ONLY_ROLES = COLLEGE_WIDE_ROLES.filter((r) => r !== 'admin');
// Who may READ attendance: the people who mark it, plus the college-wide roles.
export const ATTENDANCE_VIEW_ROLES = ['faculty', 'hod', ...COLLEGE_WIDE_ROLES];
// Who sees the daily college/department headcount summary.
export const ATTENDANCE_SUMMARY_ROLES = ['hod', ...COLLEGE_WIDE_ROLES];
// Who can browse the People directory at all (students: no directory, only
// single-profile lookups).
export const PEOPLE_DIRECTORY_ROLES = ['faculty', 'hod', ...COLLEGE_WIDE_ROLES];
// Every role an admin can hand out credentials for from the admin panel.
export const STAFF_ROLES = ['faculty', 'hod', 'principal', 'admin', 'security', 'dean', 'ao', 'chairman', 'warden'];
// Roles with no department of their own (skip the "department required" rule).
export const NO_DEPARTMENT_ROLES = ['principal', 'security', 'dean', 'ao', 'chairman', 'warden'];
export const STAY_TYPES = ['hosteler', 'day_scholar'];

// ── Academic structure ──────────────────────────────────────────────
// A class is Department + Year + Section + Semester. The department string
// already carries the program (e.g. 'CSE (Cyber Security)').
export const DEPARTMENTS = ['CSE (Cyber Security)', 'CSE', 'AI & DS', 'ECE', 'VLSI', 'Robotics', 'Agri', 'Bio Medical'];
export const ACADEMIC_YEARS = [1, 2, 3, 4];
// Human label for a year, used in generated reports.
export const YEAR_LABEL = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
export const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];
export const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'];
// Year 1 → semesters 1/2, year 2 → 3/4, year 3 → 5/6, year 4 → 7/8.
export const yearOfSemester = (semester) => Math.ceil(Number(semester) / 2);

// ── Timetable ───────────────────────────────────────────────────────
// Warden and Security have zero timetable access (view, write, sockets,
// notifications) — every other role keeps its existing visibility.
export const TIMETABLE_BLOCKED_ROLES = ['warden', 'security'];
export const TIMETABLE_VIEW_ROLES = ROLES.filter((r) => !TIMETABLE_BLOCKED_ROLES.includes(r));
// Admin manages the whole college; HOD is restricted to their own department
// (enforced in the controller, never trusting a client-supplied department).
export const TIMETABLE_WRITE_ROLES = ['admin', 'hod'];

// ── Study Materials ─────────────────────────────────────────────────
// Same "no access at all" roles as the timetable.
export const STUDY_MATERIAL_BLOCKED_ROLES = ['warden', 'security'];
export const STUDY_MATERIAL_VIEW_ROLES = ROLES.filter((r) => !STUDY_MATERIAL_BLOCKED_ROLES.includes(r));
// Upload/edit/delete: faculty only for their own current timetable assignment,
// HOD only within their own department, admin college-wide — enforced in the
// controller (never by role alone).
export const STUDY_MATERIAL_WRITE_ROLES = ['faculty', 'hod', 'admin'];
export const STUDY_MATERIAL_CATEGORIES = ['notes', 'question_bank', 'lab_manual', 'syllabus', 'assignment', 'other'];

export const CLUB_CATEGORIES = [
  'technical',
  'cultural',
  'sports',
  'arts',
  'literary',
  'social-service',
  'entrepreneurship',
  'other',
];

export const EVENT_CATEGORIES = [
  'technical',
  'cultural',
  'sports',
  'workshop',
  'seminar',
  'hackathon',
  'social',
  'career',
  'other',
];

export const DISCUSSION_CATEGORIES = [
  'general',
  'academics',
  'placements',
  'events',
  'clubs',
  'help',
  'other',
];

export const ANNOUNCEMENT_PRIORITIES = ['normal', 'important', 'urgent'];
export const AUDIENCE_SCOPES = ['all', 'department', 'year', 'club'];

export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'misinformation', 'other'];
export const REPORT_TARGETS = ['discussion', 'reply', 'event', 'announcement', 'club', 'user'];
export const REPORT_ACTIONS = ['dismiss', 'hide', 'delete', 'warn', 'suspend'];

export const NOTIFICATION_TYPES = [
  'announcement', 'event', 'club', 'discussion', 'report', 'system',
  'chat', 'attendance', 'gate_pass', 'lost_found', 'timetable', 'complaint',
];

// ── Gate Pass ───────────────────────────────────────────────────────
// A request climbs pending_faculty → parent_verified (parent OTP confirmed by
// the class faculty) → pending_hod → pending_principal before it is usable;
// any stage can reject it instead.
// An emergency pass skips that chain: pending_authority → approved by the one
// authority the student chose (no faculty, HOD or parent OTP).
export const GATE_PASS_STATUSES = [
  'pending_faculty', 'parent_verified', 'pending_hod', 'pending_principal', 'pending_authority',
  'approved', 'rejected', 'active', 'completed', 'expired', 'revoked', 'cancelled',
];
export const GATE_PASS_PENDING_STATUSES = ['pending_faculty', 'parent_verified', 'pending_hod', 'pending_principal', 'pending_authority'];
export const GATE_PASS_REGARDING = ['outing', 'home'];
export const GATE_PASS_STAGES = ['faculty', 'hod', 'principal', 'authority'];
export const GATE_PASS_TYPES = ['normal', 'emergency'];
export const EMERGENCY_AUTHORITIES = ['principal', 'ao', 'dean', 'chairman'];

// ── Lost & Found ────────────────────────────────────────────────────
export const LOST_FOUND_TYPES = ['lost', 'found'];
export const LOST_FOUND_CATEGORIES = [
  'electronics', 'documents', 'clothing', 'accessories', 'books',
  'keys', 'wallet', 'bag', 'sports', 'other',
];
export const LOST_FOUND_STATUSES = [
  'lost', 'found', 'possible_match', 'under_verification', 'returned', 'closed',
];

// ── Chat ────────────────────────────────────────────────────────────
export const CONVERSATION_TYPES = ['private', 'group', 'class', 'club'];

// ── Attendance ──────────────────────────────────────────────────────
export const ATTENDANCE_STATUSES = ['present', 'absent'];
export const CORRECTION_STATUSES = ['pending', 'approved', 'rejected'];

// ── Timetable ───────────────────────────────────────────────────────
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ── Complaints ──────────────────────────────────────────────────────
export const COMPLAINT_CATEGORIES = ['academics', 'ragging_harassment', 'infrastructure', 'hostel'];
export const COMPLAINT_SUBCATEGORIES = {
  academics: ['subject', 'faculty_conduct', 'attendance', 'exam_and_evaluation'],
  ragging_harassment: [],
  infrastructure: ['classroom', 'network', 'water', 'restroom', 'electronic_appliance', 'environment_and_pathway'],
  hostel: ['mess', 'electricity', 'water', 'housekeeping', 'pest_control', 'laundry', 'network', 'restroom'],
};
export const COMPLAINT_ESCALATE_TO = {
  academics: ['faculty', 'hod', 'principal', 'dean', 'ao', 'chairman'],
  ragging_harassment: ['hod', 'principal', 'dean', 'ao', 'chairman'],
  infrastructure: ['hod', 'principal', 'dean', 'ao', 'chairman'],
  hostel: ['warden', 'ao', 'chairman'],
};
// The escalation chain a complaint climbs once its initial authority doesn't
// resolve it in time — configured here rather than hardcoded in the frontend
// or duplicated across the controller.
export const COMPLAINT_ESCALATION_CHAINS = {
  faculty: ['faculty', 'hod', 'principal', 'dean', 'chairman'],
  hod: ['hod', 'principal', 'dean', 'chairman'],
  principal: ['principal', 'dean', 'chairman'],
  dean: ['dean', 'chairman'],
  ao: ['ao', 'chairman'],
  warden: ['warden', 'ao', 'chairman'],
  chairman: ['chairman'],
};
export const COMPLAINT_STATUSES = [
  'SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED',
  'NOT_RESOLVED', 'ESCALATED', 'CANCELLED', 'CLOSED',
];
// Statuses a complaint can still be cancelled or escalated from.
export const COMPLAINT_OPEN_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'ESCALATED', 'NOT_RESOLVED'];
export const COMPLAINT_CANCELLABLE_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS'];
export const COMPLAINT_PRIORITIES = ['low', 'normal', 'high'];
export const COMPLAINT_NOT_RESOLVED_WAIT_MS = 8 * 60 * 60 * 1000;
