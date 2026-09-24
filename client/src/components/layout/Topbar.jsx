import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Menu, Moon, Search, Sun } from 'lucide-react';
import { selectUser } from '../../features/authSlice';
import { setSidebar, toggleTheme } from '../../features/uiSlice';
import { Avatar } from '../ui/primitives';
import NotificationBell from './NotificationBell';
import { ROLE_LABELS } from '../../utils/constants';

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
          {greeting()}, {user?.name?.split(' ')[0]} 👋
        </p>
        <p className="truncate text-xs muted">Here’s what’s happening on campus today.</p>
      </div>

      <form onSubmit={submit} className="ml-auto w-full max-w-sm flex-1 md:flex-none">
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
      </form>

      <button onClick={() => dispatch(toggleTheme())} className="btn-icon btn-outline shrink-0" aria-label="Toggle theme">
        {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
      </button>
      <NotificationBell />

      <Link to="/profile" className="hidden items-center gap-3 rounded-2xl py-1 pl-1 pr-3 transition-colors hover:bg-white/60 dark:hover:bg-white/5 sm:flex">
        <Avatar user={user} size="sm" />
        <div className="hidden leading-tight xl:block">
          <p className="text-sm font-bold">{user?.name}</p>
          <p className="text-[11px] muted">{ROLE_LABELS[user?.role]}</p>
        </div>
      </Link>
    </header>
  );
}
