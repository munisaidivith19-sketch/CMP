export const ROLES = ['student', 'club_admin', 'faculty', 'hod', 'principal', 'admin', 'security', 'dean', 'ao', 'chairman', 'warden', 'alumni'];
export const ROLE_LABELS = {
  student: 'Student', club_admin: 'Club Admin', faculty: 'Faculty', hod: 'HOD', principal: 'Principal', admin: 'Admin', security: 'Security',
  dean: 'Dean', ao: 'AO', chairman: 'Chairman', warden: 'Warden', alumni: 'Alumni',
};

export const STUDENT_ROLES = ['student', 'club_admin'];
/** Can act on academic data (mark attendance, moderate…). */
export const STAFF = ['admin', 'faculty', 'hod'];
/** Staff plus the read-only principal. Used across clubs/events/discussions. */
export const STAFF_VIEW = [...STAFF, 'principal'];

// ── Academic visibility ─────────────────────────────────────────────
// Mirrors server/src/constants.js — the server is the authority; these only
// decide what the UI offers.
/** The only roles with college-wide academic visibility (read-only bar admin). */
export const COLLEGE_WIDE = ['admin', 'principal', 'chairman', 'dean', 'ao'];
/** Sees the staff Attendance console. */
export const ATTENDANCE_VIEW = ['faculty', 'hod', ...COLLEGE_WIDE];
/** In Attendance, these roles read but never mark or review. */
export const ATTENDANCE_READ_ONLY = COLLEGE_WIDE.filter((r) => r !== 'admin');
/** Can browse the People directory (students get single profiles only). */
export const PEOPLE_DIRECTORY = ['faculty', 'hod', ...COLLEGE_WIDE];
/** Sees the daily college / department attendance summary. */
export const SUMMARY_VIEW = ['hod', ...COLLEGE_WIDE];
/** The gate pass approval chain, in order. */
export const GATE_APPROVAL_ROLES = ['faculty', 'hod', 'principal'];
export const STAY_TYPES = { hosteler: 'Hosteler', day_scholar: 'Day Scholar' };

export const DEPARTMENTS = ['CSE (Cyber Security)', 'CSE', 'AI & DS', 'ECE', 'VLSI', 'Robotics', 'Agri', 'Bio Medical'];

// Section letter skips "I" (easily confused with "1"), matching the college's
// own section-naming convention. Every section entry field across the app
// (user management, timetable, attendance) picks from this fixed list.
export const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'];

// A class is Department + Year + Section + Semester; the server enforces the same rule.
export const ACADEMIC_YEARS = [1, 2, 3, 4];
export const YEAR_LABELS = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
export const yearOfSemester = (semester) => Math.ceil(Number(semester) / 2);
/** The two semesters of a year (year 3 → [5, 6]); all eight when no year is chosen. */
export const semestersOfYear = (year) => (year ? [Number(year) * 2 - 1, Number(year) * 2] : [1, 2, 3, 4, 5, 6, 7, 8]);

export const STUDY_MATERIAL_CATEGORY_LABELS = {
  notes: 'Notes',
  question_bank: 'Question Bank',
  lab_manual: 'Lab Manual',
  syllabus: 'Syllabus',
  assignment: 'Assignment',
  other: 'Other',
};
// Warden/Security/Alumni have no access to Study Materials, same as the timetable.
export const STUDY_MATERIAL_BLOCKED_ROLES = ['warden', 'security', 'alumni'];

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** Roles that can add, edit and delete timetable periods (HOD: own department only). */
export const TIMETABLE_EDITORS = ['admin', 'hod'];
/** Roles that can access the timetable (warden and security excluded). */
export const TIMETABLE_ROLES = ROLES.filter((r) => !['warden', 'security'].includes(r));

export const GATE_PASS_REGARDING = { outing: 'Outing', home: 'Home' };

