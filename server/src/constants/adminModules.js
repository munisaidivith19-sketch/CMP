/**
 * Admin dashboard modules — the single list behind the Super Admin's
 * per-module checkboxes for policy-managed Admins.
 *
 * Each module is one checkbox. It names:
 *   key       the module key the API returns (GET /api/account/modules)
 *   label     what the checkbox and the Admin's sidebar call it
 *   section   the sidebar section it sits in (Menu / Campus / Administration)
 *   nav       the client route prefixes it opens (sidebar items + their pages)
 *   api       the API route prefixes it covers (relative to /api)
 *   policies  the policy-catalogue modules (policies.js) it grants
 *
 * Modules backed by an existing fine-grained catalogue module (Attendance,
 * Timetable, Events, Clubs, People & Users, the logs) keep that module's
 * per-action rules in middleware/adminPolicy.js; ticking the box grants every
 * action. Every other module gets a single catalogue entry with one action,
 * `use`, and adminPolicy.js guards its `api` prefixes with it.
 *
 * The client never hardcodes this list: it reads it from the API
 * (GET /api/account/modules and GET /api/super-admin/policies/catalogue).
 */
export const ADMIN_MODULE_SECTIONS = [
  { key: 'menu', label: 'Menu' },
  { key: 'campus', label: 'Campus' },
  { key: 'administration', label: 'Administration' },
];

export const ADMIN_MODULES = [
  // ── Menu
  { key: 'announcements', label: 'Announcements', section: 'menu', nav: ['/announcements'], api: ['/announcements'], policies: ['announcements'] },
  { key: 'events', label: 'Events', section: 'menu', nav: ['/events'], api: ['/events'], policies: ['events'] },
  { key: 'clubs', label: 'Clubs', section: 'menu', nav: ['/clubs', '/admin/clubs'], api: ['/clubs'], policies: ['clubs'] },
  { key: 'discussions', label: 'Discussions', section: 'menu', nav: ['/discussions'], api: ['/discussions'], policies: ['discussions'] },
  {
    key: 'people',
    label: 'People & Users',
    section: 'menu',
    nav: ['/people', '/admin/users'],
    api: ['/users', '/admin/users', '/admin/role-assignments', '/admin/policy-targets'],
    policies: ['user_management', 'staff_management'],
  },
  { key: 'notifications', label: 'Notifications', section: 'menu', nav: ['/notifications'], api: ['/notifications'], policies: ['notifications'] },

  // ── Campus
  { key: 'chat', label: 'Chat', section: 'campus', nav: ['/chat', '/admin/chat-requests'], api: ['/chat'], policies: ['chat'] },
  { key: 'timetable', label: 'Timetable', section: 'campus', nav: ['/timetable', '/admin/academics'], api: ['/timetable', '/subjects', '/exams'], policies: ['timetable'] },
  { key: 'transport', label: 'Bus Tracking', section: 'campus', nav: ['/transport'], api: ['/transport'], policies: ['transport'] },
  { key: 'studyMaterials', label: 'Study Materials', section: 'campus', nav: ['/study-materials'], api: ['/study-materials', '/ai/study-assistant'], policies: ['study_materials'] },
  { key: 'achievements', label: 'Achievements', section: 'campus', nav: ['/achievements'], api: ['/achievements'], policies: ['achievements'] },
  {
    key: 'innovationGallery',
    label: 'Innovation Gallery',
    section: 'campus',
    nav: ['/skill-wallet/gallery', '/skill-wallet/projects', '/skill-wallet/portfolio'],
    api: ['/skill-wallet'],
    policies: ['innovation_gallery'],
  },
  { key: 'attendance', label: 'Attendance', section: 'campus', nav: ['/attendance', '/admin/attendance'], api: ['/attendance', '/staff'], policies: ['attendance', 'staff_attendance'] },
  { key: 'gatePass', label: 'Gate Pass', section: 'campus', nav: ['/gate-pass'], api: ['/gate-pass'], policies: ['gate_pass'] },
  { key: 'hostel', label: 'Hostel', section: 'campus', nav: ['/hostel'], api: ['/hostel'], policies: ['hostel'] },
  { key: 'lostFound', label: 'Lost & Found', section: 'campus', nav: ['/lost-found'], api: ['/lost-found'], policies: ['lost_found'] },
  { key: 'grievances', label: 'Grievances', section: 'campus', nav: ['/complaints', '/admin/complaints'], api: ['/complaints'], policies: ['grievances'] },
  { key: 'alumni', label: 'Alumni Network', section: 'campus', nav: ['/alumni'], api: ['/alumni', '/mentorship', '/mentorship-requests'], policies: ['alumni'] },
  // Raising an SOS (POST /api/sos) stays open to every account; this module is the alerts dashboard.
  { key: 'sos', label: 'Emergency SOS', section: 'campus', nav: ['/sos'], api: ['/sos'], policies: ['sos'] },
  { key: 'insights', label: 'Insights', section: 'campus', nav: ['/analytics'], api: ['/analytics'], policies: ['insights'] },

  // ── Administration
  { key: 'analytics', label: 'Analytics', section: 'administration', nav: ['/admin'], api: ['/admin/analytics'], policies: ['admin_analytics'] },
  { key: 'moderation', label: 'Moderation', section: 'administration', nav: ['/admin/reports'], api: ['/reports'], policies: ['moderation'] },
  { key: 'activityLog', label: 'Activity log', section: 'administration', nav: ['/admin/activity'], api: ['/admin/activity'], policies: ['activity_logs'] },
  { key: 'securityLogs', label: 'Security & Logs', section: 'administration', nav: ['/admin/security'], api: ['/admin/security'], policies: ['security_logs'] },
];

export const ADMIN_MODULE_KEYS = ADMIN_MODULES.map((m) => m.key);
