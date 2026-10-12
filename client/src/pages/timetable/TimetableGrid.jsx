import { useMemo } from 'react';
import { CalendarOff, Clock, Coffee, MapPin, Pencil, Plus, Trash2, User } from 'lucide-react';
import { Badge, Button, Card, cn } from '../../components/ui/primitives';
import { WEEKDAYS, YEAR_LABELS } from '../../utils/constants';
import { displayName, fmtClassDay } from '../../utils/format';

export const DAYS = WEEKDAYS;
export const DAY_SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };

export const todayName = () => ['sunday', ...DAYS][new Date().getDay()];
export const to12h = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export function slotState(slot, day, now) {
  if (day !== todayName() || slot.isBreak) return null;
  if (slot.startTime <= now && slot.endTime > now) return 'now';
  if (slot.endTime <= now) return 'past';
  return 'future';
}

/** Edit / delete buttons shown on a period for HOD and Admin. */
function SlotActions({ slot, onEdit, onDelete, light }) {
  if (!onEdit) return null;
  const btn = cn('rounded-lg p-1 transition-colors', light ? 'text-white/85 hover:bg-white/20' : 'text-ink-muted hover:bg-black/5 hover:text-ink dark:hover:bg-white/10 dark:hover:text-ink');
  const what = slot.isBreak ? 'break' : 'period';
  return (
    <div className="flex shrink-0 gap-0.5">
      <button type="button" className={btn} aria-label={`Edit ${what}`} title={`Edit ${what}`} onClick={() => onEdit(slot)}>
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={cn(btn, 'hover:!text-rose-500')} aria-label={`Delete ${what}`} title={`Delete ${what}`} onClick={() => onDelete(slot)}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function SlotCard({ slot, state, showSection, compact, onEdit, onDelete }) {
  // A break is not a period: it never shows a period number.
  if (slot.isBreak) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-primary-300/50 px-4 py-2.5 text-sm muted">
        <Coffee className="h-4 w-4" />
        <span className="font-semibold">{slot.breakLabel || 'Break'}</span>
        <span className="ml-auto text-xs">
          {to12h(slot.startTime)} – {to12h(slot.endTime)}
        </span>
        <SlotActions slot={slot} onEdit={onEdit} onDelete={onDelete} />
      </div>
    );
  }
  // This week's meeting is cancelled by a holiday. The timetable entry itself
  // is untouched and comes back by itself after the holiday.
  if (slot.holiday) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5" title={`Holiday: ${slot.holiday.reason}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wide text-rose-700 dark:text-rose-300">
              <CalendarOff className="h-3.5 w-3.5" /> Holiday · P{slot.period}
            </p>
            <p className="truncate font-bold">{slot.holiday.reason}</p>
          </div>
          <SlotActions slot={slot} onEdit={onEdit} onDelete={onDelete} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs muted">
          <span className="line-through">{slot.subject?.code} · {slot.subject?.name}</span>
          <span>No class · Attendance unavailable</span>
          {showSection && (
            <span className="font-semibold">
              {YEAR_LABELS[slot.year] || `Year ${slot.year}`} · Sec {slot.section} · {slot.department}
            </span>
          )}
        </div>
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
          <p className={cn('text-[11px] font-bold uppercase tracking-wide', state === 'now' ? 'text-white/90 font-extrabold' : 'text-primary-700 dark:text-primary-400')}>
            {slot.subject?.code} · P{slot.period}
          </p>
          <p className="truncate font-bold">{slot.subject?.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {state === 'now' && <Badge className="!bg-white/25 !text-white">Now</Badge>}
          {state === 'next' && <Badge color="info">Next</Badge>}
          {slot.subject?.type === 'lab' && state !== 'now' && <Badge color="warning">Lab</Badge>}
          <SlotActions slot={slot} onEdit={onEdit} onDelete={onDelete} light={state === 'now'} />
        </div>
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
            {displayName(slot.faculty)}
          </span>
        )}
        {showSection && (
          <span className="font-semibold">
            {YEAR_LABELS[slot.year] || `Year ${slot.year}`} · Sec {slot.section} · Sem {slot.semester} · {slot.department}
          </span>
        )}
      </div>
    </div>
  );
}

