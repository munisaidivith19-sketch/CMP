/**
 * Vexon design tokens — a refined light "glass" look (sky-blue, airline-style):
 * crisp white cards with just enough translucency to read as glass, no heavy
 * blur, high-contrast navy text, no dark backgrounds.
 *
 * Refined set: a tuned sky-blue ramp, reusable translucent `surface` tokens for
 * the inset "glass pill" rows that recur across screens, a small spacing scale,
 * and a layered shadow set — so the whole app shares one calm, cohesive surface.
 */
export const colors = {
  // Backdrop — a soft, cool sky wash the decorative blobs sit on.
  bg: '#ECF3FC',
  bgTint: '#E2EDFB',
  // Cards — translucent "glass" over the backdrop.
  card: 'rgba(255,255,255,0.86)',
  cardStrong: 'rgba(255,255,255,0.97)',
  // Inset rows / fields inside a card — kept as tokens so screens stop
  // hand-writing rgba(255,255,255,0.75) everywhere.
  surface: 'rgba(255,255,255,0.78)',
  surfaceSoft: 'rgba(255,255,255,0.6)',
  surfaceStrong: 'rgba(255,255,255,0.92)',
  hairline: 'rgba(16,27,45,0.06)',
  border: 'rgba(31,111,235,0.14)',
  borderStrong: 'rgba(31,111,235,0.22)',
  ink: '#0F1B2E',
  soft: '#45546B',
  muted: '#8592A6',
  primary50: '#EAF3FF',
  primary100: '#D2E6FF',
  primary300: '#7EB6F7',
  primary400: '#4396EF',
  primary: '#1D6FEB',
  primary600: '#1257C4',
  primary700: '#0E428F',
  fuchsia: '#d946ef', // unused elsewhere; kept for now
  success: '#10b981',
  successSoft: 'rgba(16,185,129,0.12)',
  danger: '#f43f5e',
  dangerSoft: 'rgba(244,63,94,0.12)',
  warning: '#f59e0b',
  warningSoft: 'rgba(245,158,11,0.15)',
  info: '#0ea5e9',
  infoSoft: 'rgba(14,165,233,0.12)',
  neutralSoft: 'rgba(100,116,139,0.12)',
  primarySoft: 'rgba(29,111,235,0.1)',
  primarySofter: 'rgba(29,111,235,0.06)',
};

export const gradients = {
  primary: ['#4396EF', '#1D6FEB', '#1257C4'],
  hero: ['#3E8BF2', '#1D6FEB', '#0B4F9E'],
  emerald: ['#34d399', '#14b8a6'],
  rose: ['#fb7185', '#ec4899'],
  sky: ['#38bdf8', '#1D6FEB'],
  amber: ['#fbbf24', '#f97316'],
  violet: ['#a78bfa', '#6366f1'],
  cyan: ['#22d3ee', '#0ea5e9'],
  // Tile palette — softer two-stop fills for stat/quick-link tiles. These were
  // referenced by the alumni dashboard before they existed (so every tile fell
  // back to blue); defining them restores the intended variety.
  tileBlue: ['#5AA2F4', '#1D6FEB'],
  tileTeal: ['#2DD4BF', '#0EA5A3'],
  tileViolet: ['#a78bfa', '#6366f1'],
  tileAmber: ['#fbbf24', '#f97316'],
  tileRose: ['#fb7185', '#ec4899'],
};

export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

// Small spacing scale so padding/gaps stay on a consistent rhythm.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

export const radius = { sm: 12, md: 18, lg: 24, xl: 28, pill: 999 };

// Crisp, shallow shadow rather than a hazy glow — keeps cards feeling defined, not blurred.
export const shadow = {
  shadowColor: '#0F2A4A',
  shadowOpacity: 0.1,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 5 },
  elevation: 3,
};

// A whisper-light shadow for inset rows and small controls.
export const shadowSoft = {
  shadowColor: '#0F2A4A',
  shadowOpacity: 0.06,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
};

