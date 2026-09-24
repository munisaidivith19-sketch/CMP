import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  AlertTriangle,
  BarChart3,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  Layers,
  Users,
  XCircle,
} from 'lucide-react';
import {
  useGetCorrectionsQuery,
  useGetDepartmentAnalyticsQuery,
  useGetFacultyAnalyticsQuery,
  useGetLowAttendanceQuery,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import {
  Avatar,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatCard,
  Tabs,
  cn,
} from '../../components/ui/primitives';
import { RoundedBars } from '../../components/charts';
import {
  MiniStat,
  PercentBadge,
  PercentBars,
  PercentRing,
  PercentTrend,
  RangeFilter,
  StatusBadge,
  rangeParams,
} from '../../components/insights';
import { DEPARTMENTS } from '../../utils/constants';
import { fmtClassDay } from '../../utils/format';

/* ── Skeleton placeholder ──────────────────────────────────────── */
function Loading() {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

const Empty = ({ text = 'No data for this period yet.' }) => (
  <p className="py-10 text-center text-sm muted">{text}</p>
);

/* ── Faculty overview tab ──────────────────────────────────────── */
function FacultyOverview({ params }) {
  const { data, isLoading, error, refetch } = useGetFacultyAnalyticsQuery(params);

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data.subjects.length) {
    return (
      <Card>
        <EmptyState icon={ClipboardCheck} title="No subjects assigned" text="Subjects you teach will appear here once an admin assigns them." />
      </Card>
    );
  }

  const o = data.overall;
  const w = data.window;
  const uniqueLowStudents = new Set(data.belowThreshold.map((b) => String(b._id.student))).size;
  const p = data.participation;

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardCheck} label="Overall attendance" value={`${o.percentage}%`} hint={`${o.presentPeriods}/${o.totalPeriods} periods`} gradient="from-emerald-400 to-teal-500" />
        <StatCard icon={CalendarCheck2} label="Classes conducted" value={o.classesConducted} hint={`${data.subjects.length} subjects`} gradient="from-violet-400 to-indigo-500" delay={60} />
        <StatCard icon={AlertTriangle} label="Students at risk" value={uniqueLowStudents} hint={`Below ${data.threshold}% in any subject`} gradient="from-rose-400 to-pink-500" delay={120} />
        <StatCard icon={Users} label="Event participation" value={p?.registrations ?? 0} hint={p ? `${p.participants} of ${p.students} students` : '—'} gradient="from-sky-400 to-blue-500" delay={180} />
      </div>

      {/* Main trend + Ring */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Attendance trend" subtitle={`Across all your classes · grouped by ${w.groupBy}`} />
          {data.trend.length ? <PercentTrend data={data.trend} groupBy={w.groupBy} threshold={data.threshold} /> : <Empty />}
        </Card>
        <Card className="flex flex-col items-center justify-center">
          <CardHeader title="Overall rate" className="w-full" />
          <PercentRing value={o.percentage} threshold={data.threshold} sub={`${o.presentPeriods}/${o.totalPeriods}`} />
          <div className="mt-4 grid w-full grid-cols-2 gap-2">
            <MiniStat label="Present" value={o.presentPeriods} icon={CheckCircle2} tone="text-emerald-600 bg-emerald-500/10" />
            <MiniStat label="Absent" value={o.totalPeriods - o.presentPeriods} icon={XCircle} tone="text-rose-600 bg-rose-500/10" />
          </div>
        </Card>
      </div>

      {/* Subject breakdown */}
      <Card>
        <CardHeader title="Subject-wise breakdown" subtitle="Attendance percentage and student count per subject" />
        {data.subjectStats.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2.5">Subject</th>
                  <th className="px-3 py-2.5 text-right">Students</th>
                  <th className="px-3 py-2.5 text-right">Present / Total</th>
                  <th className="px-3 py-2.5 text-right">Attendance %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/60 dark:divide-white/5">
                {data.subjectStats.map((s) => (
                  <tr key={s._id} className="transition-colors hover:bg-white/40 dark:hover:bg-white/5">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold">{s.subject.code}</p>
                      <p className="text-xs muted">{s.subject.name}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold">{s.studentCount}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="font-bold text-emerald-600">{s.presentPeriods}</span>
                      <span className="muted"> / {s.totalPeriods}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <PercentBadge value={s.percentage} threshold={data.threshold} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty />
        )}
      </Card>

      {/* Students below threshold */}
      <Card>
        <CardHeader
          title="Students needing attention"
          subtitle={`Attendance below ${data.threshold}% in at least one subject`}
          action={
            <Link to="/attendance?tab=low" className="text-xs font-bold text-primary-600 hover:underline">
              View in attendance
            </Link>
          }
        />
        {data.belowThreshold.length ? (
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {data.belowThreshold.slice(0, 18).map((b) => (
              <li key={`${b._id.student}-${b._id.subject}`} className="flex items-center gap-3 rounded-2xl bg-white/50 p-3 dark:bg-white/5">
                <Avatar user={b.studentInfo} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{b.studentInfo.name}</p>
                  <p className="text-xs muted">
                    {b.subjectInfo.code} · {b.present}/{b.total} periods
                  </p>
                </div>
                <PercentBadge value={b.pct} threshold={data.threshold} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={CheckCircle2} title="All students are above the threshold 🎉" />
        )}
      </Card>
    </div>
  );
}

/* ── Department / section tab ──────────────────────────────────── */
function DepartmentOverview({ params, canPickDepartment }) {
  const me = useSelector(selectUser);
  const [department, setDepartment] = useState(canPickDepartment ? '' : me.department || '');
  const [section, setSection] = useState('');
  const { data, isLoading, error, refetch } = useGetDepartmentAnalyticsQuery({
    ...params,
    department: department || undefined,
    section: section || undefined,
  });

  return (
    <div className="space-y-5">
      {/* Filters */}
      <Card className="flex flex-wrap items-center gap-3">
        {canPickDepartment && (
          <div>
            <label className="label" htmlFor="ad-dept">Department</label>
            <select id="ad-dept" className="input w-full sm:w-52" value={department} onChange={(e) => { setDepartment(e.target.value); setSection(''); }}>
              <option value="">All departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="ad-section">Section</label>
          <input id="ad-section" className="input w-28 uppercase" placeholder="e.g. A" maxLength={10} value={section} onChange={(e) => setSection(e.target.value.toUpperCase())} />
        </div>
      </Card>

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Users} label="Students" value={data.totalStudents} hint={data.department || 'All departments'} gradient="from-violet-400 to-indigo-500" />
            <StatCard icon={ClipboardCheck} label="Attendance" value={`${data.overall.percentage}%`} hint={`${data.overall.presentPeriods}/${data.overall.totalPeriods} periods`} gradient="from-emerald-400 to-teal-500" delay={60} />
            <StatCard icon={AlertTriangle} label="Low attendance" value={data.lowAttendanceStudents} hint={`Below ${data.threshold}%`} gradient="from-rose-400 to-pink-500" delay={120} />
            <StatCard icon={GraduationCap} label="In clubs" value={data.studentsInClubs} hint={`${data.participation.registrations} event regs`} gradient="from-sky-400 to-blue-500" delay={180} />
          </div>

          {/* Charts */}
          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Attendance trend" subtitle={`${data.department || 'College-wide'} · grouped by ${data.window.groupBy}`} />
              {data.trend.length ? <PercentTrend data={data.trend} groupBy={data.window.groupBy} threshold={data.threshold} /> : <Empty />}
            </Card>
            <Card className="flex flex-col items-center justify-center">
              <CardHeader title="Overall rate" className="w-full" />
              <PercentRing value={data.overall.percentage} threshold={data.threshold} sub={`${data.overall.presentPeriods}/${data.overall.totalPeriods}`} />
            </Card>
          </div>

          {/* Section comparison */}
          <Card>
            <CardHeader title="Section-wise comparison" subtitle="Attendance distribution across sections" />
            {data.sectionStats.length ? (
              <>
                <PercentBars
                  threshold={data.threshold}
                  rows={data.sectionStats.map((s) => ({
                    key: s.section,
                    label: `Section ${s.section}`,
                    value: s.percentage,
                    sub: `${s.students} students · ${s.presentPeriods}/${s.totalPeriods}`,
                  }))}
                />
                <div className="mt-4">
                  <RoundedBars
                    data={data.sectionStats.map((s) => ({ section: `Sec ${s.section}`, percentage: s.percentage, students: s.students }))}
                    xKey="section"
                    yKey="percentage"
                    name="attendance %"
                    height={200}
                    color="#6c5dd3"
                    tickFormatter={(k) => k}
                  />
                </div>
              </>
            ) : (
              <Empty text="No section data available." />
            )}
          </Card>

          {/* Participation summary */}
          <Card>
            <CardHeader title="Student engagement snapshot" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MiniStat label="Total students" value={data.totalStudents} icon={Users} tone="text-violet-600 bg-violet-500/10" />
              <MiniStat label="In clubs" value={data.studentsInClubs} icon={Layers} tone="text-pink-600 bg-pink-500/10" />
              <MiniStat label="Event registrations" value={data.participation.registrations} icon={CalendarCheck2} tone="text-sky-600 bg-sky-500/10" />
              <MiniStat label="Events attended" value={data.participation.attended} icon={CheckCircle2} tone="text-emerald-600 bg-emerald-500/10" />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ── Low attendance list tab ───────────────────────────────────── */
function LowAttendanceList({ params }) {
  const [section, setSection] = useState('');
  const { data, isLoading, error, refetch } = useGetLowAttendanceQuery({ ...params, section: section || undefined });

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-3">
        <div>
          <label className="label" htmlFor="la-section">Filter by section</label>
          <input id="la-section" className="input w-28 uppercase" placeholder="e.g. A" maxLength={10} value={section} onChange={(e) => setSection(e.target.value.toUpperCase())} />
        </div>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.students.length ? (
        <Card>
          <EmptyState icon={CheckCircle2} title={`Everyone is at or above ${data.threshold}% 🎉`} text="No students are below the minimum attendance threshold." />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`${data.students.length} student${data.students.length > 1 ? 's' : ''} below ${data.threshold}%`}
            subtitle="Sorted by lowest attendance first"
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2.5">#</th>
                  <th className="px-3 py-2.5">Student</th>
                  <th className="px-3 py-2.5">Roll no.</th>
                  <th className="px-3 py-2.5">Department</th>
                  <th className="px-3 py-2.5">Section</th>
                  <th className="px-3 py-2.5 text-right">Present / Total</th>
                  <th className="px-3 py-2.5 text-right">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/60 dark:divide-white/5">
                {data.students.map((r, i) => (
                  <tr key={r._id} className={cn('transition-colors', r.percentage < data.threshold - 15 ? 'bg-rose-500/5' : 'hover:bg-white/40 dark:hover:bg-white/5')}>
                    <td className="px-3 py-2.5 text-xs font-bold muted">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar user={r.student} size="sm" />
                        <span className="truncate font-semibold">{r.student.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 muted">{r.student.rollNo || '—'}</td>
                    <td className="px-3 py-2.5 muted">{r.student.department || '—'}</td>
                    <td className="px-3 py-2.5 muted">{r.student.section || '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="font-bold text-emerald-600">{r.present}</span>
                      <span className="muted"> / {r.total}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <PercentBadge value={r.percentage} threshold={data.threshold} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── Corrections overview tab ──────────────────────────────────── */
function CorrectionsSummary() {
  const { data: pending } = useGetCorrectionsQuery({ status: 'pending', limit: 100 });
  const { data: approved } = useGetCorrectionsQuery({ status: 'approved', limit: 1 });
  const { data: rejected } = useGetCorrectionsQuery({ status: 'rejected', limit: 1 });

  const pc = pending?.pagination?.total ?? 0;
  const ac = approved?.pagination?.total ?? 0;
  const rc = rejected?.pagination?.total ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard icon={AlertTriangle} label="Pending" value={pc} hint="Awaiting review" gradient="from-amber-400 to-orange-500" />
        <StatCard icon={CheckCircle2} label="Approved" value={ac} hint="Total approved" gradient="from-emerald-400 to-teal-500" delay={60} />
        <StatCard icon={XCircle} label="Rejected" value={rc} hint="Total rejected" gradient="from-rose-400 to-pink-500" delay={120} />
      </div>

      {pc > 0 && pending?.requests?.length ? (
        <Card>
          <CardHeader
            title="Pending correction requests"
            subtitle={`${pc} request${pc > 1 ? 's' : ''} awaiting your review`}
            action={
              <Link to="/attendance?tab=corrections" className="text-xs font-bold text-primary-600 hover:underline">
                Review all →
              </Link>
            }
          />
          <ul className="divide-y divide-white/60 dark:divide-white/5">
            {pending.requests.slice(0, 8).map((c) => (
              <li key={c._id} className="flex flex-wrap items-center gap-3 px-2 py-3">
                <Avatar user={c.student} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {c.student?.name} <span className="font-medium muted">· {c.student?.rollNo}</span>
                  </p>
                  <p className="text-xs muted">
                    {c.subject?.code} · {fmtClassDay(c.date, 'EEE, dd MMM')} · Period {c.period}
                  </p>
                </div>
                <span className="flex items-center gap-1.5 text-xs">
                  <StatusBadge status={c.currentStatus} /> → <StatusBadge status={c.requestedStatus} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <EmptyState icon={CheckCircle2} title="No pending corrections" text="All correction requests have been reviewed." />
        </Card>
      )}
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────── */
export default function AttendanceDashboard() {
  const me = useSelector(selectUser);
  const [range, setRange] = useState({ range: 'month' });
  const [tab, setTab] = useState('overview');
  const params = rangeParams(range);
  const isAdmin = me.role === 'admin';

  const tabs = [
    { value: 'overview', label: 'My Classes' },
    { value: 'department', label: isAdmin ? 'Departments' : 'My Department' },
    { value: 'low', label: 'Low Attendance' },
    { value: 'corrections', label: 'Corrections' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BarChart3}
        title="Attendance Dashboard"
        subtitle="Attendance analytics, trends, at-risk students and correction requests — all in one place."
        actions={<RangeFilter value={range} onChange={setRange} />}
      />

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && <FacultyOverview params={params} />}
      {tab === 'department' && <DepartmentOverview params={params} canPickDepartment={isAdmin} />}
      {tab === 'low' && <LowAttendanceList params={params} />}
      {tab === 'corrections' && <CorrectionsSummary />}
    </div>
  );
}
