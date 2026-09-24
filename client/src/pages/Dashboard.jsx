import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { format } from 'date-fns';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarCheck2,
  CalendarDays,
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
import { useGetDashboardQuery } from '../services/api';
import { Avatar, Badge, Button, Card, CardHeader, CategoryBadge, EmptyState, ErrorState, Skeleton, StatCard, cn } from '../components/ui/primitives';
import { AnnouncementItem } from '../components/domain';
import { CategoryDonut, EngagementChart } from '../components/charts';
import MiniCalendar from '../components/MiniCalendar';
import TodayStrip from '../components/TodayStrip';
import { catStyle } from '../utils/constants';
import { friendlyDay, fmtTime } from '../utils/format';

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 rounded-[32px]" />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-[28px]" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-[28px] xl:col-span-2" />
        <Skeleton className="h-80 rounded-[28px]" />
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

export default function Dashboard() {
  const user = useSelector(selectUser);
  const { data, isLoading, error, refetch } = useGetDashboardQuery();

  if (isLoading) return <DashboardSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { stats, campus } = data;
  const isStaff = ['admin', 'faculty'].includes(user.role);

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

      {/* Stats */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Shapes} label="My clubs" value={stats.myClubs} hint="Communities you belong to" gradient="from-violet-400 to-indigo-500" />
        <StatCard icon={CalendarCheck2} label="Upcoming" value={stats.upcomingRegistrations} hint="Events you registered for" gradient="from-sky-400 to-blue-500" delay={60} />
        <StatCard icon={Trophy} label="Attended" value={stats.attendedEvents} hint="Events checked-in" gradient="from-amber-400 to-orange-500" delay={120} />
        <StatCard icon={Bell} label="Unread" value={stats.unreadNotifications} hint="New notifications" gradient="from-pink-400 to-rose-500" delay={180} />
      </div>

      {/* Chart + calendar */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
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
        <Card>
          <MiniCalendar events={data.calendar} />
        </Card>
      </div>

      {/* Notice board + upcoming + categories */}
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

        <div className="space-y-5">
          <Card>
            <CardHeader
              title={stats.upcomingRegistrations ? 'Your schedule' : 'Upcoming events'}
              action={
                <Link to="/events" className="text-xs font-bold text-primary-600 hover:underline dark:text-primary-300">
                  See all
                </Link>
              }
            />
            <div className="-mx-2 space-y-1">
              {(stats.upcomingRegistrations ? data.myUpcoming : data.upcomingEvents).slice(0, 5).map((e) => (
                <EventRow key={e._id} e={e} />
              ))}
              {!data.upcomingEvents.length && <p className="px-2 text-sm muted">No upcoming events.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Participation by category" subtitle="All-time registrations" />
            <CategoryDonut data={data.participationByCategory} height={150} />
          </Card>
        </div>
      </div>

      {/* Recommended + trending + clubs */}
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
          <CardHeader
            title="Trending discussions"
            action={<Flame className="h-5 w-5 text-orange-400" />}
          />
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

      {data.myClubs.length > 0 && (
        <Card>
          <CardHeader
            title="My clubs"
            action={
              <Link to="/clubs?mine=true" className="text-xs font-bold text-primary-600 hover:underline dark:text-primary-300">
                Manage
              </Link>
            }
          />
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
            {data.myClubs.map((c) => (
              <Link
                key={c._id}
                to={`/clubs/${c.slug}`}
                className="flex min-w-[220px] items-center gap-3 rounded-3xl bg-white/50 p-3 transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/80 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              >
                <Avatar name={c.name} src={c.logo} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{c.name}</p>
                  <p className="text-[11px] muted">{c.memberCount} members</p>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

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
