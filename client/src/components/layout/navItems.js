import {
  Activity,
  AlertOctagon,
  Award,
  BadgeCheck,
  BarChart3,
  BedDouble,
  Bell,
  BookOpen,
  BookOpenCheck,
  BusFront,
  CalendarDays,
  History,
  ClipboardCheck,
  ClipboardList,
  Crown,
  DoorOpen,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  MessageSquareWarning,
  Navigation,
  PackageSearch,
  Settings2,
  Shapes,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserCog,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { COE, HOSTEL_ROLES, OFFICE, PEOPLE_DIRECTORY, ROLES, STAFF, STUDENT_ROLES, SUPER_ADMIN, SW_COLLEGE_ROLES, SW_STAFF_ROLES, SW_STUDENT_ROLES, TIMETABLE_ROLES, TRANSPORT, TRANSPORT_VIEW, TRIP_SHARERS } from '../../utils/constants.js';
import { grantedPages } from '../../utils/delegation.js';
import { navItemAllowed } from '../../utils/adminModules.js';

/**
 * Sidebar items and which of them a user sees. Plain JS (no JSX) so the
 * selection can be tested on its own; Sidebar.jsx renders the result.
 */

// Staff who can see the administrative nav section (Principal sees every staff screen).
const STAFF_VIEW = [...STAFF, 'principal'];

export const MAIN = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/events', label: 'Events', icon: CalendarDays },
  { to: '/clubs', label: 'Clubs', icon: Shapes },
  { to: '/discussions', label: 'Discussions', icon: MessagesSquare },
  // Directory roles only (faculty, HOD, admin, principal, chairman, dean, AO); the server enforces the same scope.
  { to: '/people', label: 'People', icon: GraduationCap, excludeRoles: ROLES.filter((r) => !PEOPLE_DIRECTORY.includes(r)) },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];

export const CAMPUS = [
  { to: '/chat', label: 'Chat', icon: MessageCircle, badge: 'chat' },
  { to: '/timetable', label: 'Timetable', icon: CalendarDays, roles: TIMETABLE_ROLES, excludeRoles: ['warden', 'security'] },
  { to: '/transport', label: 'Bus Tracking', icon: BusFront, end: true, dayScholarOnly: true, excludeRoles: ROLES.filter((r) => !TRANSPORT_VIEW.includes(r)) },
  // Staff who may be assigned to a bus; the page itself lists only the buses each one may share.
  { to: '/transport/share', label: 'Share Bus Location', icon: Navigation, excludeRoles: ROLES.filter((r) => !TRIP_SHARERS.includes(r)) },
  { to: '/study-materials', label: 'Study Materials', icon: BookOpen, excludeRoles: ['warden', 'security', 'ao'] },
  { to: '/achievements', label: 'Achievements', icon: Trophy, excludeRoles: ['warden', 'security'] },
  // Skill Wallet: students' own wallet; the gallery for college roles; the review
  // workspace for staff (it shows what each one may do). The server enforces all of it.
  { to: '/skill-wallet', label: 'Skill Wallet', icon: Wallet, end: true, excludeRoles: ROLES.filter((r) => !SW_STUDENT_ROLES.includes(r)) },
  { to: '/skill-wallet/gallery', label: 'Innovation Gallery', icon: Sparkles, excludeRoles: ROLES.filter((r) => !SW_COLLEGE_ROLES.includes(r)) },
  { to: '/skill-wallet/review', label: 'Skill Wallet Review', icon: ClipboardList, excludeRoles: ROLES.filter((r) => !SW_STAFF_ROLES.includes(r)) },
  { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
  { to: '/gate-pass', label: 'Gate pass', icon: DoorOpen },
  // Admin, principal, dean, AO, chairman and warden only; the server enforces the same.
  { to: '/hostel', label: 'Hostel', icon: BedDouble, excludeRoles: ROLES.filter((r) => !HOSTEL_ROLES.includes(r)) },
  { to: '/lost-found', label: 'Lost & found', icon: PackageSearch },
  { to: '/complaints', label: 'Grievances', icon: MessageSquareWarning },
  { to: '/alumni', label: 'Alumni Network', icon: GraduationCap, excludeRoles: ['warden', 'security'] },
  { to: '/sos', label: 'Emergency SOS', icon: AlertOctagon, excludeRoles: ['student', 'club_admin'] },
  { to: '/analytics', label: 'Insights', icon: LineChart },
];

export const ADMIN = [
  { to: '/admin', label: 'Analytics', icon: BarChart3, roles: STAFF_VIEW, end: true },
  { to: '/admin/attendance', label: 'Attendance', icon: ClipboardCheck, roles: STAFF_VIEW },
  { to: '/admin/reports', label: 'Moderation', icon: ShieldAlert, roles: STAFF_VIEW },
  { to: '/admin/complaints', label: 'Grievances', icon: MessageSquareWarning, roles: ['admin', 'chairman'] },
  { to: '/admin/users', label: 'Users', icon: UserCog, roles: ['admin'] },
  // Admin approves faculty groups; the principal approves HOD groups.
  { to: '/admin/chat-requests', label: 'Group requests', icon: UsersRound, roles: ['admin', 'principal'], badge: 'groups' },
  { to: '/admin/clubs', label: 'Club approvals', icon: BadgeCheck, roles: ['admin'] },
  { to: '/admin/academics', label: 'Academics', icon: BookOpenCheck, roles: ['admin', 'hod'] },
  { to: '/admin/activity', label: 'Activity log', icon: Activity, roles: ['admin'] },
  { to: '/admin/security', label: 'Security & Logs', icon: ShieldCheck, roles: ['admin'] },
];

// Innovation / IIC coordinators (designated by the Principal) and the Principal (designations).
const INNOVATION_MANAGEMENT_ITEM = { to: '/skill-wallet/manage', label: 'Innovation Management', icon: Lightbulb };

// Faculty Class In-Charge only: create student logins and reset their passwords.
const CLASS_IN_CHARGE_ITEM = { to: '/class/students', label: 'Students', icon: Users };
const isClassInCharge = (u) => u?.role === 'faculty' && Boolean(u.section && u.inChargeYear && u.inChargeSemester);

const ALUMNI_MAIN = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/alumni', label: 'Alumni Network', icon: GraduationCap },
  { to: '/achievements', label: 'Achievements', icon: Trophy },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/events', label: 'Events', icon: CalendarDays },
  { to: '/clubs', label: 'Clubs', icon: Shapes },
  { to: '/discussions', label: 'Discussions', icon: MessagesSquare },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];