// ── Complaints ──────────────────────────────────────────────────────
// Labels only — the authoritative escalation chain / routing rules live on
// the server (server/src/constants.js) and are never re-derived here.
export const COMPLAINT_CATEGORY_LABELS = {
  academics: 'Academics',
  ragging_harassment: 'Ragging & Harassment',
  infrastructure: 'Infrastructure',
  hostel: 'Hostel',
};
export const COMPLAINT_SUBCATEGORY_OPTIONS = {
  academics: [
    { value: 'subject', label: 'Subject' },
    { value: 'faculty_conduct', label: 'Faculty Conduct' },
    { value: 'attendance', label: 'Attendance' },
    { value: 'exam_and_evaluation', label: 'Exam and Evaluation' },
  ],
  ragging_harassment: [],
  infrastructure: [
    { value: 'classroom', label: 'Classroom' },
    { value: 'network', label: 'Network' },
    { value: 'water', label: 'Water' },
    { value: 'restroom', label: 'Restroom' },
    { value: 'electronic_appliance', label: 'Electronic Appliance' },
    { value: 'environment_and_pathway', label: 'Environment & Pathway' },
  ],
  hostel: [
    { value: 'mess', label: 'Mess' },
    { value: 'electricity', label: 'Electricity' },
    { value: 'water', label: 'Water' },
    { value: 'housekeeping', label: 'Housekeeping' },
    { value: 'pest_control', label: 'Pest Control' },
    { value: 'laundry', label: 'Laundry' },
    { value: 'network', label: 'Network' },
    { value: 'restroom', label: 'Restroom' },
  ],
};
export const COMPLAINT_ESCALATE_TO_OPTIONS = {
  academics: ['faculty', 'hod', 'principal', 'dean', 'ao', 'chairman'],
  ragging_harassment: ['hod', 'principal', 'dean', 'ao', 'chairman'],
  infrastructure: ['hod', 'principal', 'dean', 'ao', 'chairman'],
  hostel: ['warden', 'ao', 'chairman'],
};

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

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

export const DISCUSSION_CATEGORIES = ['general', 'academics', 'placements', 'events', 'clubs', 'help', 'other'];
export const PRIORITIES = ['normal', 'important', 'urgent'];
export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'misinformation', 'other'];

/** Accent colours per category — gradient + soft tint. */
export const CATEGORY_STYLES = {
  technical: { grad: 'from-violet-400 to-indigo-500', soft: 'bg-violet-500/10 text-violet-600 dark:text-violet-300', hex: '#7c6cf0' },
  hackathon: { grad: 'from-fuchsia-400 to-purple-600', soft: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300', hex: '#c05cf0' },
  workshop: { grad: 'from-sky-400 to-blue-500', soft: 'bg-sky-500/10 text-sky-600 dark:text-sky-300', hex: '#38a9f0' },
  seminar: { grad: 'from-cyan-400 to-teal-500', soft: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300', hex: '#22b8c9' },
  cultural: { grad: 'from-pink-400 to-rose-500', soft: 'bg-pink-500/10 text-pink-600 dark:text-pink-300', hex: '#f0609e' },
  arts: { grad: 'from-rose-400 to-orange-400', soft: 'bg-rose-500/10 text-rose-600 dark:text-rose-300', hex: '#f47a6a' },
  sports: { grad: 'from-amber-400 to-orange-500', soft: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', hex: '#f5a524' },
  social: { grad: 'from-emerald-400 to-teal-500', soft: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', hex: '#22c38e' },
  'social-service': { grad: 'from-emerald-400 to-green-500', soft: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', hex: '#22c38e' },
  career: { grad: 'from-blue-400 to-indigo-600', soft: 'bg-blue-500/10 text-blue-600 dark:text-blue-300', hex: '#4f7bf0' },
  literary: { grad: 'from-yellow-400 to-amber-500', soft: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300', hex: '#e7b416' },
  entrepreneurship: { grad: 'from-lime-400 to-emerald-500', soft: 'bg-lime-500/10 text-lime-700 dark:text-lime-300', hex: '#7cc43a' },
  other: { grad: 'from-slate-400 to-slate-500', soft: 'bg-slate-500/10 text-slate-600 dark:text-slate-300', hex: '#8b8fa8' },
};

export const catStyle = (c) => CATEGORY_STYLES[c] || CATEGORY_STYLES.other;

// ── Alumni Network ──────────────────────────────────────────────────
export const MENTORSHIP_DOMAINS = [
  'software_engineering', 'cybersecurity', 'data_science', 'core_engineering',
  'higher_studies', 'government_exams', 'entrepreneurship', 'other',
];
export const MENTORSHIP_DOMAIN_LABELS = {
  software_engineering: 'Software Engineering',
  cybersecurity: 'Cybersecurity',
  data_science: 'Data Science & AI',
  core_engineering: 'Core Engineering',
  higher_studies: 'Higher Studies (MS/M.Tech)',
  government_exams: 'Government / Civil Exams',
  entrepreneurship: 'Startups & Business',
  other: 'Other',
};
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
export const JOB_TYPE_LABELS = {
  full_time: 'Full Time',
  internship: 'Internship',
  part_time: 'Part Time',
  contract: 'Contract',
};
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

