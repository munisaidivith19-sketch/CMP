export const ROLES = ['student', 'club_admin', 'faculty', 'hod', 'principal', 'admin', 'security', 'dean', 'ao', 'chairman', 'warden', 'alumni', 'coe', 'office', 'transport', 'super_admin'];
// Platform-level Super Admin (policies.js, controllers/superAdminController.js).
// Never assignable from the admin panel or any request body: provisioned only
// with server/scripts/create-super-admin.mjs, and confined to /super-admin/*.
export const SUPER_ADMIN_ROLE = 'super_admin';
// Roles an ordinary Admin may hand out. Admin accounts are created and managed
// by a Super Admin only; Super Admin is never assignable over the API.
export const ADMIN_ASSIGNABLE_ROLES = ROLES.filter((r) => r !== 'admin' && r !== SUPER_ADMIN_ROLE);
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

// ── Controller of Examinations (COE) ────────────────────────────────
// The COE manages exam timetables campus-wide and READS class timetables and
// attendance campus-wide. It is deliberately NOT a college-wide role: People,
// Chat, Gate Pass and every other module stay closed to it (enforced by the
// coeRouteGuard middleware, deny-by-default).
export const COE_ROLE = 'coe';
// The administrative Office: READ-ONLY college-wide student and faculty
// attendance, history, summaries, reports and the low-attendance monitor —
// nothing else (no timetables, users, gate passes, chat …; enforced by the
// confined-role guard, deny-by-default).
export const OFFICE_ROLE = 'office';
// Campus-wide academic READ: attendance and attendance reports (and, for all
// but the Office, the class timetable).
// The Super Admin reads attendance campus-wide too, read-only (its confined-role
// guard allows GET only; the timetable stays closed to it).
export const ACADEMIC_OVERSIGHT_ROLES = [...COLLEGE_WIDE_ROLES, COE_ROLE, OFFICE_ROLE, SUPER_ADMIN_ROLE];
// Roles whose attendance access is read-only (they never mark or edit).
export const ATTENDANCE_READ_ONLY_ROLES = [...ACADEMIC_READ_ONLY_ROLES, COE_ROLE, OFFICE_ROLE, SUPER_ADMIN_ROLE];
// Faculty (staff) attendance reports: HOD (own department) and the college
// roles; the COE's attendance view is student attendance only.
export const STAFF_REPORT_ROLES = ['hod', 'principal', 'office', 'admin', 'dean', 'chairman', 'ao', SUPER_ADMIN_ROLE];

// Who may READ attendance: the people who mark it, plus the campus-wide readers.
export const ATTENDANCE_VIEW_ROLES = ['faculty', 'hod', ...ACADEMIC_OVERSIGHT_ROLES];
// Who sees the daily college/department headcount summary.
export const ATTENDANCE_SUMMARY_ROLES = ['hod', ...ACADEMIC_OVERSIGHT_ROLES];
// Who can browse the People directory at all. Students (and club admins) see
// only their own class: classmates plus that class's faculty.
export const PEOPLE_DIRECTORY_ROLES = ['student', 'club_admin', 'faculty', 'hod', ...COLLEGE_WIDE_ROLES];
// Every role an admin can hand out credentials for from the admin panel.
export const STAFF_ROLES = ['faculty', 'hod', 'principal', 'admin', 'security', 'dean', 'ao', 'chairman', 'warden', 'coe', 'office', 'transport'];
// Roles with no department of their own (skip the "department required" rule).
export const NO_DEPARTMENT_ROLES = ['principal', 'security', 'dean', 'ao', 'chairman', 'warden', 'coe', 'office', 'transport'];

// ── College buses ────────────────────────────────────────────────────
// Transport officer: manages buses, routes, stops and student assignments, and
// may run trips. Confined to the Bus Tracking module (coeGuard.js).
export const TRANSPORT_ROLE = 'transport';
export const TRANSPORT_MANAGE_ROLES = ['admin', TRANSPORT_ROLE];
// May see the live bus map. Alumni, COE and Office have no transport module.
export const TRANSPORT_VIEW_ROLES = ['student', 'club_admin', 'faculty', 'hod', 'principal', 'admin', 'security', 'dean', 'ao', 'chairman', 'warden', TRANSPORT_ROLE];
// May share their phone's location for a bus they are assigned to (dean, faculty, HOD, AO, transport officer).
export const TRIP_SHARER_ROLES = ['faculty', 'hod', 'dean', 'ao', TRANSPORT_ROLE];
export const BUS_GPS_SOURCES = ['tracker', 'phone'];
// Which way a bus trip runs. Trips started without one (older app versions) are
// recorded as towards_college with `directionAssumed`.
export const BUS_TRIP_DIRECTIONS = ['towards_college', 'towards_home'];
// Journey history and reports for every bus. Trip sharers (faculty, HOD, …)
// additionally see the trips they ran themselves.
export const TRANSPORT_HISTORY_ROLES = [...TRANSPORT_MANAGE_ROLES, 'principal', 'dean', 'ao', 'chairman'];
export const STAY_TYPES = ['hosteler', 'day_scholar'];
export const normalizePhoneDigits = (val) => {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
};
// Honorific shown before a person's name (Ms. / Mr. / Dr.) and their gender.
// Mr needs male and Ms needs female; Dr may be either.
export const TITLES = ['Ms', 'Mr', 'Dr'];
export const GENDERS = ['male', 'female'];

