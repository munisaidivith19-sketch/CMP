/** Vexon design tokens — the same palette and type as the web app (tailwind.config.js). */
export const colors = {
  bg: '#eef0fb',
  card: 'rgba(255,255,255,0.72)',
  cardStrong: 'rgba(255,255,255,0.88)',
  border: 'rgba(255,255,255,0.85)',
  ink: '#1b1d3a',
  soft: '#5c5f7e',
  muted: '#9295b3',
  primary50: '#f1f0ff',
  primary100: '#e5e3ff',
  primary300: '#aca4ff',
  primary400: '#8a7bff',
  primary: '#6c5dd3',
  primary600: '#5b47c7',
  fuchsia: '#d946ef',
  success: '#10b981',
  successSoft: 'rgba(16,185,129,0.12)',
  danger: '#f43f5e',
  dangerSoft: 'rgba(244,63,94,0.12)',
  warning: '#f59e0b',
  warningSoft: 'rgba(245,158,11,0.15)',
  info: '#0ea5e9',
  infoSoft: 'rgba(14,165,233,0.12)',
  neutralSoft: 'rgba(100,116,139,0.12)',
  primarySoft: 'rgba(108,93,211,0.1)',
};

export const gradients = {
  primary: ['#8a7bff', '#6c5dd3', '#5b47c7'],
  hero: ['#8a7bff', '#6c5dd3', '#d946ef'],
  emerald: ['#34d399', '#14b8a6'],
  rose: ['#fb7185', '#ec4899'],
  sky: ['#38bdf8', '#3b82f6'],
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

export const shadow = {
  shadowColor: '#4c38a8',
  shadowOpacity: 0.12,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
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
