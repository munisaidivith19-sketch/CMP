import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { CalendarClock, Clock, Coffee, MapPin, Search, User } from 'lucide-react';
import { useGetTimetableQuery } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Tabs, cn } from '../../components/ui/primitives';
import { DEPARTMENTS } from '../../utils/constants';

export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };
const STUDENT_ROLES = ['student', 'club_admin'];

const todayName = () => ['sunday', ...DAYS][new Date().getDay()];
const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const to12h = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Ticks every 30 s so "now / next" stays correct while the page is open. */
function useClock() {
  const [now, setNow] = useState(nowHHMM());
  useEffect(() => {
    const t = setInterval(() => setNow(nowHHMM()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function SlotCard({ slot, state, showSection, compact }) {
  if (slot.isBreak) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-primary-300/50 px-4 py-2.5 text-sm muted">
        <Coffee className="h-4 w-4" />
        <span className="font-semibold">{slot.breakLabel || 'Break'}</span>
        <span className="ml-auto text-xs">
          {to12h(slot.startTime)} – {to12h(slot.endTime)}
        </span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl p-3.5 transition-all duration-300',
        state === 'now' ? 'bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-glow' : 'bg-white/60 dark:bg-white/5',
        state === 'past' && 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('text-[11px] font-bold uppercase tracking-wide', state === 'now' ? 'text-white/80' : 'text-primary-600')}>
            {slot.subject?.code} · P{slot.period}
          </p>
          <p className="truncate font-bold">{slot.subject?.name}</p>
        </div>
        {state === 'now' && <Badge className="!bg-white/25 !text-white">Now</Badge>}
        {state === 'next' && <Badge color="info">Next</Badge>}
        {slot.subject?.type === 'lab' && state !== 'now' && <Badge color="warning">Lab</Badge>}
      </div>
      <div className={cn('mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs', state === 'now' ? 'text-white/85' : 'muted')}>
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
        {!compact && slot.faculty && (
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            {slot.faculty.name}
          </span>
        )}
        {showSection && <span className="font-semibold">Sec {slot.section} · {slot.department}</span>}
      </div>
    </div>
  );
}

function slotState(slot, day, now) {
  if (day !== todayName() || slot.isBreak) return null;
  if (slot.startTime <= now && slot.endTime > now) return 'now';
  if (slot.endTime <= now) return 'past';
  return 'future';
}

export default function Timetable() {
  const me = useSelector(selectUser);
  const isStudent = STUDENT_ROLES.includes(me.role);
  const now = useClock();
  const [view, setView] = useState('today');
  const [day, setDay] = useState(DAYS.includes(todayName()) ? todayName() : 'monday');
  const [lookup, setLookup] = useState({ section: '', department: me.department || '' });
  const [applied, setApplied] = useState(null);

  const params = applied?.section ? { section: applied.section, department: applied.department || undefined } : undefined;
  const { data, isLoading, isFetching, error, refetch } = useGetTimetableQuery(params);
  const slots = useMemo(() => data?.slots || [], [data]);

  const byDay = useMemo(() => {
    const map = Object.fromEntries(DAYS.map((d) => [d, []]));
    slots.forEach((s) => map[s.dayOfWeek]?.push(s));
    Object.values(map).forEach((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [slots]);

  const today = todayName();
  const todaySlots = byDay[today] || [];
  const nextSlot = todaySlots.find((s) => !s.isBreak && s.startTime > now);
  const periods = useMemo(() => {
    const rows = new Map();
    slots.filter((s) => !s.isBreak).forEach((s) => rows.set(`${s.startTime}-${s.endTime}`, { startTime: s.startTime, endTime: s.endTime, period: s.period }));
    return [...rows.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [slots]);
  const showSection = !isStudent && !applied?.section;

  const header = (
    <PageHeader
      icon={CalendarClock}
      title="Timetable"
      subtitle={
        isStudent
          ? me.section
            ? `${me.department} · Section ${me.section}${me.semester ? ` · Semester ${me.semester}` : ''}`
            : 'Your class schedule'
          : applied?.section
            ? `Section ${applied.section}${applied.department ? ` · ${applied.department}` : ''}`
            : me.role === 'faculty'
              ? 'Your teaching schedule'
              : 'Class schedules'
      }
      actions={<Tabs tabs={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'Week' }]} value={view} onChange={setView} />}
    />
  );

  if (isLoading) {
    return (
      <div>
        {header}
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {header}
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      {!isStudent && (
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="tt-dept">Department</label>
            <select id="tt-dept" className="input" value={lookup.department} onChange={(e) => setLookup((l) => ({ ...l, department: e.target.value }))}>
              <option value="">Any</option>
              {[...new Set([me.department, ...DEPARTMENTS].filter(Boolean))].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="sm:w-40">
            <label className="label" htmlFor="tt-sec">Section</label>
            <input id="tt-sec" className="input uppercase" maxLength={10} placeholder="e.g. A" value={lookup.section} onChange={(e) => setLookup((l) => ({ ...l, section: e.target.value.toUpperCase() }))} />
          </div>
          <div className="flex gap-2">
            <Button icon={Search} loading={isFetching} disabled={!lookup.section} onClick={() => setApplied({ ...lookup })}>
              View class
            </Button>
            {applied && (
              <Button variant="ghost" onClick={() => setApplied(null)}>
                {me.role === 'faculty' ? 'My schedule' : 'Clear'}
              </Button>
            )}
          </div>
        </Card>
      )}

      {data?.needsSection ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="Your class section isn’t set yet"
            text="An administrator assigns your department, section and semester. Once that’s done your timetable appears here automatically."
          />
        </Card>
      ) : !slots.length ? (
        <Card>
          <EmptyState icon={CalendarClock} title="No classes scheduled" text={isStudent ? 'Your class timetable has not been published yet.' : 'No timetable entries match this view.'} />
        </Card>
      ) : view === 'today' ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title={`Today · ${today.charAt(0).toUpperCase()}${today.slice(1)}`} subtitle={`${todaySlots.filter((s) => !s.isBreak).length} classes`} />
            {!todaySlots.length ? (
              <EmptyState icon={Coffee} title="No classes today" text="Enjoy the break — check the weekly view for upcoming classes." />
            ) : (
              <div className="space-y-2.5">
                {todaySlots.map((s) => {
                  const st = slotState(s, today, now);
                  return <SlotCard key={s._id} slot={s} state={st === 'future' && s === nextSlot ? 'next' : st} showSection={showSection} />;
                })}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Up next" />
            {nextSlot ? (
              <div className="space-y-3">
                <SlotCard slot={nextSlot} state="next" showSection={showSection} />
                <p className="text-xs muted">Starts at {to12h(nextSlot.startTime)}.</p>
              </div>
            ) : (
              <p className="text-sm muted">No more classes today.</p>
            )}
            <div className="mt-5 border-t border-white/60 pt-4 dark:border-white/10">
              <p className="label">This week</p>
              <div className="grid grid-cols-3 gap-2">
                {DAYS.map((d) => (
                  <button key={d} onClick={() => { setDay(d); setView('week'); }} className={cn('rounded-2xl bg-white/50 p-2 text-center dark:bg-white/5', d === today && 'ring-2 ring-primary-400')}>
                    <p className="text-[11px] font-bold uppercase muted">{DAY_SHORT[d]}</p>
                    <p className="text-lg font-extrabold">{byDay[d].filter((s) => !s.isBreak).length}</p>
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <>
          {/* Phones: one day at a time. */}
          <div className="md:hidden">
            <div className="mb-3 flex gap-1.5 overflow-x-auto scrollbar-none">
              {DAYS.map((d) => (
                <button key={d} onClick={() => setDay(d)} className={cn('chip shrink-0', day === d && 'chip-active')}>
                  {DAY_SHORT[d]}
                </button>
              ))}
            </div>
            <div className="space-y-2.5">
              {byDay[day].length ? byDay[day].map((s) => <SlotCard key={s._id} slot={s} state={slotState(s, day, now)} showSection={showSection} />) : <Card><p className="text-sm muted">No classes.</p></Card>}
            </div>
          </div>

          {/* Tablets and up: the full week grid. */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[860px] table-fixed border-separate border-spacing-2 text-sm">
              <thead>
                <tr>
                  <th className="w-28 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted">Time</th>
                  {DAYS.map((d) => (
                    <th key={d} className={cn('px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide', d === today ? 'text-primary-600' : 'text-ink-muted')}>
                      {DAY_SHORT[d]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={`${p.startTime}-${p.endTime}`}>
                    <td className="px-2 align-top text-xs font-semibold muted">
                      P{p.period}
                      <br />
                      {to12h(p.startTime)}
                    </td>
                    {DAYS.map((d) => {
                      const cell = byDay[d].filter((s) => !s.isBreak && s.startTime === p.startTime);
                      return (
                        <td key={d} className="align-top">
                          {cell.length ? (
                            <div className="space-y-1.5">
                              {cell.map((s) => (
                                <SlotCard key={s._id} slot={s} state={slotState(s, d, now)} compact showSection={showSection} />
                              ))}
                            </div>
                          ) : (
                            <div className="h-full min-h-[68px] rounded-2xl border border-dashed border-primary-300/30" aria-label="Free period" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
