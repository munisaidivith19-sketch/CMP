import { AlertTriangle, Flag, MapPin } from 'lucide-react';
import { Badge, cn } from '../../components/ui/primitives';
import { METHOD_LABEL, campusTime, directionText, etaLine, stopLine } from './journeyFormat';

const DOT = {
  departed: 'bg-slate-400 text-white',
  arrived: 'bg-emerald-600 text-white',
  not_recorded: 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-100',
  upcoming: 'bg-primary-500 text-white',
};

/**
 * The server-recorded journey of a bus's active trip: direction, where it is
 * (at / next / following stop), the college, and every stop in travel order
 * with its RECORDED times or its PREDICTED time — never mixed up. All times
 * on the campus clock.
 */
export default function JourneyPanel({ journey, tz, selectedStopId, onSelectStop }) {
  if (!journey) return null;
  const { currentStop, nextStop, followingStop, college } = journey;
  const nextMethod = nextStop?.eta?.status === 'ok' ? METHOD_LABEL[nextStop.eta.method] : null;
  return (
    <section className="space-y-3" aria-label="Journey">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge color={journey.directionAssumed ? 'warning' : 'primary'}>{directionText(journey)}</Badge>
        {journey.tripStartedAt && <span className="muted">Trip started {campusTime(journey.tripStartedAt, tz)}</span>}
      </div>
      {journey.directionAssumed && (
        <p className="text-[11px] muted">The person sharing did not choose a direction, so “towards college” is assumed. Stops may be in the wrong order until they correct it.</p>
      )}
      {journey.nextStopUncertain && journey.uncertainReason && (
        <p role="status" className="flex gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {journey.uncertainReason}. The next stop may not be accurate.
        </p>
      )}

      <dl className="grid gap-2 text-sm">
        {currentStop && (
          <div className="rounded-2xl bg-emerald-500/10 p-3">
            <dt className="text-xs muted">At stop now</dt>
            <dd className="font-bold">{currentStop.name}</dd>
            <dd className="text-xs muted">Arrived {campusTime(currentStop.actualArrivalAt, tz)} (recorded)</dd>
          </div>
        )}
        <div className={cn('rounded-2xl p-3', nextStop?.eta?.status === 'ok' ? 'bg-primary-500/10' : 'bg-white/40 dark:bg-white/5')}>
          <dt className="text-xs muted">Next stop</dt>
          <dd className="font-bold">{nextStop ? nextStop.name : journey.status === 'active' ? 'No stops left on this trip' : '—'}</dd>
          {nextStop?.eta && <dd className="text-xs">{etaLine(nextStop.eta, tz)}</dd>}
          {nextMethod && <dd className="text-[11px] muted">Predicted {nextMethod}{nextStop.eta.confidence ? ` · ${nextStop.eta.confidence} confidence` : ''}</dd>}
        </div>
        {followingStop && (
          <div className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
            <dt className="text-xs muted">Then</dt>
            <dd className="font-semibold">{followingStop.name}</dd>
            {followingStop.eta && <dd className="text-xs">{etaLine(followingStop.eta, tz)}</dd>}
          </div>
        )}
        {college && (
          <div className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
            <dt className="flex items-center gap-1 text-xs muted"><Flag className="h-3.5 w-3.5" /> College · {college.name}</dt>
            <dd className="font-semibold">
              {college.actualArrivalAt ? `Arrived ${campusTime(college.actualArrivalAt, tz)} (recorded)` : college.eta ? `Expected ${etaLine(college.eta, tz)}` : '—'}
            </dd>
          </div>
        )}
      </dl>

      <div>
        <p className="label">Stops in travel order</p>
        <ol className="space-y-1 text-sm">
          {journey.stops.map((s) => {
            const isSel = selectedStopId && String(s.stopId) === String(selectedStopId);
            const isNext = nextStop && s.order === nextStop.order;
            return (
              <li key={s.order}>
                <button
                  type="button"
                  onClick={() => onSelectStop?.(s.stopId)}
                  className={cn('flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-white/50 dark:hover:bg-white/5', isSel && 'bg-primary-500/10')}
                  aria-current={isNext ? 'step' : undefined}
                >
                  <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', DOT[s.status] || DOT.upcoming)}>{s.order + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block', isNext && 'font-bold', s.status === 'departed' && 'text-ink-muted')}>
                      {s.name}
                      {s.isCollege && <MapPin className="ml-1 inline h-3.5 w-3.5" aria-label="college" />}
                    </span>
                    <span className="block text-[11px] muted">
                      {stopLine(s, tz)}
                      {(s.arrivalSource === 'manual' || s.departureSource === 'manual') && ' · recorded by staff'}
                      {s.scheduledTime && ` · timetable ${s.scheduledTime}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="text-[11px] muted">Arrival and departure times are recorded by VEXON from the bus’s GPS. “Expected” times are estimates.</p>
    </section>
  );
}