// A deeper lift for hero surfaces and floating actions.
export const shadowLg = {
  shadowColor: '#0B2748',
  shadowOpacity: 0.16,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 12 },
  elevation: 8,
};

export const ROLE_LABELS = {
  student: 'Student', club_admin: 'Club Admin', faculty: 'Faculty', hod: 'HOD', principal: 'Principal', admin: 'Admin', security: 'Security',
  dean: 'Dean', ao: 'AO', chairman: 'Chairman', warden: 'Warden',
};
export const STUDENT_ROLES = ['student', 'club_admin'];
/** Can mark attendance / act on academic data. */
export const STAFF = ['admin', 'faculty', 'hod'];
/** College-wide academic visibility (mirrors server COLLEGE_WIDE_ROLES); all but admin read-only. */
export const COLLEGE_WIDE = ['admin', 'principal', 'chairman', 'dean', 'ao'];
/** Read attendance but never mark it. */
export const ATTENDANCE_READ_ONLY = ['principal', 'chairman', 'dean', 'ao'];
/** Sees today's college (college-wide roles) or department (HOD) attendance summary. */
export const SUMMARY_VIEW = ['hod', ...COLLEGE_WIDE];
/** May start a group chat; faculty groups wait for admin approval. */
export const GROUP_CREATORS = ['admin', 'hod', 'faculty'];
export const DEPARTMENTS = ['CSE (Cyber Security)', 'CSE', 'AI & DS', 'ECE', 'VLSI', 'Robotics', 'Agri', 'Bio Medical', 'Science & Humanities'];
export const FIRST_YEAR_HOD_DEPT = 'Science & Humanities';
export const isFirstYearHod = (u) => u?.role === 'hod' && u?.department === FIRST_YEAR_HOD_DEPT;
export const isBranchHod = (u) => u?.role === 'hod' && u?.department !== FIRST_YEAR_HOD_DEPT;
// A class is Department + Year + Section + Semester (same rule as the server).
export const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'];
export const ACADEMIC_YEARS = [1, 2, 3, 4];
export const YEAR_LABELS = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
export const semestersOfYear = (year) => (year ? [Number(year) * 2 - 1, Number(year) * 2] : []);

export const GATE_PASS_REGARDING = { outing: 'Outing', home: 'Home' };

// Complaints — labels only (same as the web); routing/escalation rules live on the server.
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
export const COMPLAINT_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'NOT_RESOLVED', 'ESCALATED', 'CANCELLED', 'CLOSED'];
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

// ── Campus SOS ──────────────────────────────────────────────────────
export const SOS_TYPES = ['medical', 'security', 'fire', 'ragging', 'other'];
export const SOS_STATUSES = ['active', 'acknowledged', 'resolved', 'false_alarm'];
export const SOS_RESPONDER_ROLES = ['security', 'admin', 'hod', 'principal', 'chairman'];


// ── Student achievements (same values the server validates) ──
export const ACHIEVEMENT_POST_ROLES = ['principal', 'hod'];
export const ACHIEVEMENT_BLOCKED_ROLES = ['warden', 'security'];
export const ACHIEVEMENT_CATEGORIES = ['academic', 'sports', 'technical', 'cultural', 'research', 'placement', 'competition', 'certification', 'other'];
export const ACHIEVEMENT_LEVELS = ['college', 'state', 'national', 'international'];
export const ACHIEVEMENT_POSITIONS = ['winner', 'first', 'second', 'third', 'runner_up', 'finalist', 'participant', 'selected', 'published', 'other'];
export const ACHIEVEMENT_LEVEL_COLORS = { college: 'neutral', state: 'info', national: 'primary', international: 'warning' };

// Hostel overview (the server enforces the same list).
export const HOSTEL_ROLES = ['admin', 'principal', 'dean', 'ao', 'chairman', 'warden'];
