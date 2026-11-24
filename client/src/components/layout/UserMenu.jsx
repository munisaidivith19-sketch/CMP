import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { ChevronDown, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { selectUser } from '../../features/authSlice';
import { Avatar, cn } from '../ui/primitives';
import { COE, OFFICE, ROLE_LABELS, SUPER_ADMIN, TRANSPORT } from '../../utils/constants';
import { displayName } from '../../utils/format';
import useSignOut from './useSignOut';

// Accounts confined to a few pages (App.jsx CONFINED) have no Profile page.
const NO_PROFILE_ROLES = [COE, OFFICE, TRANSPORT, SUPER_ADMIN];

const itemCls =
  'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-primary-500/10 focus:bg-primary-500/10 focus:outline-hidden dark:hover:bg-white/10 dark:focus:bg-white/10';

export default function UserMenu() {
  const user = useSelector(selectUser);
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const showProfile = !NO_PROFILE_ROLES.includes(user?.role);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-3 rounded-2xl py-1 pl-1 pr-2 transition-colors hover:bg-white/60 dark:hover:bg-white/5',
          open && 'bg-white/60 dark:bg-white/5'
        )}
      >
        <Avatar user={user} size="sm" />
        <div className="hidden text-left leading-tight xl:block">
          <p className="text-sm font-bold">{displayName(user)}</p>
          <p className="text-[11px] muted">{ROLE_LABELS[user?.role]}</p>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="menu" className="glass-strong absolute right-0 z-50 mt-3 w-64 overflow-hidden rounded-3xl !bg-white/95 p-2 !backdrop-blur-xl animate-scale-in dark:!bg-ink/95">
          <div className="flex items-center gap-3 px-3 pb-3 pt-2">
            <Avatar user={user} size="sm" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold">{displayName(user)}</p>
              <p className="truncate text-[11px] muted">{user?.email || ROLE_LABELS[user?.role]}</p>
            </div>
          </div>
          <div className="mb-1 border-t border-black/5 dark:border-white/10" />

          {showProfile && (
            <Link to="/profile" role="menuitem" onClick={close} className={itemCls}>
              <UserRound className="h-[18px] w-[18px]" /> Profile
            </Link>
          )}
          <Link to="/settings/security" role="menuitem" onClick={close} className={itemCls}>
            <ShieldCheck className="h-[18px] w-[18px]" /> Security
          </Link>

          <div className="my-1 border-t border-black/5 dark:border-white/10" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              signOut();
            }}
            className={cn(itemCls, 'text-rose-600 hover:!bg-rose-500/10 dark:text-rose-400')}
          >
            <LogOut className="h-[18px] w-[18px]" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