/** Slots grouped by weekday, each day in time order. */
export function useSlotsByDay(slots) {
  return useMemo(() => {
    const map = Object.fromEntries(DAYS.map((d) => [d, []]));
    slots.forEach((s) => map[s.dayOfWeek]?.push(s));
    Object.values(map).forEach((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [slots]);
}

/**
 * The week as rows of time windows (one per distinct start–end time). A class
 * row is labelled by its period number; a break row by its own label — a
 * break is never a period.
 */
function useTimeRows(slots) {
  return useMemo(() => {
    const rows = new Map();
    slots.forEach((s) => {
      const key = `${s.startTime}-${s.endTime}`;
      const row = rows.get(key);
      // A class at this time wins the label over a break at the same time.
      if (!row || (row.isBreak && !s.isBreak)) {
        rows.set(key, { startTime: s.startTime, endTime: s.endTime, period: s.isBreak ? null : s.period, isBreak: Boolean(s.isBreak), breakLabel: s.breakLabel || '' });
      }
    });
    return [...rows.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [slots]);
}

/**
 * Weekly timetable: one day at a time on phones, the full grid from tablets
 * up. With `onAdd` the empty cells and a per-day button add a period there.
 */
export function WeekGrid({ slots, week, now, day, onDayChange, compact, showSection, onAdd, onEdit, onDelete }) {
  const byDay = useSlotsByDay(slots);
  const rows = useTimeRows(slots);
  const today = todayName();
  const editProps = onEdit ? { onEdit, onDelete } : {};

  return (
    <>
      {/* Phones: one day at a time. */}
      <div className="md:hidden">
        <div className="mb-3 flex gap-1.5 overflow-x-auto scrollbar-none">
          {DAYS.map((d) => (
            <button key={d} onClick={() => onDayChange(d)} className={cn('chip shrink-0', day === d && 'chip-active')}>
              {DAY_SHORT[d]}
            </button>
          ))}
        </div>
        <div className="space-y-2.5">
          {byDay[day].length ? (
            byDay[day].map((s) => <SlotCard key={s._id} slot={s} state={slotState(s, day, now)} showSection={showSection} {...editProps} />)
          ) : (
            <Card>
              <p className="text-sm muted">No classes.</p>
            </Card>
          )}
          {onAdd && (
            <Button variant="soft" size="sm" icon={Plus} className="w-full" onClick={() => onAdd({ dayOfWeek: day })}>
              Add period on {DAY_SHORT[day]}
            </Button>
          )}
        </div>
      </div>

      {/* Tablets and up: the full week grid. */}
      <Card className="hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[860px] table-fixed border-separate border-spacing-2 text-sm">
          <thead>
            <tr>
              <th className="w-28 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted">Time</th>
              {DAYS.map((d) => (
                <th key={d} className={cn('px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide', d === today ? 'text-primary-700 dark:text-primary-400' : 'text-ink-muted')}>
                  {DAY_SHORT[d]}
                  {week?.[d] && <span className="ml-1 font-semibold normal-case opacity-70">{fmtClassDay(week[d], 'dd MMM')}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={`${p.startTime}-${p.endTime}`}>
                <td className="px-2 align-top text-xs font-semibold muted">
                  {p.isBreak ? p.breakLabel || 'Break' : `P${p.period}`}
                  <br />
                  {to12h(p.startTime)}
                </td>
                {DAYS.map((d) => {
                  const cell = byDay[d].filter((s) => s.startTime === p.startTime && s.endTime === p.endTime);
                  return (
                    <td key={d} className="align-top">
                      {cell.length ? (
                        <div className="space-y-1.5">
                          {cell.map((s) => (
                            <SlotCard key={s._id} slot={s} state={slotState(s, d, now)} compact={compact} showSection={showSection} {...editProps} />
                          ))}
                        </div>
                      ) : onAdd ? (
                        <button
                          type="button"
                          onClick={() =>
                            onAdd(
                              p.isBreak
                                ? { dayOfWeek: d, isBreak: true, breakLabel: p.breakLabel, startTime: p.startTime, endTime: p.endTime }
                                : { dayOfWeek: d, period: p.period, startTime: p.startTime, endTime: p.endTime }
                            )
                          }
                          className="flex h-full min-h-[68px] w-full items-center justify-center rounded-2xl border border-dashed border-primary-300/50 text-primary-500 transition-colors hover:bg-primary-500/5"
                          aria-label={`Add ${p.isBreak ? 'break' : 'period'} on ${DAY_SHORT[d]} at ${to12h(p.startTime)}`}
                          title={p.isBreak ? 'Add break' : 'Add period'}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
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
  );
}
