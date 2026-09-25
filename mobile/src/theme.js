/**
 * Vexon design tokens — a "classic" light glass look (sky-blue, airline-style):
 * crisp white cards with just enough translucency to read as glass, no heavy
 * blur, high-contrast navy text, no dark backgrounds.
 */
export const colors = {
  bg: '#EFF5FC',
  card: 'rgba(255,255,255,0.86)',
  cardStrong: 'rgba(255,255,255,0.97)',
  border: 'rgba(31,111,235,0.14)',
  ink: '#101B2D',
  soft: '#48566C',
  muted: '#8592A6',
  primary50: '#EAF3FF',
  primary100: '#D2E6FF',
  primary300: '#7EB6F7',
  primary400: '#4396EF',
  primary: '#1D6FEB',
  primary600: '#1257C4',
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
};

export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export const radius = { sm: 12, md: 18, lg: 24, xl: 28 };

// Crisp, shallow shadow rather than a hazy glow — keeps cards feeling defined, not blurred.
export const shadow = {
  shadowColor: '#0F2A4A',
  shadowOpacity: 0.1,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 5 },
  elevation: 3,
};

export const ROLE_LABELS = { student: 'Student', club_admin: 'Club Admin', faculty: 'Faculty', hod: 'HOD', principal: 'Principal', admin: 'Admin', security: 'Security' };
export const STUDENT_ROLES = ['student', 'club_admin'];
/** Can mark attendance / act on academic data. */
export const STAFF = ['admin', 'faculty', 'hod'];
/** Sees today's college (admin, principal) or department (HOD) attendance summary. */
export const SUMMARY_VIEW = ['admin', 'hod', 'principal'];
/** May start a group chat; faculty groups wait for admin approval. */
export const GROUP_CREATORS = ['admin', 'hod', 'faculty'];
export const DEPARTMENTS = ['CSE', 'CSE (Cyber Security)', 'IT', 'AI & DS', 'ECE', 'EEE', 'Mechanical', 'Civil'];

export const GATE_PASS_REGARDING = { outing: 'Outing', home: 'Home' };
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];
