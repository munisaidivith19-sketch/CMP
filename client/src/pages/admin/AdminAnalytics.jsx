import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Activity, BarChart3, CalendarDays, CheckCircle2, MessagesSquare, ShieldAlert, Shapes, Users } from 'lucide-react';
import { useGetAnalyticsQuery } from '../../services/api';
import { Avatar, Card, CardHeader, ErrorState, PageHeader, PageLoader, ProgressBar, StatCard } from '../../components/ui/primitives';
import { CategoryDonut, EngagementChart, RoundedBars } from '../../components/charts';
import { ROLE_LABELS } from '../../utils/constants';
import { fmtDate } from '../../utils/format';

export default function AdminAnalytics() {
  const { data, isLoading, error, refetch } = useGetAnalyticsQuery();
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const t = data.totals;
  const maxDept = Math.max(1, ...data.departments.map((d) => d.count));

  return (
    <div className="space-y-6">
      <PageHeader icon={BarChart3} title="Analytics" subtitle="Participation, membership and activity across campus." />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label="Users" value={t.users} hint={`${t.students} students · ${t.faculty} faculty`} gradient="from-violet-400 to-indigo-500" />
        <StatCard icon={Shapes} label="Active clubs" value={t.clubs} hint={`${t.pendingClubs} awaiting approval`} gradient="from-pink-400 to-rose-500" delay={60} />
        <StatCard icon={CalendarDays} label="Events" value={t.events} hint={`${t.upcomingEvents} upcoming`} gradient="from-sky-400 to-blue-500" delay={120} />
        <StatCard icon={CheckCircle2} label="Attendance rate" value={`${t.attendanceRate}%`} hint="Confirmed seats that showed up" gradient="from-emerald-400 to-teal-500" delay={180} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Event participation trend" subtitle="Registrations vs. events per month" />
          <EngagementChart data={data.registrationTrend} height={280} />
        </Card>
        <Card>
          <CardHeader title="Participation by category" />
          <CategoryDonut data={data.participationByCategory} height={170} />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Student activity" subtitle="Tracked actions per day · last 14 days" action={<Activity className="h-5 w-5 text-primary-400" />} />
          <RoundedBars data={data.activityDaily} xKey="day" yKey="count" name="actions" tickFormatter={(d) => (d ? format(new Date(d), 'dd MMM') : '')} />
        </Card>
        <Card>
          <CardHeader title="Moderation & content" />
          <div className="space-y-3">
            {[
              { icon: ShieldAlert, label: 'Pending reports', value: t.pendingReports, to: '/admin/reports', color: 'text-rose-500 bg-rose-500/10' },
              { icon: Shapes, label: 'Clubs awaiting approval', value: t.pendingClubs, to: '/admin/clubs', color: 'text-amber-500 bg-amber-500/10' },
              { icon: MessagesSquare, label: 'Discussions', value: t.discussions, to: '/discussions', color: 'text-emerald-500 bg-emerald-500/10' },
              { icon: CalendarDays, label: 'Announcements', value: t.announcements, to: '/announcements', color: 'text-sky-500 bg-sky-500/10' },
            ].map(({ icon: Icon, label, value, to, color }) => (
              <Link key={label} to={to} className="flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-white/70 dark:hover:bg-white/5">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="flex-1 text-sm font-semibold">{label}</span>
                <span className="text-lg font-extrabold">{value}</span>
              </Link>
            ))}
          </div>
          <div className="mt-5 border-t border-white/60 pt-4 dark:border-white/10">
            <p className="label">Most common actions (14 days)</p>
            <div className="space-y-1.5">
              {data.topActions.map((a) => (
                <div key={a.action} className="flex justify-between text-xs">
                  <code className="font-semibold text-primary-600 dark:text-primary-300">{a.action}</code>
                  <span className="font-bold">{a.count}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader title="Top events" subtitle="By registrations" />
          <div className="space-y-4">
            {data.topEvents.map((e) => (
              <Link key={e._id} to={`/events/${e._id}`} className="block">
                <div className="mb-1.5 flex justify-between gap-2 text-sm">
                  <span className="truncate font-semibold">{e.title}</span>
                  <span className="shrink-0 font-bold">
                    {e.registeredCount}
                    {e.capacity ? `/${e.capacity}` : ''}
                  </span>
                </div>
                <ProgressBar value={e.registeredCount} max={e.capacity || Math.max(...data.topEvents.map((x) => x.registeredCount))} />
                <p className="mt-1 text-[11px] muted">{fmtDate(e.startDate)}</p>
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Largest clubs" subtitle="By membership" />
          <div className="space-y-2">
            {data.topClubs.map((c, i) => (
              <Link key={c._id} to={`/clubs/${c.slug}`} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-white/70 dark:hover:bg-white/5">
                <span className="w-5 text-center text-xs font-extrabold muted">{i + 1}</span>
                <Avatar name={c.name} src={c.logo} size="sm" />
                <span className="flex-1 truncate text-sm font-semibold">{c.name}</span>
                <span className="text-sm font-bold">{c.memberCount}</span>
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Students by department" />
          <div className="space-y-3">
            {data.departments.map((d) => (
              <div key={d.department}>
                <div className="mb-1 flex justify-between text-xs font-semibold">
                  <span>{d.department}</span>
                  <span>{d.count}</span>
                </div>
                <ProgressBar value={d.count} max={maxDept} />
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 border-t border-white/60 pt-4 text-xs dark:border-white/10">
            {Object.entries(data.usersByRole).map(([role, n]) => (
              <div key={role} className="rounded-2xl bg-white/50 p-2.5 dark:bg-white/5">
                <p className="muted">{ROLE_LABELS[role]}</p>
                <p className="text-lg font-extrabold">{n}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
