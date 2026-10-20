import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Bus, Crosshair, History, LocateFixed, Maximize2, Navigation, RefreshCw, Search, Settings2, WifiOff } from 'lucide-react';
import { useGetBusesQuery, useGetBusQuery, useGetTransportConfigQuery, useGetTransportMeQuery, useSearchTransportQuery } from '../../services/api';
import { useSocketConnected, useSocketEvent, useSocketRoom } from '../../services/socket';
import { selectUser } from '../../features/authSlice';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, cn } from '../../components/ui/primitives';
import { accuracyText, agoText, busStatus, etaText, initialFit } from './busGeo';
import { createLocator } from './myLocation';
import JourneyPanel from './JourneyPanel';
import { DIRECTION_LABEL, passedFromJourney } from './journeyFormat';

// Console logging of the raw device readings: on in development, or with
// ?locdebug=1 (or localStorage "vexon:locdebug" = "1"). Never sent anywhere.
function locationLogger() {
  let on = Boolean(import.meta.env?.DEV);
  try {
    on = on || new URLSearchParams(window.location.search).get('locdebug') === '1' || window.localStorage.getItem('vexon:locdebug') === '1';
  } catch {
    /* storage blocked: keep the default */
  }
  // eslint-disable-next-line no-console
  return on ? (what, data) => console.info(`[VEXON my-location] ${what}`, data) : undefined;
}

const BusMap = lazy(() => import('./BusMap'));

const STATUS = {
  live: { label: 'Live', color: 'success' },
  stale: { label: 'Position is old', color: 'warning' },
  offline: { label: 'Tracking offline', color: 'neutral' },
  not_sharing: { label: 'Not sharing', color: 'neutral' },
};

/**
 * Live Bus Tracking. Every bus the server lets this account see is on the
 * map at its latest VALID GPS position (never invented), with its age. Live
 * positions arrive over the socket; selecting a bus loads its route, stops,
 * progress and the ETA to the chosen stop. The student's own location is
 * read once, only when they press "My location".
 */
