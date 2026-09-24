import { Link } from 'react-router-dom';
import { CalendarClock, ClipboardCheck, DoorOpen, MessageCircle } from 'lucide-react';
import { useGetChatUnreadQuery, useGetCurrentClassQuery, useGetGatePassesQuery, useGetMyAttendanceQuery } from '../services/api';
import { Card, cn } from './ui/primitives';

const STUDENT_ROLES = ['student', 'club_admin'];

function Tile({ to, icon: Icon, label, value, hint, tone }) {
  return (
    <Link to={to} className="group">
      <Card hover className="flex h-full items-center gap-3 p-4">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white', tone)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide muted">{label}</p>
          <p className="truncate text-sm font-extrabold">{value}</p>
          {hint && <p className="truncate text-[11px] muted">{hint}</p>}
        </div>
      </Card>
    </Link>
  );
}

/** "Today" shortcuts on the dashboard: current class, attendance, gate pass, unread chats. */
export default function TodayStrip({ user }) {
  const isStudent = STUDENT_ROLES.includes(user.role);
  const { data: now } = useGetCurrentClassQuery(undefined, { pollingInterval: 120000 });
  const { data: att } = useGetMyAttendanceQuery({ range: 'semester' }, { skip: !isStudent });
  const { data: passes } = useGetGatePassesQuery({ limit: 5 }, { skip: !isStudent });
  const { data: unread } = useGetChatUnreadQuery();
  const open = passes?.passes?.find((p) => ['pending', 'approved', 'active'].includes(p.status));

  const cls = now?.current || now?.next;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        to="/timetable"
        icon={CalendarClock}
        label={now?.current ? 'In class now' : 'Next class'}
        value={cls ? `${cls.subject?.code} · ${cls.subject?.name}` : now?.today?.length ? 'Done for today' : 'No classes today'}
        hint={cls ? `${cls.startTime}–${cls.endTime}${cls.room ? ` · ${cls.room}` : ''}${user.role === 'faculty' ? ` · Sec ${cls.section}` : ''}` : undefined}
        tone="from-indigo-400 to-violet-500"
      />
      {isStudent ? (
        <Tile
          to="/attendance"
          icon={ClipboardCheck}
          label="Attendance (semester)"
          value={att ? `${att.overall.percentage}%` : '—'}
          hint={att ? (att.overall.percentage < att.threshold && att.overall.totalPeriods ? `Below ${att.threshold}% — attend the next ${att.overall.mustAttend}` : `${att.overall.presentPeriods}/${att.overall.totalPeriods} periods`) : undefined}
          tone={att && att.overall.percentage < att.threshold && att.overall.totalPeriods ? 'from-rose-400 to-pink-500' : 'from-emerald-400 to-teal-500'}
        />
      ) : (
        <Tile to="/attendance" icon={ClipboardCheck} label="Attendance" value="Mark today’s classes" hint="Roster, corrections & low attendance" tone="from-emerald-400 to-teal-500" />
      )}
      <Tile
        to="/gate-pass"
        icon={DoorOpen}
        label="Gate pass"
        value={isStudent ? (open ? open.status.replace('_', ' ') : 'No active pass') : 'Review & verify'}
        hint={isStudent && open ? `Return by ${new Date(open.expectedReturn).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : undefined}
        tone="from-cyan-400 to-sky-500"
      />
      <Tile to="/chat" icon={MessageCircle} label="Messages" value={unread?.total ? `${unread.total} unread` : 'All caught up'} hint={unread?.conversations ? `in ${unread.conversations} chat${unread.conversations > 1 ? 's' : ''}` : undefined} tone="from-primary-400 to-primary-600" />
    </div>
  );
}
