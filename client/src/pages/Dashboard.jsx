import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { format } from 'date-fns';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarCheck2,
  CalendarDays,
  ClipboardCheck,
  Flame,
  MapPin,
  Megaphone,
  MessageSquare,
  Shapes,
  Sparkles,
  ThumbsUp,
  Trophy,
} from 'lucide-react';
import { selectUser } from '../features/authSlice';
import { useGetAttendanceSummaryQuery, useGetDashboardQuery } from '../services/api';
import { Avatar, Badge, Button, Card, CardHeader, CategoryBadge, EmptyState, ErrorState, Skeleton, StatCard, cn } from '../components/ui/primitives';
import { AnnouncementItem } from '../components/domain';
import { CategoryDonut, EngagementChart } from '../components/charts';
import TodayStrip from '../components/TodayStrip';
import { STAFF_VIEW, SUMMARY_VIEW, catStyle } from '../utils/constants';
import { friendlyDay, fmtTime } from '../utils/format';

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 rounded-[32px]" />
      <div className="grid gap-5 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-[28px] xl:col-span-2" />
        <Skeleton className="h-80 rounded-[28px]" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-[28px]" />
        ))}
      </div>
    </div>
  );
}

function EventRow({ e }) {
  const style = catStyle(e.category);
  return (
    <Link to={`/events/${e._id}`} className="group flex items-center gap-3 rounded-2xl p-2.5 transition-all duration-300 hover:bg-white/70 dark:hover:bg-white/5">
      <div className={cn('flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md', style.grad)}>
        <span className="text-[9px] font-bold uppercase">{format(new Date(e.startDate), 'MMM')}</span>
        <span className="text-base font-extrabold leading-none">{format(new Date(e.startDate), 'dd')}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold group-hover:text-primary-600 dark:group-hover:text-primary-300">{e.title}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] muted">
          <MapPin className="h-3 w-3" /> {e.venue} · {fmtTime(e.startDate)}
        </p>
      </div>
      {e.myStatus ? (
        <Badge color={e.myStatus === 'waitlisted' ? 'warning' : 'success'}>{e.myStatus}</Badge>
      ) : (
        <ArrowUpRight className="h-4 w-4 text-ink-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      )}
    </Link>
  );
}

/**
 * A dashboard stat card that opens a small card underneath with a preview and
 * a "View all" link. Closes on outside click or Escape.
 */
function PopoverStat({ id, open, onToggle, card, title, viewAll, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && onToggle(null);
    const onKey = (e) => e.key === 'Escape' && onToggle(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onToggle]);

  return (
    <div ref={ref} className={cn('relative', open && 'z-30')}>
      <button
        type="button"
        className="block w-full rounded-[28px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        aria-expanded={open}
        aria-controls={`pop-${id}`}
        onClick={() => onToggle(open ? null : id)}
      >
        {card}
      </button>
      {open && (
        <div id={`pop-${id}`} role="dialog" aria-label={title} className="glass-strong absolute inset-x-0 top-full mt-2 rounded-3xl p-3 shadow-glass animate-scale-in">
          <p className="px-1 pb-2 text-xs font-bold uppercase tracking-wide muted">{title}</p>
          {children}
          {viewAll && (
            <Link
              to={viewAll}
              onClick={() => onToggle(null)}
              className="mt-2 flex items-center justify-center gap-1.5 rounded-2xl bg-primary-500/10 py-2 text-xs font-bold text-primary-600 hover:bg-primary-500/15 dark:text-primary-300"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/50 px-3 py-2 text-sm dark:bg-white/5">
      <span className="muted">{label}</span>
      <span className={cn('font-extrabold', tone)}>{value ?? '—'}</span>
    </div>
  );
}

/** Today's attendance: admin / principal see the college, an HOD only their department. */
function AttendanceStat({ open, onToggle, role }) {
  const { data, isLoading, error } = useGetAttendanceSummaryQuery(undefined, { pollingInterval: 120000 });
  const isHod = role === 'hod';
  const s = data?.students;
  const f = data?.faculty;

  let value = '—';
  let hint = 'Tap for today’s numbers';
  if (isLoading) {
    value = '…';
    hint = 'Loading today…';
  } else if (s) {
    value = isHod ? String(s.absent) : `${s.percentage}%`;
    hint = isHod ? `absent of ${s.total} students today` : `${s.present} of ${s.total} students present`;
  }

  return (
    <PopoverStat
      id="attendance"
      open={open}
      onToggle={onToggle}
      title={isHod ? `Today · ${data?.department || 'Your department'}` : 'Today · whole college'}
      viewAll="/attendance?tab=today"
      card={<StatCard icon={ClipboardCheck} label={isHod ? 'Dept attendance' : 'Attendance'} value={value} hint={hint} gradient="from-emerald-400 to-teal-500" delay={120} />}
    >
      {error ? (
        <p className="px-1 text-sm text-rose-500">Could not load today’s attendance.</p>
      ) : !data ? (
        <Skeleton className="h-28" />
      ) : isHod ? (
        <div className="space-y-1.5">
          <SummaryRow label="Total students" value={s.total} />
          <SummaryRow label="Absent students" value={s.absent} tone="text-rose-500" />
          {s.unmarked > 0 && <p className="px-1 text-[11px] muted">{s.unmarked} not marked yet</p>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <SummaryRow label="Total students" value={s.total} />
          <SummaryRow label="Students present" value={s.present} tone="text-emerald-600" />
          <SummaryRow label="Students absent" value={s.absent} tone="text-rose-500" />
          <SummaryRow label="Total faculty" value={f.total} />
          <SummaryRow label="Faculty present" value={`${f.percentage}%`} tone="text-emerald-600" />
          <SummaryRow label="Faculty absent" value={f.absent + f.leave} tone="text-rose-500" />
        </div>
      )}
    </PopoverStat>
  );
}

export default function Dashboard() {
  const user = useSelector(selectUser);
  const { data, isLoading, error, refetch } = useGetDashboardQuery();
  const [popover, setPopover] = useState(null);

  if (isLoading) return <DashboardSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { stats, campus } = data;
  const isStaff = STAFF_VIEW.includes(user.role);
  const seesAttendance = SUMMARY_VIEW.includes(user.role);
  const upcoming = (stats.upcomingRegistrations ? data.myUpcoming : data.upcomingEvents) || [];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-primary-400 via-primary-500 to-fuchsia-500 p-6 text-white shadow-glow sm:p-8">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/20 blur-3xl" />
        <div className="absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-sky-300/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold text-white backdrop-blur">
              <Sparkles className="h-3 w-3" /> {format(new Date(), 'EEEE, dd MMMM')}
            </span>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {stats.upcomingRegistrations
                ? `You have ${stats.upcomingRegistrations} upcoming event${stats.upcomingRegistrations > 1 ? 's' : ''}`
                : 'Discover what’s happening on campus'}
            </h2>
            <p className="mt-2 text-sm text-white/80">
              {data.recommended.length
                ? `${data.recommended.length} events match your interests. Don’t miss out!`
                : 'Add interests to your profile to get personalised event picks.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button to="/events" variant="plain" className="bg-white text-primary-600 shadow-lg hover:bg-white hover:-translate-y-0.5" icon={CalendarDays}>
                Browse events
              </Button>
              <Button to="/clubs" variant="plain" className="border border-white/30 bg-white/15 text-white backdrop-blur hover:bg-white/25" icon={Shapes}>
                Explore clubs
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Students', campus.students],
              ['Active clubs', campus.clubs],
              ['Upcoming', campus.upcomingEvents],
            ].map(([label, v]) => (
              <div key={label} className="rounded-3xl border border-white/25 bg-white/15 px-4 py-4 text-center backdrop-blur-md">
                <p className="text-2xl font-extrabold">{v}</p>
                <p className="text-[11px] font-semibold text-white/80">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <TodayStrip user={user} />

      {/* Notice board first */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Notice board"
            subtitle="Latest announcements for you"
            action={
              <Button to="/announcements" variant="soft" size="sm" icon={ArrowRight}>
                View all
              </Button>
            }
          />
          <div className="space-y-3">
            {data.announcements.length ? (
              data.announcements.map((a) => <AnnouncementItem key={a._id} a={a} compact />)
            ) : (
              <EmptyState icon={Megaphone} title="No announcements yet" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Trending discussions" action={<Flame className="h-5 w-5 text-orange-400" />} />
          <div className="-mx-2 space-y-1">
            {data.trending.map((d, i) => (
              <Link key={d._id} to={`/discussions/${d._id}`} className="flex items-start gap-3 rounded-2xl p-2.5 transition-colors hover:bg-white/70 dark:hover:bg-white/5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-xs font-extrabold text-primary-600 dark:text-primary-300">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug">{d.title}</p>
                  <p className="mt-1 flex items-center gap-3 text-[11px] muted">
                    <span className="flex items-center gap-1">
                      <ThumbsUp className="h-3 w-3" /> {d.upvoteCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> {d.replyCount}
                    </span>
                  </p>
                </div>
              </Link>
            ))}
            {!data.trending.length && <p className="px-2 text-sm muted">Nothing trending yet.</p>}
          </div>
        </Card>
      </div>

      {/* Small cards — tap for a quick preview */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <PopoverStat
          id="clubs"
          open={popover === 'clubs'}
          onToggle={setPopover}
          title="My clubs"
          viewAll="/clubs?mine=true"
          card={<StatCard icon={Shapes} label="My clubs" value={stats.myClubs} hint="Tap to see your clubs" gradient="from-violet-400 to-indigo-500" />}
        >
          {data.myClubs.length ? (
            <div className="space-y-1">
              {data.myClubs.slice(0, 3).map((c) => (
                <Link key={c._id} to={`/clubs/${c.slug}`} className="flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-white/70 dark:hover:bg-white/5">
                  <Avatar name={c.name} src={c.logo} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{c.name}</p>
                    <p className="text-[11px] muted">{c.memberCount} members</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-1 text-sm muted">You haven’t joined a club yet.</p>
          )}
        </PopoverStat>

        <PopoverStat
          id="upcoming"
          open={popover === 'upcoming'}
          onToggle={setPopover}
          title={stats.upcomingRegistrations ? 'Your upcoming events' : 'Upcoming on campus'}
          viewAll="/events"
          card={<StatCard icon={CalendarCheck2} label="Upcoming" value={stats.upcomingRegistrations} hint="Tap to see what’s next" gradient="from-sky-400 to-blue-500" delay={60} />}
        >
          {upcoming.length ? (
            <div className="-mx-1 space-y-1">
              {upcoming.slice(0, 3).map((e) => (
                <EventRow key={e._id} e={e} />
              ))}
            </div>
          ) : (
            <p className="px-1 text-sm muted">No upcoming events.</p>
          )}
        </PopoverStat>

        {seesAttendance ? (
          <AttendanceStat open={popover === 'attendance'} onToggle={setPopover} role={user.role} />
        ) : (
          <StatCard icon={Trophy} label="Attended" value={stats.attendedEvents} hint="Events checked-in" gradient="from-amber-400 to-orange-500" delay={120} />
        )}
        <Link to="/notifications" className="block rounded-[28px]">
          <StatCard icon={Bell} label="Unread" value={stats.unreadNotifications} hint="New notifications" gradient="from-pink-400 to-rose-500" delay={180} />
        </Link>
      </div>

      {/* Recommended */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recommended for you" subtitle="Based on your interests and clubs" action={<Sparkles className="h-5 w-5 text-primary-400" />} />
          {data.recommended.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.recommended.map((e) => (
                <Link
                  key={e._id}
                  to={`/events/${e._id}`}
                  className="group flex items-start gap-3 rounded-3xl bg-white/50 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/80 hover:shadow-soft dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                >
                  <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white', catStyle(e.category).grad)}>
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <CategoryBadge category={e.category} />
                    <p className="mt-1.5 line-clamp-1 text-sm font-bold">{e.title}</p>
                    <p className="text-[11px] muted">
                      {friendlyDay(e.startDate)} · {e.venue}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="No recommendations yet"
              text="Add interests like “technical”, “hackathon” or “cultural” to your profile."
              action={
                <Button to="/profile?edit=1" variant="soft" size="sm">
                  Update interests
                </Button>
              }
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Participation by category" subtitle="All-time registrations" />
          <CategoryDonut data={data.participationByCategory} height={180} />
        </Card>
      </div>

      {/* Campus engagement */}
      <Card>
        <CardHeader
          title="Campus engagement"
          subtitle="Event registrations vs. events hosted · last 6 months"
          action={
            <div className="flex gap-3 text-[11px] font-semibold muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary-500" /> Registrations
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-pink-400" /> Events
              </span>
            </div>
          }
        />
        <EngagementChart data={data.registrationTrend} />
      </Card>

      {isStaff && (
        <p className="text-center text-xs muted">
          Looking for campus-wide numbers?{' '}
          <Link to="/admin" className="font-bold text-primary-600 hover:underline dark:text-primary-300">
            Open analytics
          </Link>
        </p>
      )}
    </div>
  );
}