// ── Academic structure ──────────────────────────────────────────────
// A class is Department + Year + Section + Semester. The department string
// already carries the program (e.g. 'CSE (Cyber Security)').
export const DEPARTMENTS = ['CSE (Cyber Security)', 'CSE', 'AI & DS', 'ECE', 'VLSI', 'Robotics', 'Agri', 'Bio Medical', 'Science & Humanities'];
export const FIRST_YEAR_HOD_DEPT = 'Science & Humanities';
export const isFirstYearHod = (u) => u?.role === 'hod' && u?.department === FIRST_YEAR_HOD_DEPT;
export const isBranchHod = (u) => u?.role === 'hod' && u?.department !== FIRST_YEAR_HOD_DEPT;
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
// Alumni are graduates outside the campus academic system: no timetable either.
export const TIMETABLE_BLOCKED_ROLES = ['warden', 'security', 'alumni', 'office', TRANSPORT_ROLE, SUPER_ADMIN_ROLE];
export const TIMETABLE_VIEW_ROLES = ROLES.filter((r) => !TIMETABLE_BLOCKED_ROLES.includes(r));
// Admin manages the whole college; HOD is restricted to their own department
// (enforced in the controller, never trusting a client-supplied department).
export const TIMETABLE_WRITE_ROLES = ['admin', 'hod'];

// ── Exam timetable ──────────────────────────────────────────────────
// Create / edit / publish / cancel: HOD (own department scope) and COE
// (campus-wide) only — re-checked in the controller against the exam's scope.
export const EXAM_MANAGE_ROLES = ['hod', COE_ROLE];
// Read: every role with timetable access. Non-managers only ever see
// published (and cancelled) exams of the classes that concern them.
export const EXAM_VIEW_ROLES = TIMETABLE_VIEW_ROLES;
export const EXAM_STATUSES = ['draft', 'published', 'cancelled'];

// ── Study Materials ─────────────────────────────────────────────────
// Same "no access at all" roles as the timetable.
// Alumni must not read current students' course material or run the Study Assistant on it.
// The AO (administrative officer) has no academic role here either.
// The COE is limited to timetables and attendance (see COE_ROLE).
export const STUDY_MATERIAL_BLOCKED_ROLES = ['warden', 'security', 'alumni', 'ao', COE_ROLE, OFFICE_ROLE, TRANSPORT_ROLE, SUPER_ADMIN_ROLE];
// Upload status of each class: HOD (own scope); Principal, Dean and Chairman (any department).
export const STUDY_MATERIAL_STATUS_ROLES = ['hod', 'principal', 'dean', 'chairman'];
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
// all = the main campus-wide announcement; department / year / section narrow it
// to one class level of one department (year may span every department).
export const AUDIENCE_SCOPES = ['all', 'department', 'year', 'section', 'club'];
// Only the Principal publishes the main (campus-wide) announcement.
export const MAIN_ANNOUNCEMENT_ROLES = ['principal'];
// Department / year / section announcements: Principal anywhere, HOD in their own scope.
export const CLASS_ANNOUNCEMENT_ROLES = ['principal', 'hod'];
// Oversight roles that read every announcement regardless of audience.
export const ANNOUNCEMENT_READ_ALL_ROLES = ['admin', 'principal', 'chairman', 'dean', 'ao'];

export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'misinformation', 'other'];
export const REPORT_TARGETS = ['discussion', 'reply', 'event', 'announcement', 'club', 'user'];
export const REPORT_ACTIONS = ['dismiss', 'hide', 'delete', 'warn', 'suspend'];

