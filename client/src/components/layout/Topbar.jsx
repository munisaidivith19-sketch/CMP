import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { AlertOctagon, CalendarDays, Menu, Moon, Search, Sun } from 'lucide-react';
import { selectUser } from '../../features/authSlice';
import { setSidebar, toggleTheme } from '../../features/uiSlice';
import { Avatar } from '../ui/primitives';
import NotificationBell from './NotificationBell';
import CalendarModal from '../CalendarModal';
import SOSModal from '../sos/SOSModal';
import { COE, ROLE_LABELS, SUPER_ADMIN } from '../../utils/constants';
import { displayName } from '../../utils/format';
import { useSocketConnected } from '../../services/socket';

/**
 * "Live" while real-time updates are flowing; "Reconnecting…" when the
 * connection dropped (everything is re-read automatically once it is back).
 */
function LiveStatus({ className = '' }) {
  const live = useSocketConnected();
  return (
    <span
      role="status"
      aria-live="polite"
      title={live ? 'Real-time updates are on' : 'Connection lost — reconnecting; data will refresh automatically'}
      className={`hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold sm:inline-flex ${
        live ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
      } ${className}`}
    >
      <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'}`} />
      {live ? 'Live' : 'Reconnecting…'}
    </span>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Topbar() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector(selectUser);
  const theme = useSelector((s) => s.ui.theme);
  const [q, setQ] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  // The COE and the Office have no search or campus calendar (the server refuses both).
  const isCoe = user?.role === COE || user?.role === 'office' || user?.role === 'transport';

  const submit = (e) => {
    e.preventDefault();
    if (q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <header className="glass sticky top-3 z-20 mb-6 flex items-center gap-3 rounded-[28px] px-4 py-3 sm:px-5">
      <button className="btn-icon btn-ghost lg:hidden" onClick={() => dispatch(setSidebar(true))} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>

      <div className="hidden min-w-0 md:block">
        <p className="truncate text-lg font-extrabold tracking-tight">
          {greeting()}, {user?.name} 👋
        </p>
        <p className="truncate text-xs muted">Here’s what’s happening on campus today.</p>
      </div>

      {user?.role === SUPER_ADMIN ? <LiveStatus className="ml-auto" /> : <span className="ml-auto" />}

      {!isCoe && <form onSubmit={submit} className="w-full max-w-sm flex-1 md:flex-none">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clubs, events, people…"
            className="input rounded-full py-2.5 pl-11"
            aria-label="Search"
          />
        </div>
      </form>}

      <button
        onClick={() => setSosOpen(true)}
        className="btn-icon shrink-0 border border-rose-400/40 bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-600 dark:hover:text-white"
        aria-label="Campus SOS emergency alert"
        title="Campus SOS Alert"
      >
        <AlertOctagon className="h-[18px] w-[18px]" />
      </button>
      <SOSModal open={sosOpen} onClose={() => setSosOpen(false)} />

      <button onClick={() => dispatch(toggleTheme())} className="btn-icon btn-outline shrink-0" aria-label="Toggle theme">
        {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
      </button>
      {!isCoe && (
        <>
          <button onClick={() => setCalendarOpen(true)} className="btn-icon btn-outline shrink-0" aria-label="Open calendar" title="Calendar">
            <CalendarDays className="h-[18px] w-[18px]" />
          </button>
          <CalendarModal open={calendarOpen} onClose={() => setCalendarOpen(false)} />
        </>
      )}
      <NotificationBell />

      <Link to="/profile" className="hidden items-center gap-3 rounded-2xl py-1 pl-1 pr-3 transition-colors hover:bg-white/60 dark:hover:bg-white/5 sm:flex">
        <Avatar user={user} size="sm" />
        <div className="hidden leading-tight xl:block">
          <p className="text-sm font-bold">{displayName(user)}</p>
          <p className="text-[11px] muted">{ROLE_LABELS[user?.role]}</p>
        </div>
      </Link>
    </header>
  );
}
