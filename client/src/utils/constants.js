export const ROLES = ['student', 'club_admin', 'faculty', 'hod', 'principal', 'admin'];
export const ROLE_LABELS = { student: 'Student', club_admin: 'Club Admin', faculty: 'Faculty', hod: 'HOD', principal: 'Principal', admin: 'Admin' };

export const STUDENT_ROLES = ['student', 'club_admin'];
/** Can act on academic data (mark attendance, moderate…). */
export const STAFF = ['admin', 'faculty', 'hod'];
/** Staff plus the read-only principal. */
export const STAFF_VIEW = [...STAFF, 'principal'];
/** Sees the daily college / department attendance summary. */
export const SUMMARY_VIEW = ['admin', 'hod', 'principal'];
export const STAY_TYPES = { hosteler: 'Hosteler', day_scholar: 'Day Scholar' };

export const DEPARTMENTS = ['CSE', 'CSE (Cyber Security)', 'IT', 'AI & DS', 'ECE', 'EEE', 'Mechanical', 'Civil'];

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
