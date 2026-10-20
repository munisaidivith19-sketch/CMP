import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { AlertOctagon, LogOut, ShieldCheck, X } from 'lucide-react';
import { Avatar, cn } from '../ui/primitives';
import { api, useGetChatUnreadQuery, useGetGroupRequestsQuery, useLogoutMutation } from '../../services/api';
import { broadcastSession } from '../../services/sessionSync';
import { loggedOut, selectUser } from '../../features/authSlice';
import { setSidebar } from '../../features/uiSlice';
import { disconnectSocket } from '../../services/socket';

import { ROLE_LABELS, SUPER_ADMIN, SW_STAFF_ROLES } from '../../utils/constants';
import { useGetSwReviewerRolesQuery } from '../../services/skillWallet';
import { useGetAccountModulesQuery, useGetMyPoliciesQuery } from '../../services/superAdmin';
import { STAFF_GRANT_ROLES } from '../../utils/delegation';
import { displayName } from '../../utils/format';
import SOSModal from '../sos/SOSModal';
import { sidebarSections } from './navItems';

function NavItem({ item, onClick, badge }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.end} onClick={onClick} className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active')}>
      <Icon className="h-[18px] w-[18px]" />
      <span className="flex-1">{item.label}</span>
      {badge > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-700 px-1.5 text-[10px] font-extrabold text-white shadow-sm" aria-label={`${badge} unread`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector(selectUser);
  const open = useSelector((s) => s.ui.sidebarOpen);
  const [sosOpen, setSosOpen] = useState(false);
  const [logout] = useLogoutMutation();
  const close = () => dispatch(setSidebar(false));
  const isSuperAdmin = user?.role === SUPER_ADMIN;
  const isAdmin = user?.role === 'admin';
  const { data: myPolicies } = useGetMyPoliciesQuery(undefined, { skip: !STAFF_GRANT_ROLES.includes(user?.role) });
  // An Admin's dashboard modules, live from its policies (re-read every minute,
  // and at once when the server refuses a module: services/api.js).
  const { data: account } = useGetAccountModulesQuery(undefined, { skip: !isAdmin, pollingInterval: 60000 });
  const { data: swRoles } = useGetSwReviewerRolesQuery(undefined, { skip: !SW_STAFF_ROLES.includes(user?.role) });
  const { main: mainItems, campus: campusItems, admin: adminItems } = sidebarSections(user, { account: isAdmin ? account : undefined, myPolicies, swRoles });
  const isAlumni = user?.role === 'alumni';
  // Badges only for modules this account can open (an unticked module's API answers 403).
  const chatOpen = campusItems.some((i) => i.to === '/chat');
  const { data: unread } = useGetChatUnreadQuery(undefined, { skip: !user || !chatOpen });
  const { data: groupRequests } = useGetGroupRequestsQuery(undefined, { skip: !adminItems.some((i) => i.to === '/admin/chat-requests'), pollingInterval: 60000 });

  const onLogout = async () => {
    try {
      await logout().unwrap();
    } catch {
      /* ignore network errors on logout */
    }
    disconnectSocket();
    // Sign out every other open tab too (an event only — no token is shared).
    broadcastSession({ type: 'logout', reason: 'manual' });
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
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-glow overflow-hidden">
              <img src="/logo.jpeg" alt="Logo" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-[20px] font-extrabold leading-tight tracking-tight">J.N.N </p>
              <p className="text-[10px] font-semibold text-ink-soft dark:text-ink-muted">INSTITUTE OF ENGINEERING</p>
            </div>
          </div>
          <button className="btn-icon btn-ghost lg:hidden" onClick={close} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1 scrollbar-none">
          <p className="px-3.5 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-soft dark:text-ink-muted">Menu</p>
          {mainItems.map((i) => (
            <NavItem key={i.to} item={i} onClick={close} />
          ))}
          <p className="px-3.5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-soft dark:text-ink-muted">{isAlumni ? 'Connect' : 'Campus'}</p>
          {campusItems.map((i) => (
            <NavItem key={i.to} item={i} onClick={close} badge={i.badge === 'chat' ? unread?.total : 0} />
          ))}
          {adminItems.length > 0 && (
            <>
              <p className="px-3.5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-soft dark:text-ink-muted">Administration</p>
              {adminItems.map((i) => (
                <NavItem key={i.to} item={i} onClick={close} badge={i.badge === 'groups' ? groupRequests?.length : 0} />
              ))}
            </>
          )}
        </nav>

        {!isSuperAdmin && <button
          type="button"
          onClick={() => setSosOpen(true)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-400/40 bg-rose-500/10 py-2.5 text-xs font-bold text-rose-600 transition hover:bg-rose-500 hover:text-white dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-600 dark:hover:text-white"
        >
          <AlertOctagon className="h-4 w-4" />
          <span>Emergency SOS</span>
        </button>}

        <div className="mt-2 flex items-center gap-3 rounded-2xl p-2">
          <NavLink to="/profile" onClick={close} className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar user={user} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{displayName(user)}</p>
              <p className="truncate text-[11px] font-medium text-ink-soft dark:text-ink-muted">{ROLE_LABELS[user?.role]}</p>
            </div>
          </NavLink>
          <NavLink to="/settings/security" onClick={close} className="btn-icon btn-ghost" aria-label="Account security" title="Account security">
            <ShieldCheck className="h-[18px] w-[18px]" />
          </NavLink>
          <button onClick={onLogout} className="btn-icon btn-ghost hover:!text-rose-500" aria-label="Sign out" title="Sign out">
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
        <SOSModal open={sosOpen} onClose={() => setSosOpen(false)} />
      </aside>
    </>
  );
}

