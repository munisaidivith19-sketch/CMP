import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import AppLayout, { Backdrop } from './components/layout/AppLayout';
import { PageLoader, Spinner } from './components/ui/primitives';
import { refreshSession } from './services/api';
import { sessionChecked, setCredentials } from './features/authSlice';

import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Dashboard from './pages/Dashboard';

const Events = lazy(() => import('./pages/events/Events'));
const EventDetail = lazy(() => import('./pages/events/EventDetail'));
const Clubs = lazy(() => import('./pages/clubs/Clubs'));
const ClubDetail = lazy(() => import('./pages/clubs/ClubDetail'));
const Announcements = lazy(() => import('./pages/announcements/Announcements'));
const Discussions = lazy(() => import('./pages/discussions/Discussions'));
const DiscussionDetail = lazy(() => import('./pages/discussions/DiscussionDetail'));
const People = lazy(() => import('./pages/people/People'));
const Profile = lazy(() => import('./pages/people/Profile'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Search = lazy(() => import('./pages/Search'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminReports = lazy(() => import('./pages/admin/AdminReports'));
const AdminClubs = lazy(() => import('./pages/admin/AdminClubs'));
const AdminActivity = lazy(() => import('./pages/admin/AdminActivity'));
const AdminAcademics = lazy(() => import('./pages/admin/AdminAcademics'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const Security = lazy(() => import('./pages/settings/Security'));
const Chat = lazy(() => import('./pages/chat/Chat'));
const Timetable = lazy(() => import('./pages/timetable/Timetable'));
const Attendance = lazy(() => import('./pages/attendance/Attendance'));
const GatePass = lazy(() => import('./pages/gatepass/GatePass'));
const GatePassDetail = lazy(() => import('./pages/gatepass/GatePassDetail'));
const LostFound = lazy(() => import('./pages/lostfound/LostFound'));
const LostFoundDetail = lazy(() => import('./pages/lostfound/LostFoundDetail'));
const Insights = lazy(() => import('./pages/analytics/Insights'));

function RequireAuth({ children, roles }) {
  const user = useSelector((s) => s.auth.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
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
  const ready = useSelector((s) => s.auth.ready);
  const theme = useSelector((s) => s.ui.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

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

  const staff = ['admin', 'faculty'];

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          className: '!rounded-2xl !bg-white/80 !backdrop-blur-xl !text-sm !font-semibold !text-ink !shadow-glass dark:!bg-[#fefcf8]/90 dark:!text-[#2c2416]',
        }}
      />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
          <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
          {/* Reachable while signed in too: the emailed link must always work. */}
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="events" element={<Events />} />
            <Route path="events/:id" element={<EventDetail />} />
            <Route path="clubs" element={<Clubs />} />
            <Route path="clubs/:slug" element={<ClubDetail />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="discussions" element={<Discussions />} />
            <Route path="discussions/:id" element={<DiscussionDetail />} />
            <Route path="people" element={<People />} />
            <Route path="people/:id" element={<Profile />} />
            <Route path="profile" element={<Profile />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="search" element={<Search />} />
            <Route path="admin" element={<RequireAuth roles={staff}><AdminAnalytics /></RequireAuth>} />
            <Route path="admin/reports" element={<RequireAuth roles={staff}><AdminReports /></RequireAuth>} />
            <Route path="admin/users" element={<RequireAuth roles={['admin']}><AdminUsers /></RequireAuth>} />
            <Route path="admin/clubs" element={<RequireAuth roles={['admin']}><AdminClubs /></RequireAuth>} />
            <Route path="admin/activity" element={<RequireAuth roles={['admin']}><AdminActivity /></RequireAuth>} />
            <Route path="admin/academics" element={<RequireAuth roles={['admin']}><AdminAcademics /></RequireAuth>} />
            <Route path="settings/security" element={<Security />} />
            <Route path="chat" element={<Chat />} />
            <Route path="chat/:id" element={<Chat />} />
            <Route path="timetable" element={<Timetable />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="gate-pass" element={<GatePass />} />
            <Route path="gate-pass/review" element={<Navigate to="/gate-pass?tab=review" replace />} />
            <Route path="gate-pass/:id" element={<GatePassDetail />} />
            <Route path="lost-found" element={<LostFound />} />
            <Route path="lost-found/:id" element={<LostFoundDetail />} />
            <Route path="attendance/corrections" element={<Navigate to="/attendance?tab=corrections" replace />} />
            <Route path="analytics" element={<Insights />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
