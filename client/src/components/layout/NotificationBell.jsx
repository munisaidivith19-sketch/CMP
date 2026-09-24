import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, CalendarDays, CheckCheck, ClipboardCheck, DoorOpen, Info, Megaphone, MessageCircle, MessagesSquare, PackageSearch, ShieldAlert, Shapes } from 'lucide-react';
import { useGetNotificationsQuery, useMarkAllNotificationsReadMutation, useMarkNotificationReadMutation } from '../../services/api';
import { cn } from '../ui/primitives';
import { timeAgo } from '../../utils/format';

export const NOTIF_ICONS = {
  announcement: { icon: Megaphone, cls: 'from-amber-400 to-orange-500' },
  event: { icon: CalendarDays, cls: 'from-sky-400 to-blue-500' },
  club: { icon: Shapes, cls: 'from-violet-400 to-indigo-500' },
  discussion: { icon: MessagesSquare, cls: 'from-emerald-400 to-teal-500' },
  report: { icon: ShieldAlert, cls: 'from-rose-400 to-pink-500' },
  system: { icon: Info, cls: 'from-slate-400 to-slate-500' },
  chat: { icon: MessageCircle, cls: 'from-primary-400 to-primary-600' },
  attendance: { icon: ClipboardCheck, cls: 'from-emerald-400 to-green-500' },
  gate_pass: { icon: DoorOpen, cls: 'from-cyan-400 to-sky-500' },
  lost_found: { icon: PackageSearch, cls: 'from-orange-400 to-amber-500' },
  timetable: { icon: CalendarClock, cls: 'from-indigo-400 to-violet-500' },
};

export function NotificationIcon({ type }) {
  const { icon: Icon, cls } = NOTIF_ICONS[type] || NOTIF_ICONS.system;
  return (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white', cls)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { data } = useGetNotificationsQuery({ limit: 8 });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAll] = useMarkAllNotificationsReadMutation();
  const unread = data?.unread || 0;

  useEffect(() => {
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const openItem = (n) => {
    if (!n.read) markRead(n._id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn-icon btn-outline relative" aria-label="Notifications">
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-pink-500 px-1 text-[10px] font-bold text-white shadow-lg ring-2 ring-white dark:ring-[#0c0d1d]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="glass-strong absolute right-0 z-50 mt-3 w-[min(92vw,380px)] overflow-hidden rounded-3xl animate-scale-in">
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <p className="font-bold">Notifications</p>
            {unread > 0 && (
              <button onClick={() => markAll()} className="flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline dark:text-primary-300">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto px-2 pb-2">
            {!data?.items?.length && <p className="px-3 py-8 text-center text-sm muted">You're all caught up ✨</p>}
            {data?.items?.map((n) => (
              <button
                key={n._id}
                onClick={() => openItem(n)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-white/70 dark:hover:bg-white/5',
                  !n.read && 'bg-primary-500/[0.06]'
                )}
              >
                <NotificationIcon type={n.type} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug">{n.title}</p>
                  {n.message && <p className="mt-0.5 line-clamp-1 text-xs muted">{n.message}</p>}
                  <p className="mt-1 text-[11px] text-ink-muted">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500" />}
              </button>
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-white/60 py-3 text-center text-xs font-bold text-primary-600 hover:bg-white/50 dark:border-white/10 dark:text-primary-300">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