export default function Transport() {
  const me = useSelector(selectUser);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('bus') || '';
  const stopParam = params.get('stop') || '';
  const { data: config, isLoading: cfgLoading, error: cfgError, refetch: refetchCfg } = useGetTransportConfigQuery();
  const { data: list, isLoading, error, refetch, isFetching } = useGetBusesQuery(undefined, { pollingInterval: 60000 });
  const { data: mine } = useGetTransportMeQuery();
  const [locations, setLocations] = useState({}); // busId → latest live fix
  // The viewer's own device position — separate from every bus position.
  const [myLoc, setMyLoc] = useState({ state: 'idle', fix: null, message: '' });
  const student = myLoc.fix;
  const [mapError, setMapError] = useState('');
  const [mapKey, setMapKey] = useState(0);
  const [fit, setFit] = useState(() => initialFit(selectedId));
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [, tick] = useState(0);
  const live = useSocketConnected();

  // Default stop: the one on the viewer's own assignment (if this is their route).
  const stopId = stopParam || mine?.assignment?.stop?._id || '';
  const { data: detail, refetch: refetchDetail } = useGetBusQuery({ id: selectedId, stopId: stopId || undefined }, { skip: !selectedId, pollingInterval: 30000 });

  // Live positions: one room for every bus this viewer may see; re-joined after reconnects.
  useSocketRoom('transport:subscribe', 'transport:unsubscribe', 'all');
  const lastDetailRefresh = useRef(0);
  useSocketEvent('bus:location', (p) => {
    setLocations((cur) => ({ ...cur, [p.busId]: p }));
    // The ETA is recalculated by the server as valid fixes arrive (at most every 10 s here).
    if (p.busId === selectedId && Date.now() - lastDetailRefresh.current > 10000) {
      lastDetailRefresh.current = Date.now();
      refetchDetail();
    }
  });
  useSocketEvent('bus:trip', () => {
    refetch();
    if (selectedId) refetchDetail();
  });
  // A stop arrival / departure was recorded: show the server's times at once.
  useSocketEvent('bus:journey', (p) => {
    if (p.busId === selectedId) refetchDetail();
  });
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data: found } = useSearchTransportQuery(debounced, { skip: debounced.length < 1 });

  const buses = useMemo(() => list?.buses || [], [list]);
  const thresholds = useMemo(() => ({ liveSeconds: config?.liveSeconds, staleSeconds: config?.staleSeconds }), [config]);
  const locOf = useCallback((b) => locations[b._id] || b.location, [locations]);
  const select = (busId, stop) => {
    const next = new URLSearchParams(params);
    if (busId) next.set('bus', busId);
    else next.delete('bus');
    if (stop) next.set('stop', stop);
    else if (stop === null) next.delete('stop');
    setParams(next, { replace: true });
    setFit({ kind: busId ? 'bus' : 'all', nonce: Date.now() });
  };
  const selected = buses.find((b) => String(b._id) === selectedId);
  const selectedLoc = selected ? locOf(selected) : null;
  const status = busStatus(selected, selectedLoc, thresholds);

  // Your position, read only when asked: one fresh, validated reading (never a
  // cached one, never a default), one request at a time, stopped on leaving the
  // page. The map moves once, to the validated result, framing its accuracy.
  const fitAfter = useRef('student');
  const locator = useRef(null);
  useEffect(() => {
    const l = createLocator({
      win: window,
      log: locationLogger(),
      onChange: (next) => {
        setMyLoc(next);
        if (next.fix) setFit({ kind: fitAfter.current, nonce: Date.now() });
      },
    });
    locator.current = l;
    return () => l.stop();
  }, []);
  const locating = myLoc.state === 'requesting';
  const locate = (then = 'student') => {
    fitAfter.current = then;
    locator.current?.request();
  };

  if (cfgLoading || isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader icon={Bus} title="Bus Tracking" subtitle="Loading buses…" />
        <Skeleton className="h-[60vh]" />
      </div>
    );
  }
  if (cfgError || error) {
    return (
      <div className="space-y-4">
        <PageHeader icon={Bus} title="Bus Tracking" />
        <ErrorState error={cfgError || error} onRetry={() => (cfgError ? refetchCfg() : refetch())} />
      </div>
    );
  }

  const eta = detail?.eta;
  const journey = detail?.journey || null;
  // The line the bus is actually following (a separate return route, when it has one).
  const mapRoute = detail?.journeyRoute || detail?.route || null;
  const passedSeq = passedFromJourney(journey, mapRoute?.stops) ?? detail?.progress?.passedSequences ?? [];
  const passed = new Set(passedSeq);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Bus}
        title="Bus Tracking"
        subtitle="College buses at their latest GPS position"
        actions={
          (config?.canShare || config?.canManage || config?.canViewHistory) && (
            <div className="flex flex-wrap gap-2">
              {config?.canViewHistory && (
                <Button variant="soft" icon={History} to="/transport/history">
                  Journey history
                </Button>
              )}
              {config?.canShare && (
                <Button variant="soft" icon={Navigation} to="/transport/share">
                  Share bus location
                </Button>
              )}
              {config?.canManage && (
                <Button variant="soft" icon={Settings2} to="/transport/manage">
                  Manage buses
                </Button>
              )}
            </div>
          )
        }
      />
      {!live && (
        <div role="status" className="flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          <WifiOff className="h-4 w-4" /> Live updates paused — reconnecting. Positions refresh automatically once you are back online.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="relative h-[60vh] min-h-[360px] overflow-hidden p-0 lg:h-[calc(100vh-13rem)]">
          {mapError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="font-bold">The map could not be loaded</p>
              <p className="max-w-sm text-sm muted">{mapError}. Bus positions and ETAs are still listed on the right.</p>
              <Button icon={RefreshCw} onClick={() => { setMapError(''); setMapKey((k) => k + 1); }}>Retry</Button>
            </div>
          ) : (
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <BusMap
                key={mapKey}
                styleUrl={config.mapStyleUrl}
                attribution={config.mapAttribution}
                thresholds={thresholds}
                buses={buses}
                locations={locations}
                selectedId={selectedId}
                onSelect={(id) => select(id, null)}
                route={mapRoute ? { ...mapRoute, passedSequences: passedSeq } : null}
                travelled={detail?.travelled}
                selectedStopId={eta?.stop?._id || stopId}
                onSelectStop={(id) => select(selectedId, id)}
                student={student}
                fit={fit}
                onMapError={setMapError}
              />
            </Suspense>
          )}
          {/* Bottom-left, clear of the zoom controls (top-right) and the attribution (bottom-right). */}
          <div className="absolute bottom-3 left-3 right-24 flex flex-wrap gap-2">
            <Button size="sm" variant="map" icon={LocateFixed} loading={locating} onClick={() => locate('student')} aria-label="Show my location">
              {locating ? 'Finding you…' : 'My location'}
            </Button>
            {student && (
              <span className={cn('self-center rounded-full border px-2.5 py-1 text-[11px] font-bold shadow-md', myLoc.state === 'approximate' ? 'border-amber-600 bg-amber-600 text-white' : 'border-slate-300 bg-white text-ink dark:border-white/25 dark:bg-[#1b1d3a] dark:text-white')}>
                {myLoc.state === 'approximate' ? 'Approximate' : 'You'}: {accuracyText(student.accuracy)}
              </span>
            )}
            {selected && <Button size="sm" variant="map" icon={Crosshair} onClick={() => setFit({ kind: 'bus', nonce: Date.now() })}>Centre bus</Button>}
            {selected && <Button size="sm" variant="map" icon={Maximize2} onClick={() => (student ? setFit({ kind: 'both', nonce: Date.now() }) : locate('both'))}>Me + bus</Button>}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="space-y-3">
            <label className="label" htmlFor="bus-search">Find a bus, route or stop</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input id="bus-search" className="input pl-9" placeholder="Bus number, route or stop" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {debounced && found && (
              <ul className="max-h-56 space-y-1 overflow-y-auto text-sm" aria-label="Search results">
                {found.buses.map((b) => (
                  <li key={`b${b._id}`}><button type="button" className="w-full rounded-xl px-2 py-1.5 text-left hover:bg-white/50 dark:hover:bg-white/5" onClick={() => { select(b._id, null); setQ(''); }}>🚌 <strong>{b.number}</strong> · {b.route?.name || 'No route'}</button></li>
                ))}
                {found.routes.map((r) => {
                  const bus = buses.find((b) => String(b.route?._id) === String(r._id));
                  return (
                    <li key={`r${r._id}`}><button type="button" disabled={!bus} className="w-full rounded-xl px-2 py-1.5 text-left hover:bg-white/50 disabled:opacity-50 dark:hover:bg-white/5" onClick={() => { select(bus._id, null); setQ(''); }}>Route <strong>{r.name}</strong>{bus ? ` · ${bus.number}` : ' · no bus assigned'}</button></li>
                  );
                })}
                {found.stops.map((s) => {
                  const bus = buses.find((b) => String(b.route?._id) === String(s.routeId));
                  return (
                    <li key={`s${s.stopId}`}><button type="button" disabled={!bus} className="w-full rounded-xl px-2 py-1.5 text-left hover:bg-white/50 disabled:opacity-50 dark:hover:bg-white/5" onClick={() => { select(bus._id, s.stopId); setQ(''); }}>Stop <strong>{s.name}</strong> · {s.routeName}</button></li>
                  );
                })}
                {!found.buses.length && !found.routes.length && !found.stops.length && <li className="px-2 py-1.5 muted">Nothing matches “{debounced}”.</li>}
              </ul>
            )}
            {myLoc.message && (
              <div role={myLoc.state === 'available' || locating ? 'status' : 'alert'} className={cn('text-xs', myLoc.state === 'available' || locating ? 'muted' : 'text-amber-700 dark:text-amber-300')}>
                <p>{myLoc.message}</p>
                {!locating && myLoc.state !== 'available' && (
                  <button type="button" className="mt-1 font-semibold text-primary-600 underline" onClick={() => locate(fitAfter.current)}>
                    Try again
                  </button>
                )}
              </div>
            )}
            {myLoc.readings?.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer font-semibold muted">Location details (what your device reported)</summary>
                <p className="mt-1 muted">Shown only to you — not sent to the server.</p>
                <ul className="mt-1 space-y-1">
                  {myLoc.readings.map((r, i) => {
                    const used = student && r.timestamp === student.at && r.lat === student.lat && r.lng === student.lng;
                    return (
                      <li key={i} className="rounded-lg bg-white/40 p-1.5 font-mono dark:bg-white/5">
                        {Number.isFinite(r.lat) ? r.lat.toFixed(5) : r.lat}, {Number.isFinite(r.lng) ? r.lng.toFixed(5) : r.lng} · {accuracyText(r.accuracy) || 'no accuracy'} ·{' '}
                        {r.ageMs == null ? 'no time' : `${Math.round(r.ageMs / 1000)} s old`}
                        <br />
                        <span className="font-sans">{r.source} · {r.verdict === 'fresh' ? (used ? 'USED' : 'fresh') : r.verdict === 'stale' ? 'rejected: old reading' : 'rejected: invalid'}</span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </Card>

          {selected ? (
            <Card className="space-y-3" aria-live="polite">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-extrabold">{selected.number}</h2>
                  <p className="text-sm muted">{selected.route?.name || 'No route assigned'}</p>
                </div>
                <Badge color={STATUS[status].color}>{STATUS[status].label}</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div><dt className="muted">Last GPS update</dt><dd className="font-semibold">{selectedLoc ? agoText(selectedLoc.at) : 'never'}</dd></div>
                <div><dt className="muted">Speed</dt><dd className="font-semibold">{status === 'live' && Number.isFinite(selectedLoc?.speed) ? `${Math.round(selectedLoc.speed * 3.6)} km/h` : '—'}</dd></div>
                <div><dt className="muted">Next stop</dt><dd className="font-semibold">{journey ? journey.nextStop?.name || '—' : eta?.nextStop?.name || '—'}</dd></div>
                <div><dt className="muted">Trip</dt><dd className="font-semibold">{selected.trip?.status === 'active' ? `In progress${journey?.direction ? ` · ${DIRECTION_LABEL[journey.direction]}` : ''}` : 'Not running'}</dd></div>
              </dl>
              {journey ? (
                <JourneyPanel journey={journey} tz={config?.timezone} selectedStopId={stopId} onSelectStop={(id) => select(selectedId, id)} />
              ) : (
              <>
              <div className={cn('rounded-2xl p-3 text-sm', eta?.status === 'ok' ? 'bg-emerald-500/10' : 'bg-white/40 dark:bg-white/5')}>
                <p className="text-xs muted">ETA to {eta?.stop?.name || (stopId ? 'the selected stop' : 'the next stop')}</p>
                <p className="font-bold">{etaText(eta)}</p>
                {eta?.status === 'ok' && (
                  <p className="mt-1 text-[11px] muted">
                    {eta.method === 'schedule' ? 'From the route timetable' : 'From the bus’s recent speed'} · {eta.confidence} confidence · calculated {agoText(eta.computedAt)}
                    {eta.approximateRoute ? ' · road path not configured, distance approximated' : ''}
                  </p>
                )}
              </div>
              {status === 'not_sharing' && selectedLoc && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Nobody is sharing this bus’s location now. The marker is its last shared position, from {new Date(selectedLoc.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ({agoText(selectedLoc.at)}) — not where it is now.
                </p>
              )}
              {status !== 'live' && status !== 'not_sharing' && selectedLoc && <p className="text-xs text-amber-700 dark:text-amber-300">The bus is shown where it was last reported, {agoText(selectedLoc.at)}. It may have moved.</p>}
              {detail?.route && (
                <div>
                  <p className="label">Stops</p>
                  <ol className="space-y-1 text-sm">
                    {detail.route.stops.map((s) => {
                      const isSel = String(s._id) === String(eta?.stop?._id || stopId);
                      return (
                        <li key={s._id}>
                          <button type="button" onClick={() => select(selectedId, s._id)} className={cn('flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-white/50 dark:hover:bg-white/5', isSel && 'bg-primary-500/10 font-bold')} aria-current={isSel ? 'true' : undefined}>
                            <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', passed.has(s.sequence) ? 'bg-slate-300 text-slate-700' : 'bg-primary-500 text-white')}>{s.sequence}</span>
                            <span className={cn('flex-1', passed.has(s.sequence) && 'text-ink-muted line-through')}>{s.name}</span>
                            {s.scheduledTime && <span className="text-[11px] muted">{s.scheduledTime}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
              </>
              )}
              <Button size="sm" variant="ghost" onClick={() => select('', null)}>Show all buses</Button>
            </Card>
          ) : (
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-bold">Buses ({buses.length})</p>
                <Button size="sm" variant="ghost" icon={RefreshCw} loading={isFetching} onClick={() => refetch()} aria-label="Refresh buses">Refresh</Button>
              </div>
              {!buses.length ? (
                <EmptyState icon={Bus} title="No buses to show" text="No college buses are available to you yet." />
              ) : (
                <ul className="divide-y divide-white/10">
                  {buses.map((b) => {
                    const st = busStatus(b, locOf(b), thresholds);
                    return (
                      <li key={b._id}>
                        <button type="button" onClick={() => select(b._id, null)} className="flex w-full items-center gap-3 py-2.5 text-left">
                          <span className="flex-1">
                            <strong>{b.number}</strong>
                            <span className="block text-xs muted">{b.route?.name || 'No route'} · {locOf(b) ? agoText(locOf(b).at) : 'no position yet'}</span>
                          </span>
                          <Badge color={STATUS[st].color}>{STATUS[st].label}</Badge>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {mine?.assignment?.route && (
                <p className="mt-3 text-xs muted">
                  Your route: <strong>{mine.assignment.route.name}</strong>{mine.assignment.stop ? ` · your stop: ${mine.assignment.stop.name}` : ''}
                </p>
              )}
              {me.role !== 'student' && config?.canShare && (
                <p className="mt-3 text-xs muted">
                  Assigned to a bus? Share its location from this browser on <Link className="text-primary-600 underline" to="/transport/share">Share bus location</Link>, or from the VEXON Android app (Bus Tracking → Start trip).
                </p>
              )}
              {config?.canManage && <p className="mt-2 text-xs"><Link className="text-primary-600 underline" to="/transport/manage">Manage buses, routes and assignments</Link></p>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
