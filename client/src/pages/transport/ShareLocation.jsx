import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeftRight, MapPin, Navigation, Square } from 'lucide-react';
import {
  useGetBusQuery,
  useGetTransportConfigQuery,
  useGetTransportMeQuery,
  usePostTripLocationsMutation,
  useSetTripDirectionMutation,
  useStartBusTripMutation,
  useStopBusTripMutation,
} from '../../services/api';
import { useSocketConnected, useSocketEvent, useSocketRoom } from '../../services/socket';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, cn } from '../../components/ui/primitives';
import { Select } from '../../components/ui/form';
import { errMsg } from '../../utils/format';
import { accuracyText, agoText } from './busGeo';
import { createShareSession } from './shareSession';
import JourneyPanel from './JourneyPanel';
import { DIRECTION_LABEL } from './journeyFormat';

const BusMap = lazy(() => import('./BusMap'));

// The device key of a trip this TAB started, so a reload can resume it. Per
// tab (sessionStorage), never shared with other tabs or devices.
const KEY_PREFIX = 'vexon:share:';
const remember = (tripId, value) => {
  try {
    window.sessionStorage.setItem(KEY_PREFIX + tripId, JSON.stringify(value));
  } catch {
    /* storage blocked: resuming after a reload will not be offered */
  }
};
const recall = (tripId) => {
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY_PREFIX + tripId) || 'null');
  } catch {
    return null;
  }
};
const forgetAll = () => {
  try {
    Object.keys(window.sessionStorage).filter((k) => k.startsWith(KEY_PREFIX)).forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    /* nothing stored */
  }
};

function warningText(st) {
  switch (st.warning) {
    case 'weak_gps':
      return `The GPS reading is too rough to send (${accuracyText(st.lastFix?.accuracy) || 'no accuracy reported'}). Move into the open or near a window; sharing continues when the signal improves.`;
    case 'gps_unavailable':
      return 'The device cannot get a position right now. Sharing continues as soon as it does.';
    case 'no_fix':
      return 'No new position from this device for over 30 seconds. Keep this page open and the screen on — browsers pause location when the page is hidden or the phone sleeps.';
    case 'network':
      return `Network problem — ${st.queued} position${st.queued === 1 ? '' : 's'} waiting. Retrying automatically.`;
    case 'rate_limited':
      return 'VEXON is receiving updates too fast. Retrying shortly.';
    case 'rejected':
      return `VEXON did not accept the last position${st.warningDetail ? `: ${st.warningDetail}` : ''}.`;
    default:
      return '';
  }
}

