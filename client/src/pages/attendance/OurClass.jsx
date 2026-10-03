import { useState } from 'react';
import { CalendarCheck2, ClipboardList, School } from 'lucide-react';
import { useGetOurClassAttendanceQuery } from '../../services/api';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { MiniStat, PercentBadge, RangeFilter, rangeParams } from '../../components/insights';
import { YEAR_LABELS } from '../../utils/constants';

const to12h = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/**
 * "Our Class": the complete attendance of the class the signed-in faculty
 * member is Class In-Charge of.
 *
 * There is no subject, department, year or section picker — the class comes
 * from the account on the server (department + section + in-charge year +
 * in-charge semester), and only the reporting window is chosen here. Only
 * periods that have finished on the server clock are counted.
 */
export default function OurClass() {
  const [range, setRange] = useState({ range: 'day' });
  const customIncomplete = range.range === 'custom' && (!range.from || !range.to);
  const { data, isLoading, isFetching, error, refetch } = useGetOurClassAttendanceQuery(rangeParams(range), { skip: customIncomplete });

  if (isLoading) return <Skeleton className="h-64 rounded-[28px]" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (data && !data.class) {
    return (
      <Card>
        <EmptyState
          icon={School}
          title="No class is currently assigned to you as Class In-Charge."
          text="Your administrator sets your Class In-Charge section, year and semester. Attendance for the subjects you teach is under My Classes."
        />
      </Card>
    );
  }

  const cls = data?.class;
  return (
    <Card>
      <CardHeader
        title="Our Class"
        subtitle={
          cls
            ? [cls.department, YEAR_LABELS[cls.year] || `Year ${cls.year}`, `Section ${cls.section}`, `Semester ${cls.semester}`].join(' · ')
            : 'Your Class In-Charge class'
        }
        action={<RangeFilter value={range} onChange={setRange} />}
      />

      {customIncomplete ? (
        <EmptyState icon={CalendarCheck2} title="Choose a start and an end date" />
      ) : !data ? (
        <Skeleton className="h-48" />
      ) : (
        <div className={cn(isFetching && 'opacity-60')}>
          {/* Short single-word labels so no tile truncates on a 320 px phone. */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <MiniStat label="Students" value={data.overall.totalStudents} />
            <MiniStat label="Periods" value={data.overall.classesConducted} />
            <MiniStat label="Present" value={data.overall.presentPeriods} />
            <MiniStat label="Absent" value={data.overall.absentPeriods} />
            <div className="col-span-2 sm:col-span-1">
              <MiniStat label="Attendance" value={`${data.overall.percentage}%`} hint="Σ present ÷ Σ held" />
            </div>
          </div>

          {/* Period-level detail: which period, which subject, who taught it. */}
          {data.sessions.length > 0 && (
            <div className="mb-5">
              <p className="label">Periods</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {data.sessions.map((p) => (
                  <div key={p._id} className="min-w-0 rounded-2xl bg-white/60 p-3 dark:bg-white/5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-primary-600">
                      {range.range === 'day' ? '' : `${p.date} · `}P{p.period} · {p.subjectCode}
                    </p>
                    <p className="truncate text-sm font-bold">{p.subject}</p>
                    <p className="truncate text-xs muted">
                      {to12h(p.startTime)} – {to12h(p.endTime)} · {p.facultyName || '—'}
                    </p>
                    <p className="mt-1 text-xs">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{p.present} present</span>
                      <span className="muted"> · </span>
                      <span className="font-semibold text-rose-600 dark:text-rose-400">{p.absent} absent</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!data.sessions.length && (
            <p className="mb-4 rounded-2xl bg-white/50 px-4 py-3 text-sm muted dark:bg-white/5">No completed attendance records are available for this period.</p>
          )}

          {data.students.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="px-2 py-2">Student</th>
                    <th className="px-2 py-2">Roll no</th>
                    <th className="px-2 py-2">Department</th>
                    <th className="px-2 py-2">Year</th>
                    <th className="px-2 py-2">Sec</th>
                    <th className="px-2 py-2">Sem</th>
                    <th className="px-2 py-2 text-right">Held</th>
                    <th className="px-2 py-2 text-right">Present</th>
                    <th className="px-2 py-2 text-right">Absent</th>
                    <th className="px-2 py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/60 dark:divide-white/5">
                  {data.students.map((s) => (
                    <tr key={s._id} className="table-row">
                      <td className="px-2 py-2 font-semibold">{s.name}</td>
                      <td className="px-2 py-2 muted">{s.rollNo || '—'}</td>
                      <td className="px-2 py-2 muted">{s.program || s.department}</td>
                      <td className="px-2 py-2 muted">{s.year}</td>
                      <td className="px-2 py-2 muted">{s.section}</td>
                      <td className="px-2 py-2 muted">{s.semester ?? '—'}</td>
                      <td className="px-2 py-2 text-right">{s.totalPeriods}</td>
                      <td className="px-2 py-2 text-right">{s.presentPeriods}</td>
                      <td className="px-2 py-2 text-right">{s.absentPeriods}</td>
                      <td className="px-2 py-2 text-right">{s.totalPeriods ? <PercentBadge value={s.percentage} /> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ClipboardList} title="No students in this class yet" />
          )}
        </div>
      )}
    </Card>
  );
}
