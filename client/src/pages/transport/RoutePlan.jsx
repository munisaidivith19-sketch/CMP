import { Clock, MapPin, Route as RouteIcon } from 'lucide-react';
import { cn } from '../../components/ui/primitives';
import { PLAN_METHOD_LABEL, distanceText, durationText, planApproximate, planSummary } from './journeyFormat';

/** "12.4 km · about 45 min · 8 stops", with how the time was worked out. */
export function RoutePlanSummary({ stats, className }) {
  if (!stats) return null;
  return (
    <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs', className)}>
      <span className="inline-flex items-center gap-1 font-semibold"><RouteIcon className="h-3.5 w-3.5" /> Total {planApproximate(stats) ? '~' : ''}{distanceText(stats.distanceM)}</span>
      <span className="inline-flex items-center gap-1 font-semibold"><Clock className="h-3.5 w-3.5" /> about {durationText(stats.minutes)}</span>
      <span className="muted">{stats.stops?.length || 0} stops · {PLAN_METHOD_LABEL[stats.method] || 'estimated'}{stats.exact === false ? ' · straight-line distances (no road route)' : ''}</span>
    </p>
  );
}

/**
 * Every stop of a route in travel order with its road distance and usual
 * travel time — from the previous stop and from the first stop.
 */
export default function RoutePlan({ stats, scheduled = {} }) {
  if (!stats?.stops?.length) return null;
  const approx = planApproximate(stats) ? '~' : '';
  return (
    <div className="space-y-2">
      <RoutePlanSummary stats={stats} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-xs">
          <thead>
            <tr className="text-left muted">
              <th className="py-1 pr-2 font-semibold">#</th>
              <th className="py-1 pr-2 font-semibold">Stop</th>
              <th className="py-1 pr-2 text-right font-semibold">From previous</th>
              <th className="py-1 pr-2 text-right font-semibold">From start</th>
              <th className="py-1 text-right font-semibold">Reaches after</th>
            </tr>
          </thead>
          <tbody>
            {stats.stops.map((s, i) => (
              <tr key={String(s.stopId || i)} className="border-t border-white/20">
                <td className="py-1 pr-2 font-bold">{i + 1}</td>
                <td className="py-1 pr-2">
                  {s.name}
                  {scheduled[String(s.stopId)] && <span className="muted"> · {scheduled[String(s.stopId)]}</span>}
                </td>
                <td className="py-1 pr-2 text-right">{i === 0 ? 'Start' : `${approx}${distanceText(s.fromPrevM)} · ${durationText(s.minutesFromPrev)}`}</td>
                <td className="py-1 pr-2 text-right font-semibold">{i === 0 ? '0 km' : `${approx}${distanceText(s.fromStartM)}`}</td>
                <td className="py-1 text-right">{i === 0 ? '—' : durationText(s.minutesFromStart)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-start gap-1 text-[11px] muted"><MapPin className="mt-px h-3 w-3 shrink-0" /> Usual times, not live. {planSummary(stats) ? 'Live arrival times show when the bus is on a trip.' : ''}</p>
    </div>
  );
}