const COE_MAIN = [
  { to: '/timetable', label: 'Timetable', icon: CalendarDays },
  { to: '/skill-wallet/review', label: 'NPTEL verification', icon: Award },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];
const OFFICE_MAIN = [
  { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];
const TRANSPORT_MAIN = [
  { to: '/transport', label: 'Bus Tracking', icon: BusFront, end: true },
  { to: '/transport/share', label: 'Share bus location', icon: Navigation },
  { to: '/transport/manage', label: 'Manage buses', icon: Settings2 },
  { to: '/transport/history', label: 'Journey history', icon: History },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];

const ALUMNI_CAMPUS = [{ to: '/chat', label: 'Chat', icon: MessageCircle, badge: 'chat' }];

// Super Admin: its console only. The Emergency Control page is deliberately
// absent from every menu.
const SUPER_ADMIN_MAIN = [
  { to: '/super-admin', label: 'Super Admin', icon: Crown, end: true },
  { to: '/super-admin/soc', label: 'Security Ops', icon: ShieldAlert },
  { to: '/admin/users', label: 'Users', icon: UserCog },
  { to: '/attendance', label: 'Attendance (view)', icon: ClipboardCheck },
  { to: '/gate-pass', label: 'Gate passes (view)', icon: DoorOpen },
  { to: '/hostel', label: 'Hostel (view)', icon: BedDouble },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];

const HIDDEN_FOR_SECURITY = ['/announcements', '/events', '/clubs', '/discussions', '/attendance', '/analytics', '/complaints', '/alumni', '/achievements'];

/**
 * The sidebar sections for `user`.
 *   account   GET /api/account/modules (Admins): a policy-managed Admin sees
 *             only the items of its ticked modules; until it has loaded, an
 *             Admin sees the Dashboard only (never a flash of unticked items).
 *   myPolicies GET /api/admin/my-policies (staff with additional policies).
 *   swRoles   Skill Wallet reviewer roles (Innovation Management item).
 */
export function sidebarSections(user, { account, myPolicies, swRoles } = {}) {
  const role = user?.role;
  const isSecurity = role === 'security';
  const isAlumni = role === 'alumni';
  const isCoe = [COE, OFFICE, TRANSPORT, SUPER_ADMIN].includes(role);
  const adminPending = role === 'admin' && !account;
  const byModule = (i) => (adminPending ? i.to === '/' : navItemAllowed(i.to, account));
  // Bus tracking is for day-scholar students only (the server enforces it too).
  const shown = (i) => byModule(i) && !(i.dayScholarOnly && STUDENT_ROLES.includes(role) && user?.stayType !== 'day_scholar');
  const visible = (i) => (!isSecurity || !HIDDEN_FOR_SECURITY.includes(i.to)) && !i.excludeRoles?.includes(role) && shown(i);

  const main = isCoe ? { [OFFICE]: OFFICE_MAIN, [TRANSPORT]: TRANSPORT_MAIN, [SUPER_ADMIN]: SUPER_ADMIN_MAIN }[role] || COE_MAIN : isAlumni ? ALUMNI_MAIN : MAIN.filter(visible);
  const campus = isCoe
    ? []
    : isAlumni
      ? ALUMNI_CAMPUS
      : [
          ...CAMPUS.filter(visible),
          ...(isClassInCharge(user) ? [CLASS_IN_CHARGE_ITEM] : []),
          ...(swRoles?.isCoordinator || swRoles?.canManageDesignations ? [INNOVATION_MANAGEMENT_ITEM] : []),
        ];
  // Staff accounts also see the admin pages their additional policies open.
  const granted = grantedPages(myPolicies);
  const admin = ADMIN.filter((i) => (i.roles.includes(role) && shown(i)) || granted.includes(i.to));
  return { main, campus, admin };
}