// What a notification is about, for preferences and Android channels. Users
// may switch OFF only the optional ones; gate-pass decisions, SOS, their own
// attendance and staff duties (substitutes, early exits, exams) always arrive.
export const NOTIFICATION_CATEGORIES = [
  'announcement', 'event', 'chat', 'attendance', 'gate_pass', 'student_entry', 'timetable', 'reminder',
  'substitute', 'staff', 'exam', 'sos', 'system', 'transport',
];
export const OPTIONAL_NOTIFICATION_CATEGORIES = ['chat', 'reminder', 'student_entry', 'event', 'announcement', 'timetable', 'transport'];
// Heads-up (high priority) only where acting promptly matters.
export const HIGH_PRIORITY_CATEGORIES = ['sos', 'gate_pass', 'reminder', 'substitute'];
export const REMINDER_MINUTES = [5, 10, 15, 20, 30];
export const NOTIFICATION_TYPES = [
  'announcement', 'event', 'club', 'discussion', 'report', 'system',
  'chat', 'attendance', 'gate_pass', 'lost_found', 'timetable', 'complaint', 'alumni', 'achievement', 'sos', 'transport',
  'skill_wallet',
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
// HOD group kinds: custom (own-department students across years/sections +
// faculty), academic (one class + faculty), faculty (staff only).
export const GROUP_CATEGORIES = ['custom', 'academic', 'faculty'];

// ── Attendance ──────────────────────────────────────────────────────
export const ATTENDANCE_STATUSES = ['present', 'absent'];
export const CORRECTION_STATUSES = ['pending', 'approved', 'rejected'];

// ── Holidays ────────────────────────────────────────────────────────
// Only the Principal declares, edits or cancels a holiday. Everyone who can
// see a timetable can read the holidays that apply to them.
export const HOLIDAY_MANAGE_ROLES = ['principal'];
export const HOLIDAY_TYPES = ['SINGLE', 'CUSTOM'];
export const HOLIDAY_STATUSES = ['ACTIVE', 'CANCELLED'];
// Longest range one holiday may cover.
export const HOLIDAY_MAX_DAYS = 366;

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

// ── Alumni Network ──────────────────────────────────────────────────
export const MENTORSHIP_DOMAINS = [
  'software_engineering', 'cybersecurity', 'data_science', 'core_engineering',
  'higher_studies', 'government_exams', 'entrepreneurship', 'other',
];
export const MENTORSHIP_STATUSES = ['pending', 'accepted', 'declined', 'completed', 'cancelled', 'expired'];

export const PRIVACY_LEVELS = ['public', 'mentees', 'staff', 'hidden'];
export const PRIVACY_FIELDS = ['email', 'phone', 'linkedin', 'company', 'designation', 'location'];
export const DEFAULT_PRIVACY = {
  email: 'mentees',
  phone: 'hidden',
  linkedin: 'public',
  company: 'public',
  designation: 'public',
  location: 'public',
};

export const JOB_TYPES = ['full_time', 'internship', 'part_time', 'contract'];
export const JOB_WORK_MODES = ['onsite', 'remote', 'hybrid'];
export const JOB_STATUSES = ['pending_review', 'open', 'closed', 'expired', 'removed'];
export const JOB_APPLY_MODES = ['referral', 'external_link'];
export const JOB_APPLICATION_STATUSES = ['applied', 'referred', 'shortlisted', 'rejected', 'withdrawn'];

export const ALUMNI_EVENT_TYPES = ['reunion', 'webinar', 'guest_talk', 'networking', 'workshop', 'other'];
export const ALUMNI_EVENT_MODES = ['in_person', 'online', 'hybrid'];
export const ALUMNI_EVENT_STATUSES = ['pending_approval', 'scheduled', 'cancelled', 'completed', 'rejected'];
export const RSVP_STATUSES = ['going', 'waitlisted', 'cancelled'];

export const SLOT_STATUSES = ['open', 'booked', 'cancelled'];
export const SESSION_MODES = ['video', 'phone', 'in_person', 'chat'];
export const SESSION_STATUSES = ['confirmed', 'completed', 'cancelled', 'no_show'];

export const CHAPTER_TYPES = ['batch', 'department', 'interest', 'city'];
export const CHAPTER_ROLES = ['member', 'moderator'];
export const CHAPTER_POST_KINDS = ['post', 'announcement'];

export const INVITE_STATUSES = ['pending', 'claimed', 'expired', 'revoked'];
export const IMPORT_STATUSES = ['validated', 'processing', 'done', 'failed'];

export const STAFF_ALUMNI = ['admin', 'hod'];
export const VIEW_ALUMNI_ANALYTICS = ['admin', 'hod', 'principal', 'chairman', 'dean'];


// Student achievements: only the Principal and HODs post (HOD: own department only).
export const ACHIEVEMENT_POST_ROLES = ['principal', 'hod'];
export const ACHIEVEMENT_MODERATE_ROLES = ['admin'];
export const ACHIEVEMENT_STATS_ROLES = ['principal', 'hod', 'admin'];
export const ACHIEVEMENT_BLOCKED_ROLES = ['warden', 'security', COE_ROLE, OFFICE_ROLE, TRANSPORT_ROLE, SUPER_ADMIN_ROLE];
export const ACHIEVEMENT_VIEW_ROLES = ROLES.filter((r) => !ACHIEVEMENT_BLOCKED_ROLES.includes(r));
export const ACHIEVEMENT_CATEGORIES = [
  'academic', 'sports', 'technical', 'cultural', 'research', 'placement', 'competition', 'certification', 'other',
];
export const ACHIEVEMENT_LEVELS = ['college', 'state', 'national', 'international'];
export const ACHIEVEMENT_POSITIONS = [
  'winner', 'first', 'second', 'third', 'runner_up', 'finalist', 'participant', 'selected', 'published', 'other',
];

// ── Skill Wallet ────────────────────────────────────────────────────
// Students own projects, NPTEL certificates and profile links.
export const SKILL_WALLET_STUDENT_ROLES = ['student', 'club_admin'];
// "College-only" content is visible to these signed-in roles. Confined roles
// (COE, Office, Transport, Super Admin), Security, Warden and Alumni are outside.
export const SKILL_WALLET_COLLEGE_ROLES = ['student', 'club_admin', 'faculty', 'hod', 'principal', 'dean', 'ao', 'chairman', 'admin'];
// Staff who may receive a Skill Wallet designation (reviewer, verifier, coordinator).
export const SKILL_WALLET_STAFF_ROLES = ['faculty', 'hod', 'principal', 'dean'];
// Only the Principal grants / revokes Skill Wallet designations. Holding the
// Principal role does NOT by itself grant review, verification or publication rights.
export const SKILL_WALLET_DESIGNATION_GRANTORS = ['principal'];
export const SKILL_WALLET_CAPABILITIES = ['innovation_coordinator', 'project_reviewer', 'certificate_verifier'];
export const SW_PROJECT_STAGES = ['developing', 'implemented'];
export const SW_PROJECT_MODES = ['solo', 'team'];
export const SW_VISIBILITY = ['private', 'college', 'public'];
export const SW_REVIEW_STATUSES = ['draft', 'submitted', 'changes_requested', 'approved', 'rejected'];
export const SW_REVIEW_DECISIONS = ['approve', 'request_changes', 'reject'];
export const SW_INVITATION_STATUSES = ['pending', 'accepted', 'declined', 'cancelled', 'expired'];
export const SW_CERT_STATUSES = ['pending', 'verified', 'correction_requested', 'rejected'];
export const SW_CERT_DECISIONS = ['verified', 'correction_requested', 'rejected'];
export const SW_LINK_PLATFORMS = ['github', 'linkedin', 'hackerrank', 'leetcode', 'tryhackme', 'hackthebox', 'portfolio', 'kaggle', 'codeforces', 'other'];
export const SW_RECOMMENDATION_KINDS = ['funding', 'incubation'];
export const SW_RECOMMENDATION_STATUSES = ['open', 'acknowledged', 'closed'];
export const SW_MILESTONE_KINDS = ['patent_filed', 'patent_granted', 'startup_registered', 'funding_received', 'other'];
export const SW_MILESTONE_STATUSES = ['claimed', 'verified', 'rejected'];

// ── Campus SOS ──────────────────────────────────────────────────────
export const SOS_TYPES = ['medical', 'security', 'fire', 'ragging', 'other'];
export const SOS_STATUSES = ['active', 'acknowledged', 'resolved', 'false_alarm'];
export const SOS_RESPONDER_ROLES = ['security', 'admin', 'hod', 'principal', 'chairman'];
export const SOS_BROADCAST_ROLES = ROLES.filter((r) => r !== SUPER_ADMIN_ROLE);

// ── Hostel dashboard ────────────────────────────────────────────────
// Who sees the hostel overview (head-counts, who is inside / outside campus).
export const HOSTEL_VIEW_ROLES = ['admin', 'principal', 'dean', 'ao', 'chairman', 'warden', SUPER_ADMIN_ROLE];
