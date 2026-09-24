import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './ui/primitives';
import { catStyle } from '../utils/constants';
import { fmtTime } from '../utils/format';

/** Month calendar with event dots — mirrors the calendar widget in the reference dashboard. */
export default function MiniCalendar({ events = [] }) {
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState(new Date());

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month]
  );

  const eventsOn = (day) => events.filter((e) => isSameDay(new Date(e.startDate), day));
  const selectedEvents = eventsOn(selected);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-bold">{format(month, 'MMMM yyyy')}</p>
        <div className="flex gap-1">
          <button className="btn-icon btn-ghost h-8 w-8" aria-label="Previous month" onClick={() => setMonth(subMonths(month, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="btn-icon btn-ghost h-8 w-8" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <span key={d} className="pb-1 text-[10px] font-bold uppercase text-ink-muted">
            {d}
          </span>
        ))}
        {days.map((day) => {
          const evs = eventsOn(day);
          const active = isSameDay(day, selected);
          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelected(day)}
              className={cn(
                'relative flex aspect-square flex-col items-center justify-center rounded-xl text-xs font-semibold transition-all duration-300 ease-smooth',
                !isSameMonth(day, month) && 'text-ink-muted/50',
                active
                  ? 'bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-glow'
                  : isToday(day)
                    ? 'bg-primary-500/10 text-primary-600 dark:text-primary-200'
                    : 'hover:bg-white/70 dark:hover:bg-white/10'
              )}
            >
              {format(day, 'd')}
              {evs.length > 0 && (
                <span className="absolute bottom-1 flex gap-0.5">
                  {evs.slice(0, 3).map((e) => (
                    <span key={e._id} className="h-1 w-1 rounded-full" style={{ background: active ? '#fff' : catStyle(e.category).hex }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide muted">{format(selected, 'EEEE, dd MMM')}</p>
        {selectedEvents.length === 0 && <p className="text-xs muted">No events on this day.</p>}
        {selectedEvents.map((e) => (
          <Link key={e._id} to={`/events/${e._id}`} className="flex items-center gap-3 rounded-2xl bg-white/50 p-2.5 transition-colors hover:bg-white/80 dark:bg-white/5 dark:hover:bg-white/10">
            <span className="h-8 w-1.5 rounded-full" style={{ background: catStyle(e.category).hex }} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{e.title}</p>
              <p className="text-[11px] muted">{fmtTime(e.startDate)}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
