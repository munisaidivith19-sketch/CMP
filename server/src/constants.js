export const ROLES = ['student', 'club_admin', 'faculty', 'hod', 'principal', 'admin'];
// Can mark attendance, moderate content and see beyond their own record.
export const MODERATOR_ROLES = ['admin', 'faculty', 'hod', 'principal'];
// Department-scoped management: sees/acts on their own department only.
export const HOD_ROLES = ['hod'];
// Every role an admin can hand out credentials for from the admin panel.
export const STAFF_ROLES = ['faculty', 'hod', 'principal', 'admin'];
export const STAY_TYPES = ['hosteler', 'day_scholar'];

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
  'chat', 'attendance', 'gate_pass', 'lost_found', 'timetable',
];

// ── Gate Pass ───────────────────────────────────────────────────────
export const GATE_PASS_STATUSES = [
  'pending', 'approved', 'rejected', 'active', 'completed', 'expired', 'revoked', 'cancelled',
];
export const GATE_PASS_REASONS = [
  'medical', 'family_emergency', 'personal', 'official', 'outing', 'other',
];

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
