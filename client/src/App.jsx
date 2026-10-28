import { lazy, Suspense, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import toast, { Toaster } from 'react-hot-toast';
import AppLayout, { Backdrop } from './components/layout/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';
import { PageLoader, Spinner } from './components/ui/primitives';
import { refreshSession } from './services/api';
import { sessionChecked, setCredentials } from './features/authSlice';
import { setMaintenance } from './features/uiSlice';
import { STAFF_GRANT_ROLES, grantedPages } from './utils/delegation';
import { useGetAccountModulesQuery, useGetMyPoliciesQuery } from './services/superAdmin';
import { moduleForPath, routeAllowed } from './utils/adminModules';
import { ABOUT_PATH, PRIVACY_PATH, PUBLIC_LEGAL_PATHS, TERMS_PATH } from './utils/legal';
import { COE, EMERGENCY_CONTROL_PATH, HOSTEL_ROLES, OFFICE, PEOPLE_DIRECTORY, ROLES, STAFF_VIEW, STUDENT_ROLES, SUPER_ADMIN, SW_COLLEGE_ROLES, SW_STAFF_ROLES, SW_STUDENT_ROLES, TRANSPORT, TRANSPORT_HISTORY_VIEW, TRANSPORT_MANAGERS, TRANSPORT_VIEW, TRIP_SHARERS } from './utils/constants';

// The People directory: students see only their own class (classmates and
// that class's faculty); staff see their academic scope. Security and Warden
// have no academic directory. The server enforces the same scope.
const PEOPLE_DIRECTORY_ROLES = PEOPLE_DIRECTORY;
// Warden/Security have zero timetable access anywhere in the app.
const TIMETABLE_ROLES = ROLES.filter((r) => !['warden', 'security', 'office', 'transport'].includes(r));
// Warden/Security (and the AO) have zero Study Materials access either.
const STUDY_MATERIAL_ROLES = ROLES.filter((r) => !['warden', 'security', 'ao'].includes(r));

import Login from './pages/auth/Login';
import Dashboard from './pages/Dashboard';

const Events = lazy(() => import('./pages/events/Events'));
const EventDetail = lazy(() => import('./pages/events/EventDetail'));
const Clubs = lazy(() => import('./pages/clubs/Clubs'));
const ClubDetail = lazy(() => import('./pages/clubs/ClubDetail'));
const Announcements = lazy(() => import('./pages/announcements/Announcements'));
const Achievements = lazy(() => import('./pages/achievements/Achievements'));
const AchievementDetail = lazy(() => import('./pages/achievements/AchievementDetail'));
const Discussions = lazy(() => import('./pages/discussions/Discussions'));
const DiscussionDetail = lazy(() => import('./pages/discussions/DiscussionDetail'));
const People = lazy(() => import('./pages/people/People'));
const Profile = lazy(() => import('./pages/people/Profile'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Search = lazy(() => import('./pages/Search'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics'));
const DevOtpPortal = lazy(() => import('./pages/dev/DevOtpPortal'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminReports = lazy(() => import('./pages/admin/AdminReports'));
const AdminClubs = lazy(() => import('./pages/admin/AdminClubs'));
const AdminActivity = lazy(() => import('./pages/admin/AdminActivity'));
const AdminAcademics = lazy(() => import('./pages/admin/AdminAcademics'));
const AttendanceDashboard = lazy(() => import('./pages/admin/AttendanceDashboard'));
const AdminChatRequests = lazy(() => import('./pages/admin/AdminChatRequests'));
const SecurityLogs = lazy(() => import('./pages/admin/SecurityLogs'));
const ClassStudents = lazy(() => import('./pages/class/ClassStudents'));
const Security = lazy(() => import('./pages/settings/Security'));
const Chat = lazy(() => import('./pages/chat/Chat'));
const Timetable = lazy(() => import('./pages/timetable/Timetable'));
const StudyMaterials = lazy(() => import('./pages/materials/StudyMaterials'));
const Attendance = lazy(() => import('./pages/attendance/Attendance'));
const GatePass = lazy(() => import('./pages/gatepass/GatePass'));
const GatePassDetail = lazy(() => import('./pages/gatepass/GatePassDetail'));
const GateVerify = lazy(() => import('./pages/gatepass/GateVerify'));
const LostFound = lazy(() => import('./pages/lostfound/LostFound'));
const LostFoundDetail = lazy(() => import('./pages/lostfound/LostFoundDetail'));
const Insights = lazy(() => import('./pages/analytics/Insights'));
const Complaints = lazy(() => import('./pages/complaints/Complaints'));
const ComplaintDetail = lazy(() => import('./pages/complaints/ComplaintDetail'));
const ComplaintDashboard = lazy(() => import('./pages/admin/ComplaintDashboard'));
const Alumni = lazy(() => import('./pages/alumni/Alumni'));
const AlumniClaim = lazy(() => import('./pages/alumni/AlumniClaim'));
const SOSAlerts = lazy(() => import('./pages/sos/SOSAlerts'));
const Hostel = lazy(() => import('./pages/hostel/Hostel'));
const Transport = lazy(() => import('./pages/transport/Transport'));
const TransportAdmin = lazy(() => import('./pages/transport/TransportAdmin'));
const ShareLocation = lazy(() => import('./pages/transport/ShareLocation'));
const TransportHistory = lazy(() => import('./pages/transport/TransportHistory'));
const SuperAdmin = lazy(() => import('./pages/superadmin/SuperAdmin'));
const EmergencyControl = lazy(() => import('./pages/superadmin/EmergencyControl'));
const SocDashboard = lazy(() => import('./pages/superadmin/Soc'));
const SocErrorDetail = lazy(() => import('./pages/superadmin/SocErrorDetail'));
const SkillWallet = lazy(() => import('./pages/skillwallet/SkillWallet'));
const SwProjectDetail = lazy(() => import('./pages/skillwallet/ProjectDetail'));
const SwGallery = lazy(() => import('./pages/skillwallet/Gallery'));
const SwPublicGallery = lazy(() => import('./pages/skillwallet/Gallery').then((m) => ({ default: m.PublicGallery })));
const SwGalleryDetail = lazy(() => import('./pages/skillwallet/GalleryDetail'));
const SwPublicGalleryDetail = lazy(() => import('./pages/skillwallet/GalleryDetail').then((m) => ({ default: m.PublicGalleryDetail })));
const SwPortfolio = lazy(() => import('./pages/skillwallet/Portfolio'));
const SwReviewWorkspace = lazy(() => import('./pages/skillwallet/ReviewWorkspace'));
const SwReviewProject = lazy(() => import('./pages/skillwallet/ReviewWorkspace').then((m) => ({ default: m.ReviewProject })));
const SwManagement = lazy(() => import('./pages/skillwallet/Management'));
const AboutApp = lazy(() => import('./pages/legal/AboutApp'));
const PolicyPage = lazy(() => import('./pages/legal/PolicyPage'));

/**
 * Admin pages that staff accounts can open through additional policies
 * (Users, Security & Logs, Activity). The server authorizes every request;
 * this only decides whether to render the page or go home.
 */
function RequireAdminPage({ children, roles, page }) {
  const user = useSelector((s) => s.auth.user);
  const grantee = STAFF_GRANT_ROLES.includes(user?.role);
  const { data, isLoading } = useGetMyPoliciesQuery(undefined, { skip: !grantee });
  if (user && grantee && !roles.includes(user.role)) {
    if (isLoading) return null;
    if (grantedPages(data).includes(page)) return children;
  }
  return <RequireAuth roles={roles}>{children}</RequireAuth>;
}

function RequireAuth({ children, roles, dayScholarOnly }) {
  const user = useSelector((s) => s.auth.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  // Hostelers (and students with no stay type) never see bus tracking.
  if (dayScholarOnly && STUDENT_ROLES.includes(user.role) && user.stayType !== 'day_scholar') return <Navigate to="/" replace />;
  return children;
}

// The Controller of Examinations works inside the Timetable dashboard only
// (Exam Timetable, Class Timetable, Attendance); any other page — including
// the Dashboard at "/" — sends them there. The server refuses the other
// modules to this role whatever the UI does.
// The Office works in Attendance only (read-only), the same way.
const CONFINED = {
  // The COE also verifies NPTEL certificates (the Skill Wallet review workspace only).
  [COE]: { home: '/timetable', pages: ['/timetable', '/attendance', '/skill-wallet/review', '/notifications', '/settings/security'] },
  [OFFICE]: { home: '/attendance', pages: ['/attendance', '/notifications', '/settings/security'] },
  [TRANSPORT]: { home: '/transport', pages: ['/transport', '/notifications', '/settings/security'] },
  [SUPER_ADMIN]: { home: '/super-admin', pages: ['/super-admin', EMERGENCY_CONTROL_PATH, '/admin/users', '/attendance', '/gate-pass', '/hostel', '/notifications', '/settings/security'] },
};

function CoeConfine({ children }) {
  const user = useSelector((s) => s.auth.user);
  const role = user?.role;
  const { pathname } = useLocation();
  // Office / COE accounts may also open admin pages granted to them as additional policies.
  const { data: myPolicies } = useGetMyPoliciesQuery(undefined, { skip: ![COE, OFFICE].includes(role) });
  const extra = grantedPages(myPolicies);
  // A temporary password (set by a Super Admin) must be replaced first; the
  // server refuses everything else until then.
  if (user?.mustChangePassword && pathname !== '/settings/security') return <Navigate to="/settings/security?required=1" replace />;
  const rule = CONFINED[role];
  if (rule && ![...rule.pages, ...extra].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return <Navigate to={rule.home} replace />;
  return children;
}

/**
 * Policy-managed Admins: a page of a module that is not ticked (or was just
 * unticked by a Super Admin) sends them to the Dashboard with a message. The
 * module list is live: re-read every minute and at once whenever the server
 * refuses a module (services/api.js). The server refuses the API either way.
 */
function ModuleGuard({ children }) {
  const isAdmin = useSelector((s) => s.auth.user?.role) === 'admin';
  const { pathname } = useLocation();
  const { data: account, isLoading } = useGetAccountModulesQuery(undefined, { skip: !isAdmin, pollingInterval: 60000 });
  const had = useRef(new Set());
  const blocked = isAdmin && account && !routeAllowed(pathname, account) ? moduleForPath(pathname, account.catalogue) : null;
  useEffect(() => {
    if (blocked) {
      const removed = had.current.has(blocked.key);
      toast.error(removed ? `Your access to ${blocked.label} was turned off by a Super Admin.` : `You do not have access to ${blocked.label}.`, { id: `module-${blocked.key}` });
    }
    if (account?.modules) had.current = new Set(account.modules);
  }, [blocked, account]);
  if (isAdmin && isLoading) return <PageLoader />;
  if (blocked) return <Navigate to="/" replace />;
  return children;
}

/** The maintenance message when the platform is not in normal mode, else null. */
function checkPlatform() {
  return fetch('/api/platform/status', { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => (s?.mode === 'maintenance' ? s.message || 'VEXON is under maintenance.' : null))
    .catch(() => null);
}

function MaintenanceScreen({ message, onRetry }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Backdrop />
      <div className="card max-w-md text-center">
        <p className="text-gradient text-3xl font-extrabold">Under maintenance</p>
        <p className="mt-3 text-sm muted">{message}</p>
        <button type="button" className="btn btn-primary mt-5" onClick={onRetry}>Check again</button>
      </div>
    </div>
  );
}

function GuestOnly({ children }) {
  const user = useSelector((s) => s.auth.user);
  return user ? <Navigate to="/" replace /> : children;
}

function NotFound() {
  return (
    <div className="card mx-auto max-w-md text-center">
      <p className="text-gradient text-6xl font-extrabold">404</p>
      <p className="mt-2 font-bold">Page not found</p>
      <p className="mt-1 text-sm muted">The page you’re looking for doesn’t exist.</p>
    </div>
  );
}

export default function App() {
  const dispatch = useDispatch();
  const location = useLocation();
  const ready = useSelector((s) => s.auth.ready);
  const theme = useSelector((s) => s.ui.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const maintenance = useSelector((s) => s.ui.maintenance);
  const user = useSelector((s) => s.auth.user);
  // Is the platform in an emergency mode? (public, non-sensitive endpoint)
  useEffect(() => {
    checkPlatform().then((msg) => dispatch(setMaintenance(msg)));
  }, [dispatch]);

  // Restore the session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    refreshSession().then((session) => {
      if (session?.accessToken) dispatch(setCredentials(session));
      dispatch(sessionChecked());
    });
  }, [dispatch]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Backdrop />
        <Spinner className="h-10 w-10" />
      </div>
    );
  }

  const staff = STAFF_VIEW;

  // Signed-in ordinary users get the maintenance screen; the Super Admin keeps
  // working (the server lets only that role through).
  if (maintenance && user && user.role !== SUPER_ADMIN && !PUBLIC_LEGAL_PATHS.includes(location.pathname)) {
    return <MaintenanceScreen message={maintenance} onRetry={() => checkPlatform().then((msg) => (msg ? dispatch(setMaintenance(msg)) : window.location.reload()))} />;
  }

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          className: '!rounded-2xl !bg-white/80 !backdrop-blur-xl !text-sm !font-semibold !text-ink !shadow-glass dark:!bg-[#fefcf8]/90 dark:!text-[#2c2416]',
        }}
      />
      {maintenance && !user && (
        <div role="status" className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-sm font-bold text-white">
          {maintenance}
        </div>
      )}
      <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
          {/* Email password reset is retired: old links land on the sign-in page,
              which explains that the Class In-Charge or Admin resets passwords. */}
          <Route path="/forgot-password" element={<Navigate to="/login" replace />} />
          <Route path="/reset-password" element={<Navigate to="/login" replace />} />
          <Route path="/alumni/claim" element={<AlumniClaim />} />
          {/* Public legal pages: readable signed in or not (app-store reviewers too). */}
          <Route path={ABOUT_PATH} element={<AboutApp />} />
          <Route path={TERMS_PATH} element={<PolicyPage policyId="terms" />} />
          <Route path={PRIVACY_PATH} element={<PolicyPage policyId="privacy" />} />
          {/* Public Innovation Gallery: published PUBLIC projects only (the server enforces it). */}
          <Route path="/gallery" element={<SwPublicGallery />} />
          <Route path="/gallery/:id" element={<SwPublicGalleryDetail />} />
          <Route element={<RequireAuth><CoeConfine><ModuleGuard><AppLayout /></ModuleGuard></CoeConfine></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="events" element={<Events />} />
            <Route path="events/:id" element={<EventDetail />} />
            <Route path="clubs" element={<Clubs />} />
            <Route path="clubs/:slug" element={<ClubDetail />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="achievements" element={<Achievements />} />
            <Route path="achievements/:id" element={<AchievementDetail />} />
            <Route path="discussions" element={<Discussions />} />
            <Route path="discussions/:id" element={<DiscussionDetail />} />
            <Route path="people" element={<RequireAuth roles={PEOPLE_DIRECTORY_ROLES}><People /></RequireAuth>} />
            <Route path="people/:id" element={<Profile />} />
            <Route path="profile" element={<Profile />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="search" element={<Search />} />
            <Route path="admin" element={<RequireAuth roles={staff}><AdminAnalytics /></RequireAuth>} />
            <Route path="admin/reports" element={<RequireAuth roles={staff}><AdminReports /></RequireAuth>} />
            <Route path="admin/users" element={<RequireAdminPage page="/admin/users" roles={['admin', SUPER_ADMIN]}><AdminUsers /></RequireAdminPage>} />
            <Route path="admin/clubs" element={<RequireAuth roles={['admin']}><AdminClubs /></RequireAuth>} />
            <Route path="admin/activity" element={<RequireAdminPage page="/admin/activity" roles={['admin']}><AdminActivity /></RequireAdminPage>} />
            <Route path="admin/security" element={<RequireAdminPage page="/admin/security" roles={['admin']}><SecurityLogs /></RequireAdminPage>} />
            <Route path="class/students" element={<RequireAuth roles={['faculty']}><ClassStudents /></RequireAuth>} />
            <Route path="admin/academics" element={<RequireAuth roles={['admin', 'hod']}><AdminAcademics /></RequireAuth>} />
            <Route path="admin/attendance" element={<RequireAuth roles={staff}><AttendanceDashboard /></RequireAuth>} />
            <Route path="admin/chat-requests" element={<RequireAuth roles={['admin', 'principal']}><AdminChatRequests /></RequireAuth>} />
            <Route path="dev/otp" element={<RequireAuth roles={['admin']}><DevOtpPortal /></RequireAuth>} />
            <Route path="settings/security" element={<Security />} />
            <Route path="chat" element={<Chat />} />
            <Route path="chat/:id" element={<Chat />} />
            <Route path="timetable" element={<RequireAuth roles={TIMETABLE_ROLES}><Timetable /></RequireAuth>} />
            <Route path="study-materials" element={<RequireAuth roles={STUDY_MATERIAL_ROLES}><StudyMaterials /></RequireAuth>} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="gate-pass" element={<GatePass />} />
            <Route path="gate-pass/review" element={<Navigate to="/gate-pass?tab=review" replace />} />
            <Route path="gate-pass/in" element={<RequireAuth roles={['security', 'admin']}><GateVerify direction="in" /></RequireAuth>} />
            <Route path="gate-pass/out" element={<RequireAuth roles={['security', 'admin']}><GateVerify direction="out" /></RequireAuth>} />
            <Route path="gate-pass/:id" element={<GatePassDetail />} />
            <Route path="lost-found" element={<LostFound />} />
            <Route path="lost-found/:id" element={<LostFoundDetail />} />
            <Route path="attendance/corrections" element={<Navigate to="/attendance?tab=corrections" replace />} />
            <Route path="analytics" element={<Insights />} />
            <Route path="complaints" element={<Complaints />} />
            <Route path="complaints/:id" element={<ComplaintDetail />} />
            <Route path="admin/complaints" element={<RequireAuth roles={['admin', 'chairman']}><ComplaintDashboard /></RequireAuth>} />
            <Route path="alumni" element={<Alumni />} />
            <Route path="sos" element={<SOSAlerts />} />
            <Route path="hostel" element={<RequireAuth roles={HOSTEL_ROLES}><Hostel /></RequireAuth>} />
            <Route path="transport" element={<RequireAuth roles={TRANSPORT_VIEW} dayScholarOnly><Transport /></RequireAuth>} />
            <Route path="transport/manage" element={<RequireAuth roles={TRANSPORT_MANAGERS}><TransportAdmin /></RequireAuth>} />
            <Route path="transport/share" element={<RequireAuth roles={TRIP_SHARERS}><ShareLocation /></RequireAuth>} />
            <Route path="transport/history" element={<RequireAuth roles={TRANSPORT_HISTORY_VIEW}><TransportHistory /></RequireAuth>} />
            <Route path="skill-wallet" element={<RequireAuth roles={SW_STUDENT_ROLES}><SkillWallet /></RequireAuth>} />
            <Route path="skill-wallet/projects/:id" element={<RequireAuth roles={SW_COLLEGE_ROLES}><SwProjectDetail /></RequireAuth>} />
            <Route path="skill-wallet/gallery" element={<RequireAuth roles={SW_COLLEGE_ROLES}><SwGallery /></RequireAuth>} />
            <Route path="skill-wallet/gallery/:id" element={<RequireAuth roles={SW_COLLEGE_ROLES}><SwGalleryDetail /></RequireAuth>} />
            <Route path="skill-wallet/portfolio/:userId" element={<RequireAuth roles={SW_COLLEGE_ROLES}><SwPortfolio /></RequireAuth>} />
            <Route path="skill-wallet/review" element={<RequireAuth roles={[...SW_STAFF_ROLES, COE]}><SwReviewWorkspace /></RequireAuth>} />
            <Route path="skill-wallet/review/projects/:id" element={<RequireAuth roles={SW_STAFF_ROLES}><SwReviewProject /></RequireAuth>} />
            <Route path="skill-wallet/manage" element={<RequireAuth roles={SW_STAFF_ROLES}><SwManagement /></RequireAuth>} />
            <Route path="super-admin" element={<RequireAuth roles={[SUPER_ADMIN]}><SuperAdmin /></RequireAuth>} />
            <Route path="super-admin/soc" element={<RequireAuth roles={[SUPER_ADMIN]}><SocDashboard /></RequireAuth>} />
            <Route path="super-admin/soc/errors/:id" element={<RequireAuth roles={[SUPER_ADMIN]}><SocErrorDetail /></RequireAuth>} />
            {/* Unlinked: no navigation points here. The server authorizes every API behind it. */}
            <Route path={EMERGENCY_CONTROL_PATH.slice(1)} element={<RequireAuth roles={[SUPER_ADMIN]}><EmergencyControl /></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </>
  );
}
