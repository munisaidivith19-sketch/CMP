import { useState } from 'react';
import { AlertTriangle, ArrowRight, BedDouble, ClipboardCheck, Clock, UserCheck, UserX, Users } from 'lucide-react';
import { useGetClassTodayQuery } from '../../services/api';
import { Badge, Button, EmptyState, Skeleton, StatCard, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { displayName, fmtClassDay } from '../../utils/format';
import { YEAR_LABELS } from '../../utils/constants';

/**
 * Faculty Attendance cards for their own Class In-Charge class (the API takes
 * the class from the faculty account): students present today → absent list,
 * students below 75%, hostelers present today, today's classes and pending
 * correction requests — each card opens its list.
 */

const to12h = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const TODAY_LABEL = { present: 'Present', absent: 'Absent', unmarked: 'Not marked yet' };
const TODAY_COLOR = { present: 'success', absent: 'danger', unmarked: 'neutral' };

/** Name · roll · mobile row used by every list here. */
function StudentRow({ s, right }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-bold">{displayName(s)}</p>
        <p className="text-xs muted">Roll {s.rollNo || '—'}</p>
      </div>
      <div className="basis-28 text-xs">
        <p className="muted">Mobile</p>
        {s.phone ? (
          <a href={`tel:${s.phone}`} className="font-semibold text-primary-600 hover:underline">
            {s.phone}
          </a>
        ) : (
          <p className="font-semibold">—</p>
        )}
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </li>
  );
}

function List({ items, empty, render }) {
  if (!items.length) return <EmptyState icon={Users} title={empty} className="py-8" />;
  return <ul className="divide-y divide-white/60 dark:divide-white/5">{items.map(render)}</ul>;
}

/** Clickable count tile inside a modal (Present / Absent / Not marked). */
function Tile({ label, value, tone, active, onClick, icon: Icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-w-0 flex-1 basis-28 items-center gap-3 rounded-2xl border p-3 text-left transition',
        active ? 'border-primary-400 ring-2 ring-primary-400/30' : 'border-white/60 hover:border-primary-300 dark:border-white/10',
        tone
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-xl font-extrabold leading-none">{value}</span>
        <span className="block truncate text-xs font-semibold">{label}</span>
      </span>
    </button>
  );
}

/** Students (or hostelers) of the class today, by present / absent / not marked. */
function TodayBreakdown({ rows, counts, initial = 'absent', who = 'students' }) {
  const [show, setShow] = useState(initial);
  const items = rows.filter((s) => s.today === show);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Tile icon={UserX} label={`Absent ${who}`} value={counts.absent} tone="text-rose-700 dark:text-rose-300" active={show === 'absent'} onClick={() => setShow('absent')} />
        <Tile icon={UserCheck} label={`Present ${who}`} value={counts.present} tone="text-emerald-700 dark:text-emerald-300" active={show === 'present'} onClick={() => setShow('present')} />
        <Tile icon={Clock} label="Not marked yet" value={counts.unmarked} tone="text-ink-soft" active={show === 'unmarked'} onClick={() => setShow('unmarked')} />
      </div>
      <List
        items={items}
        empty={show === 'absent' ? `No absent ${who} today` : show === 'present' ? `No ${who} marked present yet` : 'Everyone has been marked'}
        render={(s) => (
          <StudentRow
            key={s._id}
            s={s}
            right={
              <>
                {s.todayPeriods > 0 && (
                  <span className="text-xs muted">
                    {s.todayPresentPeriods}/{s.todayPeriods} periods
                  </span>
                )}
                <Badge color={TODAY_COLOR[s.today]}>{TODAY_LABEL[s.today]}</Badge>
              </>
            }
          />
        )}
      />
    </div>
  );
}

