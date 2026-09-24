import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useDispatch, useSelector, useStore } from 'react-redux';
import toast from 'react-hot-toast';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { NotificationIcon } from './NotificationBell';
import { api, refreshSession } from '../../services/api';
import { connectSocket, disconnectSocket } from '../../services/socket';
import { loggedOut, setCredentials } from '../../features/authSlice';

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-primary-300/50 blur-[110px] animate-float dark:bg-primary-300/30" />
      <div className="absolute -right-32 top-1/4 h-[460px] w-[460px] rounded-full bg-fuchsia-300/40 blur-[110px] animate-float-slow dark:bg-amber-200/25" />
      <div className="absolute -bottom-40 left-1/3 h-[520px] w-[520px] rounded-full bg-sky-300/40 blur-[120px] animate-float dark:bg-rose-200/20" />
      <div className="absolute inset-0 bg-[radial-gradient(rgba(108,93,211,0.08)_1px,transparent_1px)] [background-size:22px_22px] dark:bg-[radial-gradient(rgba(160,120,60,0.07)_1px,transparent_1px)]" />
    </div>
  );
}

// Server event → RTK Query cache tags to refresh (data is re-read over REST,
// which applies the viewer's permissions).
const LIVE_TAGS = {
  'announcement:changed': ['Announcement', 'Dashboard'],
  'event:changed': ['Event', 'Dashboard'],
  'club:changed': ['Club', 'Dashboard'],
  'discussion:changed': ['Discussion', 'Dashboard'],
  'attendance:updated': ['Attendance', 'Analytics'],
  'gatepass:updated': ['GatePass'],
  'timetable:updated': ['Timetable'],
  'lostfound:updated': ['LostFound'],
  'chat:conversation': ['Chat'],
  'chat:read': ['Chat'],
  'chat:messageDeleted': ['Chat'],
};

/** Live notifications over Socket.io → toast + refresh cached data. */
function useRealtime() {
  const dispatch = useDispatch();
  const store = useStore();
  const userId = useSelector((s) => s.auth.user?._id);
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (!userId) return undefined;
    const socket = connectSocket(() => store.getState().auth.accessToken, {
      // Access token expired while the socket was down: refresh, then reconnect.
      onUnauthorized: async () => {
        const session = await refreshSession();
        if (!session?.accessToken) {
          dispatch(loggedOut());
          return false;
        }
        dispatch(setCredentials(session));
        return true;
      },
    });

    const handlers = Object.entries(LIVE_TAGS).map(([event, tags]) => {
      const fn = () => dispatch(api.util.invalidateTags(tags));
      socket.on(event, fn);
      return [event, fn];
    });

    const onChatMessage = ({ conversationId, message }) => {
      dispatch(api.util.invalidateTags(['Chat']));
      const mine = String(message?.sender?._id) === String(userId);
      if (mine || pathRef.current.startsWith('/chat')) return;
      toast.custom(
        (t) => (
          <Link
            to={`/chat/${conversationId}`}
            onClick={() => toast.dismiss(t.id)}
            className={`glass-strong flex w-[340px] items-start gap-3 rounded-2xl p-3.5 ${t.visible ? 'animate-scale-in' : 'opacity-0'}`}
          >
            <NotificationIcon type="chat" />
            <div className="min-w-0">
              <p className="text-sm font-bold leading-snug">{message?.sender?.name || 'New message'}</p>
              <p className="mt-0.5 line-clamp-2 text-xs muted">{message?.body}</p>
            </div>
          </Link>
        ),
        { duration: 4000, id: `chat-${conversationId}` }
      );
    };
    socket.on('chat:message', onChatMessage);

    const onNotification = (n) => {
      toast.custom(
        (t) => (
          <div className={`glass-strong flex w-[340px] items-start gap-3 rounded-2xl p-3.5 ${t.visible ? 'animate-scale-in' : 'opacity-0'}`}>
            <NotificationIcon type={n.type} />
            <div className="min-w-0">
              <p className="text-sm font-bold leading-snug">{n.title}</p>
              {n.message && <p className="mt-0.5 line-clamp-2 text-xs muted">{n.message}</p>}
            </div>
          </div>
        ),
        { duration: 5000 }
      );
      const tags = ['Notification', 'Dashboard'];
      if (n.type === 'event') tags.push('Event');
      if (n.type === 'club') tags.push('Club');
      if (n.type === 'announcement') tags.push('Announcement');
      if (n.type === 'report') tags.push('Report');
      if (n.type === 'attendance') tags.push('Attendance', 'Correction');
      if (n.type === 'gate_pass') tags.push('GatePass');
      if (n.type === 'lost_found') tags.push('LostFound');
      if (n.type === 'system') tags.push('Session', 'Me');
      dispatch(api.util.invalidateTags(tags));
    };
    socket.on('notification', onNotification);
    return () => {
      socket.off('notification', onNotification);
      socket.off('chat:message', onChatMessage);
      handlers.forEach(([event, fn]) => socket.off(event, fn));
      disconnectSocket();
    };
  }, [userId, dispatch, store]);
}

export default function AppLayout() {
  const { pathname } = useLocation();
  useRealtime();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pathname]);

  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <div className="mx-auto flex max-w-[1600px] gap-6 p-3">
        <Sidebar />
        <main className="min-w-0 flex-1 pb-10">
          <Topbar />
          <div key={pathname} className="animate-fade-up">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
