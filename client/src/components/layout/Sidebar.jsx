import { Link, NavLink } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { X } from 'lucide-react';
import { cn } from '../ui/primitives';
import { useGetChatUnreadQuery } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { setSidebar } from '../../features/uiSlice';

import { SW_STAFF_ROLES } from '../../utils/constants';
import { useGetSwReviewerRolesQuery } from '../../services/skillWallet';
import { useGetAccountModulesQuery, useGetMyPoliciesQuery } from '../../services/consoleApi';
import { STAFF_GRANT_ROLES } from '../../utils/delegation';
import { sidebarSections } from './navItems';

function NavItem({ item, onClick, badge }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.end} onClick={onClick} className={({ isActive }) => cn('nav-link text-black dark:text-white', isActive && 'nav-link-active')}>
      <Icon className="h-[18px] w-[18px]" />
      <span className="flex-1">{item.label}</span>
      {badge > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-700 px-1.5 text-[10px] font-extrabold text-white shadow-xs" aria-label={`${badge} unread`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const dispatch = useDispatch();
  const user = useSelector(selectUser);
  const open = useSelector((s) => s.ui.sidebarOpen);
  const close = () => dispatch(setSidebar(false));
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


  return (
    <>
      <div
        className={cn('fixed inset-0 z-30 bg-[#8a7256]/20 backdrop-blur-xs transition-opacity lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
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
          <Link to="/" onClick={close} className="flex items-center gap-2.5 rounded-2xl transition-opacity hover:opacity-80" aria-label="J.N.N Institute of Engineering — go to home" title="Go to home">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-glow overflow-hidden">
              <img src="/logo.jpeg" alt="" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-[20px] font-extrabold leading-tight tracking-tight">J.N.N </p>
              <p className="text-[10px] font-semibold text-black dark:text-white">INSTITUTE OF ENGINEERING</p>
            </div>
          </Link>
          <button className="btn-icon btn-ghost lg:hidden" onClick={close} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1 pb-2 scrollbar-none">
          <p className="px-3.5 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-black dark:text-white">Menu</p>
          {mainItems.map((i) => (
            <NavItem key={i.to} item={i} onClick={close} />
          ))}
          {campusItems.length > 0 && <p className="px-3.5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-black dark:text-white">{isAlumni ? 'Connect' : 'Campus'}</p>}
          {campusItems.map((i) => (
            <NavItem key={i.to} item={i} onClick={close} badge={i.badge === 'chat' ? unread?.total : 0} />
          ))}
          {adminItems.length > 0 && (
            <>
              <p className="px-3.5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-black dark:text-white">Administration</p>
              {adminItems.map((i) => (
                <NavItem key={i.to} item={i} onClick={close} />
              ))}
            </>
          )}
        </nav>
      </aside>
    </>
  );
}