export default function FacultyClassCards({ periods = [], periodsDate, corrections = [], pendingCount = 0, onQuickMark }) {
  const { data, isLoading } = useGetClassTodayQuery(undefined, { pollingInterval: 60000 });
  const [open, setOpen] = useState(null); // 'students' | 'below' | 'hostel' | 'classes' | 'pending'
  const cls = data?.class;
  const list = data?.list || [];
  const noClass = !isLoading && !cls;
  const classHint = noClass ? 'No Class In-Charge class assigned' : null;
  const where = cls ? `${cls.department} · ${YEAR_LABELS[cls.year] || `Year ${cls.year}`} · Sec ${cls.section}` : '';
  const marked = periods.filter((p) => p.marked).length;
  const below = list.filter((s) => s.totalPeriods > 0 && s.percentage < (data?.threshold || 75)).sort((a, b) => a.percentage - b.percentage);
  const hostelers = list.filter((s) => s.stayType === 'hosteler');

  if (isLoading) {
    return (
      <>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-[28px]" />
        ))}
      </>
    );
  }

  const titles = {
    students: { title: 'Students today', subtitle: `${where} · ${fmtClassDay(data?.date, 'EEE, dd MMM')}` },
    below: { title: `Below ${data?.threshold || 75}% attendance`, subtitle: `${where} · this semester` },
    hostel: { title: 'Hostelers today', subtitle: `${where} · ${fmtClassDay(data?.date, 'EEE, dd MMM')}` },
    classes: { title: "Today's classes", subtitle: fmtClassDay(periodsDate, 'EEEE, dd MMM') },
    pending: { title: 'Pending correction requests', subtitle: 'Waiting for your review' },
  };

  return (
    <>
      <StatCard
        icon={Users}
        label="Total Students"
        value={noClass ? '—' : data.students.total}
        hint={classHint || `${data.students.present} present today · ${data.students.absent} absent · Click to view`}
        gradient="from-violet-500 to-indigo-600"
        onClick={noClass ? undefined : () => setOpen('students')}
      />
      <StatCard
        icon={AlertTriangle}
        label={`Below ${data?.threshold || 75}%`}
        value={noClass ? '—' : data.belowThreshold}
        hint={classHint || `Students in your section under ${data.threshold}% · Click to view`}
        gradient="from-rose-500 to-pink-600"
        delay={60}
        onClick={noClass ? undefined : () => setOpen('below')}
      />
      <StatCard
        icon={BedDouble}
        label="Hostelers"
        value={noClass ? '—' : data.hostelers.total}
        hint={classHint || `${data.hostelers.present} present today · Click to view`}
        gradient="from-sky-400 to-blue-600"
        delay={120}
        onClick={noClass ? undefined : () => setOpen('hostel')}
      />
      <StatCard
        icon={ClipboardCheck}
        label="Today's Classes"
        value={periods.length}
        hint={periods.length ? `${marked} of ${periods.length} periods marked · Click to view` : 'No classes today'}
        gradient="from-emerald-400 to-teal-600"
        delay={180}
        onClick={() => setOpen('classes')}
      />
      <StatCard
        icon={Clock}
        label="Pending Corrections"
        value={pendingCount}
        hint={pendingCount > 0 ? `${pendingCount} awaiting approval · Click to view` : 'All requests reviewed'}
        gradient="from-amber-400 to-orange-500"
        delay={240}
        onClick={() => setOpen('pending')}
      />

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} size="lg" title={titles[open]?.title} subtitle={titles[open]?.subtitle}>
        {open === 'students' && <TodayBreakdown rows={list} counts={data.students} />}
        {open === 'hostel' && (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-bold">{data.hostelers.total}</span> hosteler{data.hostelers.total === 1 ? '' : 's'} in your section ·{' '}
              <span className="font-bold text-emerald-600">{data.hostelers.present}</span> present today
            </p>
            <TodayBreakdown rows={hostelers} counts={data.hostelers} initial="present" who="hostelers" />
          </div>
        )}
        {open === 'below' && (
          <List
            items={below}
            empty={`No student is below ${data.threshold}% this semester`}
            render={(s) => (
              <StudentRow
                key={s._id}
                s={s}
                right={
                  <>
                    <span className="text-xs muted">
                      {s.presentPeriods}/{s.totalPeriods} periods
                    </span>
                    <span className={cn('rounded-xl px-2.5 py-1 text-sm font-extrabold', s.percentage < 65 ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-amber-500/15 text-amber-800 dark:text-amber-300')}>
                      {s.percentage}%
                    </span>
                  </>
                }
              />
            )}
          />
        )}
        {open === 'classes' && (
          <List
            items={periods}
            empty="No classes scheduled for you today"
            render={(p) => (
              <li key={p.slotId} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <span className="w-16 shrink-0 text-xs font-bold uppercase tracking-wider text-primary-500">Period {p.period}</span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-bold">{p.subject?.name || 'Class'}</p>
                  <p className="truncate text-xs muted">
                    {p.subject?.code} · {p.department}
                    {p.year ? ` · Y${p.year}` : ''}
                    {p.section ? ` · Sec ${p.section}` : ''} · {to12h(p.startTime)} – {to12h(p.endTime)}
                  </p>
                </div>
                {p.holiday ? (
                  <Badge color="danger">Holiday</Badge>
                ) : p.marked ? (
                  <Badge color="success">Marked</Badge>
                ) : (
                  <Badge color={p.status === 'ACTIVE' ? 'info' : 'neutral'}>{p.status === 'ACTIVE' ? 'In progress' : p.status === 'UPCOMING' ? 'Upcoming' : 'Not marked'}</Badge>
                )}
                {!p.holiday && (p.status === 'ACTIVE' || p.marked) && (
                  <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => { setOpen(null); onQuickMark?.('mark', { slotId: p.slotId }); }}>
                    {p.marked ? 'Review' : 'Take'}
                  </Button>
                )}
              </li>
            )}
          />
        )}
        {open === 'pending' && (
          <div className="space-y-3">
            <List
              items={corrections}
              empty="No pending correction requests"
              render={(r) => (
                <li key={r._id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-sm font-bold">{displayName(r.student)}</p>
                    <p className="text-xs muted">
                      Roll {r.student?.rollNo || '—'}
                      {r.student?.section ? ` · Sec ${r.student.section}` : ''}
                    </p>
                  </div>
                  <div className="min-w-0 basis-48 text-xs">
                    <p className="font-semibold">
                      {r.subject?.name || 'Subject'} · Period {r.period}
                    </p>
                    <p className="muted">{fmtClassDay(r.date, 'EEE, dd MMM yyyy')}</p>
                  </div>
                  <p className="w-full break-words text-xs">“{r.reason}”</p>
                </li>
              )}
            />
            {corrections.length > 0 && (
              <Button icon={ArrowRight} onClick={() => { setOpen(null); onQuickMark?.('corrections'); }}>
                Review in Corrections
              </Button>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
