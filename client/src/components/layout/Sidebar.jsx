import { NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpenCheck,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  DoorOpen,
  LineChart,
  MessageCircle,
  PackageSearch,
  ShieldCheck,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessagesSquare,
  ShieldAlert,
  Shapes,
  Sparkles,
  UserCog,
  UsersRound,
  X,
} from 'lucide-react';
import { setSidebar } from '../../features/uiSlice';
import { loggedOut, selectUser } from '../../features/authSlice';
import { api, useGetChatUnreadQuery, useGetGroupRequestsQuery, useLogoutMutation } from '../../services/api';
import { disconnectSocket } from '../../services/socket';
import { Avatar, cn } from '../ui/primitives';
import { ROLE_LABELS, STAFF_VIEW } from '../../utils/constants';

const MAIN = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/events', label: 'Events', icon: CalendarDays },
  { to: '/clubs', label: 'Clubs', icon: Shapes },
  { to: '/discussions', label: 'Discussions', icon: MessagesSquare },
  { to: '/people', label: 'People', icon: GraduationCap },
  { to: '/notifications', label: 'Notifications', icon: Bell },
];

const CAMPUS = [
  { to: '/chat', label: 'Chat', icon: MessageCircle, badge: 'chat' },
  { to: '/timetable', label: 'Timetable', icon: CalendarClock },
  { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
  { to: '/gate-pass', label: 'Gate pass', icon: DoorOpen },
  { to: '/lost-found', label: 'Lost & found', icon: PackageSearch },
  { to: '/analytics', label: 'Insights', icon: LineChart },
];

const ADMIN = [
  { to: '/admin', label: 'Analytics', icon: BarChart3, roles: STAFF_VIEW, end: true },
  { to: '/admin/attendance', label: 'Attendance', icon: ClipboardCheck, roles: STAFF_VIEW },
  { to: '/admin/reports', label: 'Moderation', icon: ShieldAlert, roles: STAFF_VIEW },
  { to: '/admin/users', label: 'Users', icon: UserCog, roles: ['admin'] },
  { to: '/admin/chat-requests', label: 'Group requests', icon: UsersRound, roles: ['admin'], badge: 'groups' },
  { to: '/admin/clubs', label: 'Club approvals', icon: BadgeCheck, roles: ['admin'] },
  { to: '/admin/academics', label: 'Academics', icon: BookOpenCheck, roles: ['admin'] },
  { to: '/admin/activity', label: 'Activity log', icon: Activity, roles: ['admin'] },
];

function NavItem({ item, onClick, badge }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.end} onClick={onClick} className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active')}>
      <Icon className="h-[18px] w-[18px]" />
      <span className="flex-1">{item.label}</span>
      {badge > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-pink-500 px-1.5 text-[10px] font-bold text-white" aria-label={`${badge} unread`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

// Gate guards only deal with entries/exits — the rest of campus life doesn't apply to them.
const HIDDEN_FOR_SECURITY = ['/announcements', '/events', '/clubs', '/discussions', '/timetable', '/attendance', '/analytics'];

export default function Sidebar() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector(selectUser);
  const open = useSelector((s) => s.ui.sidebarOpen);
  const [logout] = useLogoutMutation();
  const close = () => dispatch(setSidebar(false));
  const isSecurity = user?.role === 'security';
  const mainItems = MAIN.filter((i) => !isSecurity || !HIDDEN_FOR_SECURITY.includes(i.to));
  const campusItems = CAMPUS.filter((i) => !isSecurity || !HIDDEN_FOR_SECURITY.includes(i.to));
  const adminItems = ADMIN.filter((i) => i.roles.includes(user?.role));
  const { data: unread } = useGetChatUnreadQuery(undefined, { skip: !user });
  const { data: groupRequests } = useGetGroupRequestsQuery(undefined, { skip: user?.role !== 'admin', pollingInterval: 60000 });

  const onLogout = async () => {
    try {
      await logout().unwrap();
    } catch {
      /* ignore network errors on logout */
    }
    disconnectSocket();
    dispatch(loggedOut());
    dispatch(api.util.resetApiState());
    navigate('/login');
  };

  return (
    <>
      <div
        className={cn('fixed inset-0 z-30 bg-[#8a7256]/20 backdrop-blur-sm transition-opacity lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={close}
      />
      <aside
        className={cn(
          'glass-strong fixed inset-y-3 left-3 z-40 flex w-[264px] flex-col rounded-[32px] p-4 transition-transform duration-500 ease-smooth',
          'lg:sticky lg:top-3 lg:h-[calc(100vh-1.5rem)] lg:shrink-0 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-[110%]'
        )}
      >
        <div className="mb-6 flex items-center justify-between px-2 pt-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-glow">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[15px] font-extrabold leading-tight tracking-tight">CampusConnect</p>
              <p className="text-[11px] font-medium muted">College community</p>
            </div>
          </div>
          <button className="btn-icon btn-ghost lg:hidden" onClick={close} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1 scrollbar-none">
          <p className="px-3.5 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">Menu</p>
          {mainItems.map((i) => (
            <NavItem key={i.to} item={i} onClick={close} />
          ))}
          <p className="px-3.5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">Campus</p>
          {campusItems.map((i) => (
            <NavItem key={i.to} item={i} onClick={close} badge={i.badge === 'chat' ? unread?.total : 0} />
          ))}
          {adminItems.length > 0 && (
            <>
              <p className="px-3.5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">Administration</p>
              {adminItems.map((i) => (
                <NavItem key={i.to} item={i} onClick={close} badge={i.badge === 'groups' ? groupRequests?.length : 0} />
              ))}
            </>
          )}
        </nav>

        <div className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-primary-400 via-primary-500 to-fuchsia-500 p-4 text-white shadow-glow">
          <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/20 blur-xl" />
          <Sparkles className="relative h-5 w-5" />
          <p className="relative mt-2 text-sm font-bold">Got something to share?</p>
          <p className="relative mt-0.5 text-xs text-white/80">Start a discussion or host an event for your campus.</p>
          <NavLink to="/discussions?new=1" onClick={close} className="btn relative mt-3 w-full bg-white/95 py-2 text-xs text-primary-600 hover:bg-white">
            Start a discussion
          </NavLink>
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-2xl p-2">
          <NavLink to="/profile" onClick={close} className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar user={user} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{user?.name}</p>
              <p className="truncate text-[11px] muted">{ROLE_LABELS[user?.role]}</p>
            </div>
          </NavLink>
          <NavLink to="/settings/security" onClick={close} className="btn-icon btn-ghost" aria-label="Account security" title="Account security">
            <ShieldCheck className="h-[18px] w-[18px]" />
          </NavLink>
          <button onClick={onLogout} className="btn-icon btn-ghost hover:!text-rose-500" aria-label="Sign out" title="Sign out">
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </aside>
    </>
  );
}
