import { useMemo, useState } from 'react';
import { CalendarClock, Clock, MapPin } from 'lucide-react';
import { useGetMyScheduleQuery } from '../../services/api';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { WEEKDAYS, YEAR_LABELS } from '../../utils/constants';

const todayName = () => ['sunday', ...WEEKDAYS][new Date().getDay()];
const to12h = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** One assigned class, with the full academic context of the period. */
function ClassRow({ slot }) {
  return (
    <div className="rounded-2xl bg-white/60 p-3.5 dark:bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-primary-600">
            {slot.subject?.code} · P{slot.period}
          </p>
          <p className="truncate font-bold">{slot.subject?.name}</p>
        </div>
        <Badge color="info">Sec {slot.section}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs muted">
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {to12h(slot.startTime)} – {to12h(slot.endTime)}
        </span>
        {slot.room && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {slot.room}
          </span>
        )}
        <span className="font-semibold">
          {[slot.department, YEAR_LABELS[slot.year] || `Year ${slot.year}`, `Sem ${slot.semester}`].filter(Boolean).join(' · ')}
        </span>
      </div>
    </div>
  );
}

/**
 * "My Schedule": the classes the signed-in faculty member (or an HOD who also
 * teaches) actually handles across the week.
 *
 * There is no faculty selector — the server answers only with the
 * authenticated account's own teaching assignments, so this view cannot be
 * pointed at anybody else's schedule.
 */
export default function MySchedule() {
  const [semester, setSemester] = useState('');
  const { data, isLoading, isFetching, error, refetch } = useGetMyScheduleQuery(semester ? { semester } : undefined);
  const slots = useMemo(() => data?.slots || [], [data]);

  const byDay = useMemo(() => {
    const map = Object.fromEntries(WEEKDAYS.map((d) => [d, []]));
    slots.forEach((s) => map[s.dayOfWeek]?.push(s));
    Object.values(map).forEach((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [slots]);

  const today = todayName();
  const classCount = slots.length;
  const sections = [...new Set(slots.map((s) => `${s.department} · ${YEAR_LABELS[s.year] || s.year} · ${s.section}`))];

  if (isLoading) return <Skeleton className="h-64 rounded-[28px]" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (!classCount && !semester) {
    return (
      <Card>
        <EmptyState icon={CalendarClock} title="No teaching schedule assigned." text="Classes appear here as soon as you are scheduled for a period." />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="w-full sm:w-44">
          <label className="label" htmlFor="ms-sem">Semester</label>
          <select id="ms-sem" className="input" value={semester} onChange={(e) => setSemester(e.target.value)}>
            <option value="">All semesters</option>
            {(data?.semesters || []).map((s) => (
              <option key={s} value={s}>
                Semester {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 text-xs muted sm:pb-2.5">
          <p className="font-semibold text-ink">
            {classCount} {classCount === 1 ? 'class' : 'classes'} a week across {sections.length} {sections.length === 1 ? 'class group' : 'class groups'}
          </p>
          {sections.length > 0 && <p className="mt-0.5 break-words">{sections.join(' • ')}</p>}
        </div>
      </Card>

      {!classCount ? (
        <Card>
          <EmptyState icon={CalendarClock} title="No classes in this semester" text="Choose another semester to see your assigned classes." />
        </Card>
      ) : (
        <div className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-3', isFetching && 'opacity-60')}>
          {WEEKDAYS.filter((d) => byDay[d].length).map((d) => (
            <Card key={d} className={cn(d === today && 'ring-2 ring-primary-400')}>
              <CardHeader
                title={`${d.charAt(0).toUpperCase()}${d.slice(1)}`}
                subtitle={`${byDay[d].length} ${byDay[d].length === 1 ? 'class' : 'classes'}${d === today ? ' · today' : ''}`}
              />
              <div className="space-y-2.5">
                {byDay[d].map((s) => (
                  <ClassRow key={s._id} slot={s} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs muted">Showing only the periods assigned to you.</p>
    </div>
  );
}