/** Keep the screen awake while sharing (where supported) — a sleeping phone stops reporting. */
function useWakeLock(on) {
  useEffect(() => {
    if (!on || !navigator.wakeLock?.request) return undefined;
    let lock = null;
    let cancelled = false;
    const acquire = () => {
      navigator.wakeLock.request('screen').then((l) => {
        if (cancelled) l.release().catch(() => {});
        else lock = l;
      }).catch(() => {});
    };
    acquire();
    // The lock is released when the tab is hidden; take it again on return.
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [on]);
}

/**
 * Share bus location (Faculty, HOD, Dean, AO and the transport officer, for
 * the buses they are assigned to). Nothing is read until "Start sharing";
 * the trip begins on the server only after the device produces a usable
 * position; "Stop sharing" ends it. Viewers see the bus — never the sharer.
 */
export default function ShareLocation() {
  const { data: config, isLoading: cfgLoading, error: cfgError, refetch: refetchCfg } = useGetTransportConfigQuery();
  const { data: mine, isLoading, error, refetch } = useGetTransportMeQuery();
  const [startTrip] = useStartBusTripMutation();
  const [postFixes] = usePostTripLocationsMutation();
  const [stopTrip, { isLoading: stoppingOther }] = useStopBusTripMutation();
  const [setDirection, { isLoading: switching }] = useSetTripDirectionMutation();
  // Which way this trip runs — chosen before starting, sent with the start request.
  const [direction, setDirectionChoice] = useState('');
  const directionRef = useRef('');
  directionRef.current = direction;
  const [directionError, setDirectionError] = useState('');
  const calls = useRef({});
  calls.current = { startTrip, postFixes, stopTrip };
  const session = useRef(null);
  const [st, setSt] = useState(null);
  const [busId, setBusId] = useState('');
  const [serverLoc, setServerLoc] = useState(null);
  const [mapError, setMapError] = useState('');
  const [otherError, setOtherError] = useState('');
  const [, tick] = useState(0);
  const connected = useSocketConnected();

  useEffect(() => {
    const s = createShareSession({
      geo: typeof navigator !== 'undefined' ? navigator.geolocation : undefined,
      secure: Boolean(window.isSecureContext),
      onChange: setSt,
      api: {
        start: async (id) => {
          const r = await calls.current.startTrip({ busId: id, direction: directionRef.current || undefined }).unwrap();
          remember(r.trip._id, { busId: id, deviceKey: r.deviceKey });
          return { tripId: r.trip._id, deviceKey: r.deviceKey };
        },
        send: (tripId, deviceKey, fixes) => calls.current.postFixes({ tripId, deviceKey, fixes }).unwrap(),
        stop: (tripId) => calls.current.stopTrip(tripId).unwrap(),
      },
    });
    session.current = s;
    setSt(s.state);
    // Leaving the page stops reading the location and ends the trip.
    return () => s.destroy();
  }, []);

  const phase = st?.phase || 'idle';
  const running = ['locating', 'starting', 'sharing'].includes(phase);
  useWakeLock(phase === 'sharing');

  // A trip that is over leaves no resumable key behind; refresh "my active trip".
  useEffect(() => {
    if (['stopped', 'ended', 'error'].includes(phase)) forgetAll();
    refetch();
  }, [phase, refetch]);

  // Closing or reloading the tab ends browser sharing — warn first.
  useEffect(() => {
    if (!running) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const shareable = useMemo(() => mine?.shareable || [], [mine]);
  const activeTrip = mine?.activeTrip || null;
  const resumable = activeTrip && !running ? recall(activeTrip._id) : null;
  const mapBusId = st?.busId && running ? st.busId : activeTrip?.bus?._id || busId;
  const { data: detail, refetch: refetchDetail } = useGetBusQuery({ id: mapBusId }, { skip: !mapBusId, pollingInterval: running ? 30000 : 0 });

  // What viewers see: the position VEXON accepted for this bus (over the socket).
  useSocketRoom('transport:subscribe', 'transport:unsubscribe', mapBusId || null);
  useSocketEvent('bus:location', (p) => {
    if (p.busId === String(mapBusId)) setServerLoc(p);
  });
  useSocketEvent('bus:trip', (e) => {
    if (e.busId === String(mapBusId)) refetch();
  });
  useSocketEvent('bus:journey', (e) => {
    if (e.busId === String(mapBusId)) refetchDetail();
  });
  useEffect(() => setServerLoc(null), [mapBusId]);

  useEffect(() => {
    if (!busId && shareable.length === 1) setBusId(String(shareable[0]._id));
  }, [busId, shareable]);

  // Re-centre only when the bus changes or the device's first position arrives — not on every update.
  const hasDeviceFix = Boolean(st?.lastFix && running);
  const fit = useMemo(() => ({ kind: hasDeviceFix ? 'both' : 'all', nonce: `${mapBusId}:${hasDeviceFix}` }), [mapBusId, hasDeviceFix]);

  if (cfgLoading || isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader icon={Navigation} title="Share bus location" subtitle="Loading…" />
        <Skeleton className="h-[50vh]" />
      </div>
    );
  }
  if (cfgError || error) {
    return (
      <div className="space-y-4">
        <PageHeader icon={Navigation} title="Share bus location" />
        <ErrorState error={cfgError || error} onRetry={() => (cfgError ? refetchCfg() : refetch())} />
      </div>
    );
  }

  const busNumber = shareable.find((b) => String(b._id) === String(mapBusId))?.number || activeTrip?.bus?.number || detail?.bus?.number || '';
  const phoneBuses = shareable.filter((b) => b.gpsSource !== 'tracker');
  const warning = st ? warningText(st) : '';
  const deviceFix = st?.lastFix && running ? { lat: st.lastFix.lat, lng: st.lastFix.lng, accuracy: st.lastFix.accuracy } : null;
  const mapBus = detail?.bus ? [{ ...detail.bus, trip: phase === 'sharing' ? { status: 'active' } : detail.bus.trip }] : [];

  // The journey of the trip this person is sharing (server-recorded).
  const myTripId = st?.tripId || activeTrip?._id;
  const journey = detail?.journey && String(detail.journey.tripId) === String(myTripId) ? detail.journey : null;
  const stopsRecorded = journey?.stops?.some((s) => s.actualArrivalAt || s.actualDepartureAt);
  const switchDirection = async () => {
    setDirectionError('');
    const to = journey.direction === 'towards_home' ? 'towards_college' : 'towards_home';
    try {
      await setDirection({ id: journey.tripId, direction: to }).unwrap();
      refetchDetail();
    } catch (e) {
      setDirectionError(errMsg(e));
    }
  };
  const journeyBlock = journey && (
    <div className="space-y-2 border-t border-white/20 pt-3">
      <JourneyPanel journey={journey} tz={config?.timezone} />
      {!stopsRecorded && journey.status === 'active' && (
        <Button size="sm" variant="ghost" icon={ArrowLeftRight} loading={switching} onClick={switchDirection}>
          Wrong direction? Switch to {DIRECTION_LABEL[journey.direction === 'towards_home' ? 'towards_college' : 'towards_home'].toLowerCase()}
        </Button>
      )}
      {directionError && <p role="alert" className="text-xs text-rose-600">{directionError}</p>}
    </div>
  );

  const stopOther = async () => {
    setOtherError('');
    try {
      await stopTrip(activeTrip._id).unwrap();
      forgetAll();
      refetch();
    } catch (e) {
      setOtherError(errMsg(e));
    }
  };

  let panel;
  if (running || phase === 'stopping') {
    panel = (
      <Card className="space-y-3" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs muted">Bus</p>
            <p className="text-lg font-extrabold">{busNumber || '—'}</p>
          </div>
          {phase === 'sharing' ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300" role="status">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              Sharing live
            </span>
          ) : (
            <Badge color="warning">{phase === 'locating' ? 'Waiting for location' : phase === 'starting' ? 'Starting…' : 'Stopping…'}</Badge>
          )}
        </div>
        {phase === 'locating' && <p className="text-sm">Waiting for this device’s location. If the browser asks, choose <strong>Allow</strong>. Nothing is shared until a usable position arrives.</p>}
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div><dt className="muted">Last update accepted</dt><dd className="font-semibold">{st?.lastAcceptedAt ? agoText(st.lastAcceptedAt) : '—'}</dd></div>
          <div><dt className="muted">Device accuracy</dt><dd className="font-semibold">{st?.lastFix ? accuracyText(st.lastFix.accuracy) || 'not reported' : '—'}</dd></div>
          <div><dt className="muted">Positions sent</dt><dd className="font-semibold">{st?.accepted ?? 0}</dd></div>
          <div><dt className="muted">Connection</dt><dd className="font-semibold">{connected ? 'Online' : 'Reconnecting…'}</dd></div>
        </dl>
        {warning && <p role="alert" className="flex gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" />{warning}</p>}
        <Button variant="danger" icon={Square} className="w-full" loading={phase === 'stopping'} onClick={() => session.current?.stop()}>
          Stop sharing
        </Button>
        {journeyBlock}
        <p className="text-[11px] muted">Keep this page open with the screen on. Browsers stop sending location when the tab is closed, hidden or the phone sleeps — for long trips, the VEXON Android app shares more reliably.</p>
      </Card>
    );
  } else if (activeTrip) {
    panel = (
      <Card className="space-y-3">
        <p className="text-sm">
          You are already sharing <strong>{activeTrip.bus.number}</strong>
          {resumable ? ' from this tab (before it was reloaded).' : activeTrip.channel === 'web' ? ' from another browser tab or device.' : ' from the VEXON app.'}
        </p>
        {resumable ? (
          <Button icon={Navigation} className="w-full" onClick={() => session.current?.resume({ busId: String(activeTrip.bus._id), tripId: activeTrip._id, deviceKey: resumable.deviceKey })}>
            Resume sharing {activeTrip.bus.number}
          </Button>
        ) : (
          <p className="text-xs muted">Only one bus can be shared per person, from one device. Stop that trip to share from here.</p>
        )}
        <Button variant={resumable ? 'ghost' : 'danger'} icon={Square} className="w-full" loading={stoppingOther} onClick={stopOther}>
          Stop that trip
        </Button>
        {otherError && <p role="alert" className="text-xs text-rose-600">{otherError}</p>}
        {journeyBlock}
      </Card>
    );
  } else if (!shareable.length) {
    panel = (
      <Card>
        <EmptyState icon={MapPin} title="No buses assigned to you" text="A transport manager must add you to a bus’s tracking staff before you can share its location." />
      </Card>
    );
  } else {
    panel = (
      <Card className="space-y-3">
        <Select
          label="Bus"
          keepCase
          placeholder="Choose the bus you are on"
          options={shareable.map((b) => ({ value: String(b._id), label: `${b.number}${b.route ? ` · ${b.route}` : ''}${b.gpsSource === 'tracker' ? ' (has its own GPS tracker)' : ''}` }))}
          value={busId}
          onChange={(e) => setBusId(e.target.value)}
        />
        {busId && !phoneBuses.some((b) => String(b._id) === busId) && <p className="text-xs text-amber-700">This bus reports through its own GPS tracker — phone sharing is not needed.</p>}
        <fieldset>
          <legend className="label">Direction</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {Object.entries(DIRECTION_LABEL).map(([value, label]) => (
              <label key={value} className={cn('flex cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold focus-within:ring-4 focus-within:ring-primary-400/30', direction === value ? 'border-primary-500 bg-primary-500/10' : 'border-slate-300 dark:border-white/20')}>
                <input type="radio" name="trip-direction" value={value} checked={direction === value} onChange={() => setDirectionChoice(value)} className="accent-primary-600" />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] muted">Sets the order of stops riders see, and which arrival times are recorded.</p>
        </fieldset>
        <Button icon={Navigation} className="w-full" disabled={!busId || !direction || !phoneBuses.some((b) => String(b._id) === busId)} onClick={() => session.current?.start(busId)}>
          Start sharing
        </Button>
        {(phase === 'error' || phase === 'ended') && st?.error && <p role="alert" className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">{st.error.message}</p>}
        {phase === 'stopped' && (
          <p role="status" className="rounded-xl bg-white/40 px-3 py-2 text-xs dark:bg-white/5">
            Sharing stopped. This device’s location is no longer read or sent.{st?.error?.code === 'stop_unconfirmed' ? ` ${st.error.message}` : ''}
          </p>
        )}
        <ul className="list-disc space-y-1 pl-4 text-[11px] muted">
          <li>Your location is read only after you press Start, only while this page is open, and only for the bus you choose.</li>
          <li>Riders see the bus’s position — not your name or account.</li>
          <li>One person shares one bus at a time; a bus already being shared cannot be taken over.</li>
        </ul>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={Navigation} title="Share bus location" subtitle="Use this device’s GPS as the live position of your bus" actions={<Button variant="soft" to="/transport">Bus Tracking</Button>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className={cn('relative h-[50vh] min-h-[320px] overflow-hidden p-0 lg:h-[calc(100vh-13rem)]', !mapBusId && 'flex items-center justify-center')}>
          {!mapBusId ? (
            <p className="p-6 text-center text-sm muted">Choose a bus to see its route.</p>
          ) : mapError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="font-bold">The map could not be loaded</p>
              <p className="max-w-sm text-sm muted">{mapError}. Sharing works without the map.</p>
            </div>
          ) : (
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <BusMap
                styleUrl={config.mapStyleUrl}
                attribution={config.mapAttribution}
                thresholds={{ liveSeconds: config.liveSeconds, staleSeconds: config.staleSeconds }}
                buses={mapBus}
                locations={serverLoc ? { [serverLoc.busId]: serverLoc } : {}}
                selectedId={mapBusId}
                onSelect={() => {}}
                route={detail?.route || null}
                travelled={detail?.travelled}
                onSelectStop={() => {}}
                student={deviceFix}
                fit={fit}
                onMapError={setMapError}
              />
            </Suspense>
          )}
          {deviceFix && (
            <p className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-ink shadow">
              Blue dot: this device · Bus marker: the position riders see
            </p>
          )}
        </Card>
        <div className="space-y-4">
          {panel}
          <p className="text-xs muted">
            Not assigned to the right bus? Ask a transport manager. <Link className="text-primary-600 underline" to="/transport">Open Bus Tracking</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
