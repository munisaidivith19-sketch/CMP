import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Activity,
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  ClipboardCheck,
  DoorOpen,
  LineChart,
  MessagesSquare,
  Shapes,
  Timer,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  useGetClubAnalyticsQuery,
  useGetCollegeAnalyticsQuery,
  useGetDepartmentAnalyticsQuery,
  useGetFacultyAnalyticsQuery,
  useGetGateAnalyticsQuery,
  useGetStudentAnalyticsQuery,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Avatar, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard, Tabs } from '../../components/ui/primitives';
import { CategoryDonut, RoundedBars } from '../../components/charts';
import { MiniStat, PercentBadge, PercentBars, PercentRing, PercentTrend, RangeFilter, StatusBadge, TrendArea, bucketLabel, rangeParams } from '../../components/insights';
import { DEPARTMENTS } from '../../utils/constants';
import { titleCase } from '../../utils/format';

function Loading() {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

const Empty = ({ text = 'No data for this period yet.' }) => <p className="py-10 text-center text-sm muted">{text}</p>;

/* ── Student ────────────────────────────────────────────────────── */
function MeInsights({ params }) {
  const { data, isLoading, error, refetch } = useGetStudentAnalyticsQuery(params);
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const { attendance: a, events: e, clubs, discussions, engagement, window: w } = data;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardCheck} label="Attendance" value={`${a.percentage}%`} hint={`${a.presentPeriods}/${a.totalPeriods} periods`} gradient="from-emerald-400 to-teal-500" />
        <StatCard icon={CalendarDays} label="Event registrations" value={e.registrations} hint={`${e.attended} attended`} gradient="from-sky-400 to-blue-500" delay={60} />
        <StatCard icon={Shapes} label="Clubs" value={clubs.count} hint="Active memberships" gradient="from-pink-400 to-rose-500" delay={120} />
        <StatCard icon={MessagesSquare} label="Discussions" value={discussions.started + discussions.replies} hint={`${discussions.started} started · ${discussions.replies} replies`} gradient="from-violet-400 to-indigo-500" delay={180} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Attendance trend" subtitle={`Grouped by ${w.groupBy}`} />
          {a.trend.length ? <PercentTrend data={a.trend} groupBy={w.groupBy} threshold={data.threshold} /> : <Empty />}
        </Card>
        <Card className="flex flex-col items-center">
          <CardHeader title="Overall" className="w-full" />
          <PercentRing value={a.percentage} threshold={data.threshold} sub={`${a.presentPeriods}/${a.totalPeriods}`} />
          <div className="mt-5 w-full">
            {a.subjects.length ? <PercentBars threshold={data.threshold} rows={a.subjects.map((s) => ({ key: s.subjectId, label: s.code, value: s.percentage, sub: `${s.present}/${s.total}` }))} /> : <Empty text="No classes in this period." />}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Engagement" subtitle="Your actions on campus over time" action={<Activity className="h-5 w-5 text-primary-400" />} />
          {engagement.trend.length ? <RoundedBars data={engagement.trend} xKey="bucket" yKey="actions" name="actions" tickFormatter={(k) => bucketLabel(k, w.groupBy)} /> : <Empty />}
        </Card>
        <Card>
          <CardHeader title="Event participation" subtitle="By category" />
          {e.byCategory.length ? <CategoryDonut data={e.byCategory} height={150} /> : <Empty text="No event registrations in this period." />}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="My clubs" />
          {clubs.list.length ? (
            <div className="space-y-2">
              {clubs.list.map((c) => (
                <Link key={c._id} to={`/clubs/${c.slug}`} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-white/70 dark:hover:bg-white/5">
                  <Avatar name={c.name} src={c.logo} size="sm" />
                  <span className="flex-1 truncate text-sm font-semibold">{c.name}</span>
                  <StatusBadge status="approved" label={titleCase(c.category)} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty text="You haven’t joined a club yet." />
          )}
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          {engagement.recent.length ? (
            <ul className="space-y-1.5">
              {engagement.recent.map((r) => (
                <li key={r._id} className="flex justify-between gap-3 text-xs">
                  <code className="font-semibold text-primary-600">{r.action}</code>
                  <span className="truncate muted">{r.summary || ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── Faculty (my classes) ───────────────────────────────────────── */
function FacultyInsights({ params }) {
  const { data, isLoading, error, refetch } = useGetFacultyAnalyticsQuery(params);
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data.subjects.length) return <Card><EmptyState icon={ClipboardCheck} title="No subjects assigned" text="Subjects you teach will appear here once an admin assigns them." /></Card>;
  const o = data.overall;
  const p = data.participation;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardCheck} label="Class attendance" value={`${o.percentage}%`} hint={`${o.presentPeriods}/${o.totalPeriods} periods`} gradient="from-emerald-400 to-teal-500" />
        <StatCard icon={CalendarCheck2} label="Classes held" value={o.classesConducted} hint={`${data.subjects.length} subjects`} gradient="from-violet-400 to-indigo-500" delay={60} />
        <StatCard icon={AlertTriangle} label="Below minimum" value={new Set(data.belowThreshold.map((b) => String(b._id.student))).size} hint={`Under ${data.threshold}% in a subject`} gradient="from-rose-400 to-pink-500" delay={120} />
        <StatCard icon={CalendarDays} label="Event registrations" value={p?.registrations ?? 0} hint={p ? `${p.participants} of ${p.students} students` : ''} gradient="from-sky-400 to-blue-500" delay={180} />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Attendance trend" subtitle="Across all your classes" />
          {data.trend.length ? <PercentTrend data={data.trend} groupBy={data.window.groupBy} threshold={data.threshold} /> : <Empty />}
        </Card>
        <Card>
          <CardHeader title="By subject" />
          {data.subjectStats.length ? (
            <PercentBars threshold={data.threshold} rows={data.subjectStats.map((s) => ({ key: s._id, label: s.subject.code, value: s.percentage, sub: `${s.studentCount} students` }))} />
          ) : (
            <Empty />
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title="Students needing attention" subtitle={`Below ${data.threshold}% in a subject`} action={<Link to="/attendance?tab=low" className="text-xs font-bold text-primary-600 hover:underline">Open attendance</Link>} />
        {data.belowThreshold.length ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {data.belowThreshold.slice(0, 12).map((b) => (
              <li key={`${b._id.student}-${b._id.subject}`} className="flex items-center gap-3 rounded-2xl bg-white/50 p-2.5 dark:bg-white/5">
                <Avatar user={b.studentInfo} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{b.studentInfo.name}</p>
                  <p className="text-xs muted">
                    {b.subjectInfo.code} · {b.present}/{b.total}
                  </p>
                </div>
                <PercentBadge value={b.pct} threshold={data.threshold} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="Everyone is above the minimum 🎉" />
        )}
      </Card>
    </div>
  );
}

/* ── Department ─────────────────────────────────────────────────── */
function DepartmentInsights({ params, canPick }) {
  const me = useSelector(selectUser);
  const [department, setDepartment] = useState(canPick ? '' : me.department);
  const { data, isLoading, error, refetch } = useGetDepartmentAnalyticsQuery({ ...params, department: department || undefined });

  return (
    <div className="space-y-5">
      {canPick && (
        <select aria-label="Department" className="input w-full sm:w-64" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      )}
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Users} label="Students" value={data.totalStudents} hint={data.department} gradient="from-violet-400 to-indigo-500" />
            <StatCard icon={ClipboardCheck} label="Attendance" value={`${data.overall.percentage}%`} hint={`${data.overall.presentPeriods}/${data.overall.totalPeriods} periods`} gradient="from-emerald-400 to-teal-500" delay={60} />
            <StatCard icon={AlertTriangle} label="Low attendance" value={data.lowAttendanceStudents} hint={`Under ${data.threshold}% overall`} gradient="from-rose-400 to-pink-500" delay={120} />
            <StatCard icon={Shapes} label="In clubs" value={data.studentsInClubs} hint={`${data.participation.registrations} event registrations`} gradient="from-pink-400 to-rose-500" delay={180} />
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Attendance trend" />
              {data.trend.length ? <PercentTrend data={data.trend} groupBy={data.window.groupBy} threshold={data.threshold} /> : <Empty />}
            </Card>
            <Card>
              <CardHeader title="By section" />
              {data.sectionStats.length ? (
                <PercentBars threshold={data.threshold} rows={data.sectionStats.map((s) => ({ key: s.section, label: `Section ${s.section}`, value: s.percentage, sub: `${s.students} students` }))} />
              ) : (
                <Empty />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ── College (admin) ────────────────────────────────────────────── */
function CollegeInsights({ params }) {
  const { data, isLoading, error, refetch } = useGetCollegeAnalyticsQuery(params);
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const o = data.overview;
  const g = data.window.groupBy;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label="Students" value={o.totalStudents} hint={`${o.totalFaculty} faculty · ${o.newUsers} new`} gradient="from-violet-400 to-indigo-500" />
        <StatCard icon={UserCheck} label="Active users" value={o.activeUsers} hint="Did something in this period" gradient="from-sky-400 to-blue-500" delay={60} />
        <StatCard icon={CalendarDays} label="Event registrations" value={o.eventRegistrations} hint={`${o.events} events · ${o.eventAttendance} attended`} gradient="from-pink-400 to-rose-500" delay={120} />
        <StatCard icon={ClipboardCheck} label="Attendance" value={`${o.overallAttendance}%`} hint="Σ present ÷ Σ conducted" gradient="from-emerald-400 to-teal-500" delay={180} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="Clubs" value={o.totalClubs} hint={`${o.clubMemberships} memberships`} icon={Shapes} />
        <MiniStat label="Discussions" value={o.discussions} hint={`${o.replies} replies`} icon={MessagesSquare} />
        <MiniStat label="Gate passes" value={Object.values(data.gatePassStats).reduce((a, b) => a + b, 0)} hint="Requested in this period" icon={DoorOpen} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Engagement" subtitle="Actions and distinct active users" />
          {data.engagementTrend.length ? (
            <TrendArea data={data.engagementTrend} groupBy={g} series={[{ key: 'actions', name: 'actions' }, { key: 'activeUsers', name: 'active users' }]} />
          ) : (
            <Empty />
          )}
        </Card>
        <Card>
          <CardHeader title="Event participation" subtitle="Registrations vs attendance" />
          {data.registrationTrend.length ? (
            <TrendArea data={data.registrationTrend} groupBy={g} series={[{ key: 'registrations', name: 'registrations' }, { key: 'attended', name: 'attended' }]} />
          ) : (
            <Empty />
          )}
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Attendance trend" />
          {data.attendance.trend.length ? <PercentTrend data={data.attendance.trend} groupBy={g} /> : <Empty />}
        </Card>
        <Card>
          <CardHeader title="Attendance by department" />
          {data.departmentAttendance.length ? (
            <PercentBars rows={data.departmentAttendance.map((d) => ({ key: d.department, label: d.department || '—', value: d.percentage }))} />
          ) : (
            <Empty />
          )}
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Events by category" />
          {data.eventsByCategory.length ? <CategoryDonut data={data.eventsByCategory} height={160} /> : <Empty />}
        </Card>
        <Card>
          <CardHeader title="Largest clubs" />
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
      </div>
    </div>
  );
}

/* ── Gate ───────────────────────────────────────────────────────── */
function GateInsights({ params }) {
  const { data, isLoading, error, refetch } = useGetGateAnalyticsQuery(params);
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const total = Object.values(data.statusCounts).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={DoorOpen} label="Requests" value={total} gradient="from-sky-400 to-blue-500" />
        <StatCard icon={UserCheck} label="Completed trips" value={data.totalCompleted} gradient="from-emerald-400 to-teal-500" delay={60} />
        <StatCard icon={Timer} label="Avg. time outside" value={`${Math.round(data.avgTimeOutsideMinutes / 6) / 10} h`} gradient="from-violet-400 to-indigo-500" delay={120} />
        <StatCard icon={AlertTriangle} label="Late returns" value={data.lateReturns} gradient="from-rose-400 to-pink-500" delay={180} />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Requests over time" />
          {data.dailyTrend.length ? (
            <TrendArea data={data.dailyTrend} xKey="_id" groupBy={data.window.groupBy} series={[{ key: 'total', name: 'requests' }, { key: 'approved', name: 'approved' }, { key: 'rejected', name: 'rejected' }]} />
          ) : (
            <Empty />
          )}
        </Card>
        <Card>
          <CardHeader title="By reason" />
          {data.byReason.length ? (
            <div className="space-y-2">
              {data.byReason.map((r) => (
                <div key={r.reason} className="flex justify-between text-sm">
                  <span className="font-semibold">{titleCase(r.reason)}</span>
                  <span className="font-bold">{r.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty />
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── Club (used on the club page) ───────────────────────────────── */
export function ClubInsights({ clubId }) {
  const [range, setRange] = useState({ range: 'semester' });
  const { data, isLoading, error, refetch } = useGetClubAnalyticsQuery({ id: clubId, ...rangeParams(range) });
  return (
    <div className="space-y-5">
      <RangeFilter value={range} onChange={setRange} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Users} label="Members" value={data.members.total} hint={`${data.members.pendingRequests} pending requests`} gradient="from-violet-400 to-indigo-500" />
            <StatCard icon={UserCheck} label="Engaged members" value={`${data.members.engagementRate}%`} hint={`${data.members.engagedInEvents} joined an event`} gradient="from-emerald-400 to-teal-500" delay={60} />
            <StatCard icon={CalendarDays} label="Events" value={data.events.inRange} hint={`${data.events.upcoming} upcoming`} gradient="from-sky-400 to-blue-500" delay={120} />
            <StatCard icon={CalendarCheck2} label="Show-up rate" value={`${data.events.attendanceRate}%`} hint={`${data.events.attended}/${data.events.registrations - data.events.waitlisted} confirmed`} gradient="from-pink-400 to-rose-500" delay={180} />
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Registrations for club events" />
              {data.registrationTrend.length ? (
                <TrendArea data={data.registrationTrend} groupBy={data.window.groupBy} series={[{ key: 'registrations', name: 'registrations' }, { key: 'attended', name: 'attended' }]} />
              ) : (
                <Empty />
              )}
            </Card>
            <Card>
              <CardHeader title="Members by department" />
              {data.members.byDepartment.length ? (
                <div className="space-y-2">
                  {data.members.byDepartment.map((d) => (
                    <div key={d.department} className="flex justify-between text-sm">
                      <span className="font-semibold">{d.department}</span>
                      <span className="font-bold">{d.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty />
              )}
            </Card>
          </div>
          <Card>
            <CardHeader title="Top events" />
            {data.topEvents.length ? (
              <ul className="space-y-2">
                {data.topEvents.map((e) => (
                  <li key={e._id}>
                    <Link to={`/events/${e._id}`} className="flex items-center justify-between gap-3 rounded-2xl p-2 text-sm hover:bg-white/70 dark:hover:bg-white/5">
                      <span className="truncate font-semibold">{e.title}</span>
                      <span className="shrink-0 font-bold">
                        {e.registeredCount}
                        {e.capacity ? `/${e.capacity}` : ''} · {e.attended} attended
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────── */
export default function Insights() {
  const me = useSelector(selectUser);
  const [search, setSearch] = useSearchParams();
  const [range, setRange] = useState({ range: 'month' });
  const params = rangeParams(range);

  const tabs =
    me.role === 'admin'
      ? [
          { value: 'college', label: 'College' },
          { value: 'department', label: 'Departments' },
          { value: 'classes', label: 'All classes' },
          { value: 'gate', label: 'Gate' },
        ]
      : me.role === 'faculty'
        ? [
            { value: 'classes', label: 'My classes' },
            { value: 'department', label: 'My department' },
            { value: 'gate', label: 'Gate' },
          ]
        : [{ value: 'me', label: 'My insights' }];
  const tab = tabs.some((t) => t.value === search.get('tab')) ? search.get('tab') : tabs[0].value;

  return (
    <div className="space-y-5">
      <PageHeader icon={LineChart} title="Insights" subtitle="Live numbers from campus data — attendance, participation and engagement." actions={<RangeFilter value={range} onChange={setRange} />} />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={(t) => setSearch({ tab: t }, { replace: true })} />}
      {tab === 'me' && <MeInsights params={params} />}
      {tab === 'classes' && <FacultyInsights params={params} />}
      {tab === 'department' && <DepartmentInsights params={params} canPick={me.role === 'admin'} />}
      {tab === 'college' && <CollegeInsights params={params} />}
      {tab === 'gate' && <GateInsights params={params} />}
    </div>
  );
}
