import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, Bus, Navigation, Plus, Route as RouteIcon, Trash2, Users } from 'lucide-react';
import {
  useCreateBusMutation,
  useCreateBusRouteMutation,
  useDeleteTransportAssignmentMutation,
  useGetBusesQuery,
  useGetTransportAssignmentsQuery,
  useGetTransportConfigQuery,
  useGetTransportRouteQuery,
  useGetTransportRoutesQuery,
  usePickTransportPeopleQuery,
  usePreviewRouteGeometryMutation,
  useSetTransportAssignmentMutation,
  useStopBusTripMutation,
  useUpdateBusMutation,
  useUpdateBusRouteMutation,
} from '../../services/api';
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, Tabs } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select, Textarea } from '../../components/ui/form';
import { errMsg } from '../../utils/format';
import { routeSummary, stopsSignature } from './busGeo';

// MapLibre loads only when a route form is opened.
const RoutePreviewMap = lazy(() => import('./RoutePreviewMap'));

const run = async (fn, ok) => {
  try {
    await fn();
    toast.success(ok);
    return true;
  } catch (e) {
    toast.error(errMsg(e));
    return false;
  }
};

/** Search people (riders or trip sharers) by name / roll no / employee id. */
function PersonPicker({ kind, label, onPick }) {
  const [q, setQ] = useState('');
  const [d, setD] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setD(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = usePickTransportPeopleQuery({ q: d, kind }, { skip: d.length < 2 });
  return (
    <div>
      <Input label={label} placeholder="Type 2+ letters of a name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
      {d.length >= 2 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-white/20 text-sm">
          {(data?.people || []).map((p) => (
            <li key={p._id}>
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-white/50 dark:hover:bg-white/5" onClick={() => { onPick(p); setQ(''); }}>
                {p.name} <span className="muted">· {p.rollNo || p.employeeId || p.role}{p.department ? ` · ${p.department}` : ''}</span>
              </button>
            </li>
          ))}
          {data && !data.people.length && <li className="px-3 py-1.5 muted">No match</li>}
        </ul>
      )}
    </div>
  );
}

/* ── Buses ─────────────────────────────────────────────────────── */

function BusForm({ bus, routes, onClose }) {
  const [v, setV] = useState({
    number: bus?.number || '',
    registrationNumber: bus?.registrationNumber || '',
    route: bus?.route?._id || '',
    gpsSource: bus?.gpsSource || 'phone',
    trackerDeviceId: bus?.trackerDeviceId || '',
    isActive: bus ? bus.isActive : true,
  });
  const [staff, setStaff] = useState((bus?.trackingStaff || []).map((s) => (typeof s === 'object' ? { _id: s._id, name: s.name } : { _id: s, name: 'Staff member' })));
  const [create, { isLoading: c }] = useCreateBusMutation();
  const [update, { isLoading: u }] = useUpdateBusMutation();
  const save = async () => {
    const body = { ...v, route: v.route || null, trackerDeviceId: v.gpsSource === 'tracker' ? v.trackerDeviceId || null : null, registrationNumber: v.registrationNumber || null, trackingStaff: staff.map((s) => s._id) };
    if (await run(() => (bus ? update({ id: bus._id, ...body }) : create(body)).unwrap(), bus ? 'Bus updated' : 'Bus added')) onClose();
  };
  return (
    <Modal open onClose={onClose} title={bus ? `Edit ${bus.number}` : 'Add bus'} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={c || u} onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Bus number" value={v.number} maxLength={20} onChange={(e) => setV({ ...v, number: e.target.value.toUpperCase() })} />
        <Input label="Registration number (optional)" value={v.registrationNumber} maxLength={20} onChange={(e) => setV({ ...v, registrationNumber: e.target.value })} />
        <Select label="Route" keepCase placeholder="No route" options={routes.map((r) => ({ value: r._id, label: r.name }))} value={v.route} onChange={(e) => setV({ ...v, route: e.target.value })} />
        <Select label="GPS source" keepCase options={[{ value: 'phone', label: 'Staff phone during a trip' }, { value: 'tracker', label: 'Vehicle GPS tracker' }]} value={v.gpsSource} onChange={(e) => setV({ ...v, gpsSource: e.target.value })} />
        {v.gpsSource === 'tracker' && <Input label="Tracker device ID" className="sm:col-span-2" hint="The id the tracker sends to the webhook (see README)." value={v.trackerDeviceId} onChange={(e) => setV({ ...v, trackerDeviceId: e.target.value })} />}
        <div className="sm:col-span-2">
          <PersonPicker kind="sharers" label="Staff who may share this bus’s location" onPick={(p) => setStaff((s) => (s.some((x) => x._id === p._id) ? s : [...s, p]))} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {staff.map((s) => (
              <Badge key={s._id} color="primary">
                {s.name} <button type="button" aria-label={`Remove ${s.name}`} onClick={() => setStaff((x) => x.filter((y) => y._id !== s._id))}>×</button>
              </Badge>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} /> Active</label>
      </div>
    </Modal>
  );
}

function BusesTab() {
  const { data } = useGetBusesQuery();
  const { data: routes } = useGetTransportRoutesQuery({ all: 'true' });
  const [edit, setEdit] = useState(undefined);
  const [stopTrip] = useStopBusTripMutation();
  const buses = data?.buses || [];
  return (
    <Card className="space-y-3">
      <div className="flex justify-end"><Button icon={Plus} onClick={() => setEdit(null)}>Add bus</Button></div>
      {!buses.length ? <EmptyState icon={Bus} title="No buses yet" /> : (
        <ul className="divide-y divide-white/10 text-sm">
          {buses.map((b) => (
            <li key={b._id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="flex-1 min-w-[12rem]"><strong>{b.number}</strong> · {b.route?.name || 'no route'} <span className="text-xs muted">· {b.gpsSource === 'tracker' ? `tracker ${b.trackerDeviceId || '(no device id)'}` : `${b.trackingStaff?.length || 0} trip sharer(s)`}</span></span>
              {!b.isActive && <Badge color="neutral">Inactive</Badge>}
              {b.trip?.status === 'active' && (
                <>
                  <Badge color="success">Trip running</Badge>
                  <Button size="sm" variant="ghost" onClick={() => run(() => stopTrip(b.trip._id).unwrap(), 'Trip stopped')}>Stop trip</Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEdit(b)}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      {edit !== undefined && <BusForm bus={edit} routes={(routes?.routes || []).filter((r) => r.isActive)} onClose={() => setEdit(undefined)} />}
    </Card>
  );
}

/* ── Routes ────────────────────────────────────────────────────── */

const emptyStop = () => ({ name: '', lat: '', lng: '', scheduledTime: '', isCollege: false });

/** Parse pasted geometry: a GeoJSON LineString / Feature, or a [[longitude, latitude], …] list. */
function parseGeometry(text) {
  const parsed = JSON.parse(text);
  const coords = parsed?.type === 'LineString' ? parsed.coordinates : parsed?.geometry?.type === 'LineString' ? parsed.geometry.coordinates : parsed;
  if (!Array.isArray(coords) || coords.length < 2 || !coords.every((p) => Array.isArray(p) && p.length >= 2 && p.every((n) => Number.isFinite(Number(n))))) throw new Error('shape');
  return coords.map((p) => [Number(p[0]), Number(p[1])]);
}

const SOURCE_TEXT = { generated: 'road route generated by the routing service', manual: 'geometry entered manually', unrecorded: 'road geometry (source not recorded)' };

function RouteForm({ route, onClose }) {
  const [name, setName] = useState(route?.name || '');
  const [code, setCode] = useState(route?.code || '');
  const [stops, setStops] = useState(route?.stops?.length ? [...route.stops].sort((a, b) => a.sequence - b.sequence).map((s) => ({ ...s, lat: String(s.lat), lng: String(s.lng), scheduledTime: s.scheduledTime || '', arrivalRadiusM: s.arrivalRadiusM ? String(s.arrivalRadiusM) : '' })) : [emptyStop(), emptyStop()]);
  // The run in the other direction: '' = the same stops in reverse order.
  const [returnRoute, setReturnRoute] = useState(route?.returnRoute ? String(route.returnRoute) : '');
  const { data: allRoutes } = useGetTransportRoutesQuery({ all: 'true' });
  const returnOptions = (allRoutes?.routes || []).filter((r) => r.isActive && String(r._id) !== String(route?._id)).map((r) => ({ value: String(r._id), label: r.name }));
  // A geometry change waiting to be saved: { kind: 'generated' | 'manual', geometry, … } or { kind: 'remove' }.
  // Nothing replaces or removes the stored line unless one of these is set explicitly.
  const [pending, setPending] = useState(null);
  const [pasted, setPasted] = useState('');
  const [genError, setGenError] = useState('');
  const [mapError, setMapError] = useState('');
  const { data: config } = useGetTransportConfigQuery();
  const { data: full, isFetching: loadingRoute } = useGetTransportRouteQuery(route?._id, { skip: !route });
  const [preview, { isLoading: generating }] = usePreviewRouteGeometryMutation();
  const [create, { isLoading: c }] = useCreateBusRouteMutation();
  const [update, { isLoading: u }] = useUpdateBusRouteMutation();
  const setStop = (i, patch) => setStops((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) => setStops((s) => {
    const n = [...s];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });

  const stored = full?.route?.geometry?.length >= 2 ? full.route.geometry : null;
  const info = full?.geometryInfo;
  const shown = pending?.kind === 'remove' ? null : pending?.geometry || stored;
  const signature = stopsSignature(stops);
  const loadedSignature = useMemo(() => stopsSignature([...(route?.stops || [])].sort((a, b) => a.sequence - b.sequence)), [route]);
  const coordsReady = stops.length >= 2 && stops.every((s) => String(s.lat).trim() !== '' && String(s.lng).trim() !== '' && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)));
  const generatedOutdated = pending?.kind === 'generated' && pending.signature !== signature;

  const generate = async () => {
    setGenError('');
    if (!coordsReady) return setGenError('Enter a latitude and longitude for every stop first (at least two stops).');
    try {
      const r = await preview({ stops: stops.map((s, i) => ({ name: s.name, lat: Number(s.lat), lng: Number(s.lng), sequence: i + 1 })) }).unwrap();
      setPending({ kind: 'generated', geometry: r.geometry, provider: r.provider, signature, summary: routeSummary(r.distanceM, r.durationS) });
    } catch (e) {
      // The stored geometry stays as it is; nothing is drawn in its place.
      setGenError(errMsg(e));
    }
  };
  const applyPasted = () => {
    try {
      setPending({ kind: 'manual', geometry: parseGeometry(pasted), signature });
      setGenError('');
    } catch {
      toast.error('Road geometry must be a GeoJSON LineString or a [[longitude, latitude], …] list');
    }
  };

  const save = async () => {
    if (generatedOutdated) return toast.error('The stops changed after the road route was generated. Generate it again, or discard it.');
    const body = {
      name,
      code: code || null,
      stops: stops.map((s, i) => ({ ...(s._id ? { _id: s._id } : {}), name: s.name, lat: Number(s.lat), lng: Number(s.lng), sequence: i + 1, scheduledTime: s.scheduledTime || undefined, isCollege: Boolean(s.isCollege), ...(String(s.arrivalRadiusM || '').trim() ? { arrivalRadiusM: Number(s.arrivalRadiusM) } : {}) })),
      returnRoute: returnRoute || null,
      ...(pending?.kind === 'generated' ? { geometry: pending.geometry, geometrySource: 'generated', geometryProvider: pending.provider } : {}),
      ...(pending?.kind === 'manual' ? { geometry: pending.geometry, geometrySource: 'manual' } : {}),
      ...(pending?.kind === 'remove' ? { geometry: null } : {}),
    };
    if (await run(() => (route ? update({ id: route._id, ...body }) : create(body)).unwrap(), route ? 'Route updated' : 'Route added')) onClose();
  };

  let status;
  if (pending?.kind === 'generated') status = `Road route generated${pending.summary ? ` · ${pending.summary}` : ''} — not saved yet.`;
  else if (pending?.kind === 'manual') status = 'Pasted geometry — not saved yet.';
  else if (pending?.kind === 'remove') status = 'The road geometry will be removed when you save. The map will then show an approximate path.';
  else if (stored) status = `Saved: ${SOURCE_TEXT[info?.source] || 'road geometry'}.`;
  else if (route && loadingRoute) status = 'Loading the saved route…';
  else status = 'No road geometry yet. Generate it from the stops, or ETAs will use straight lines and be marked approximate.';

  return (
    <Modal open size="lg" onClose={onClose} title={route ? `Edit ${route.name}` : 'Add route'} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={c || u} disabled={generating} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Route name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <Input label="Code (optional)" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />
        </div>
        <p className="label">Stops, in travel order</p>
        {stops.map((s, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-2xl border border-white/20 p-2 sm:grid-cols-[2rem_1fr_7rem_7rem_6rem_auto]">
            <span className="self-center text-center text-xs font-bold">{i + 1}</span>
            <Input aria-label={`Stop ${i + 1} name`} placeholder="Stop name" value={s.name} onChange={(e) => setStop(i, { name: e.target.value })} />
            <Input aria-label={`Stop ${i + 1} latitude`} placeholder="Latitude" inputMode="decimal" value={s.lat} onChange={(e) => setStop(i, { lat: e.target.value })} />
            <Input aria-label={`Stop ${i + 1} longitude`} placeholder="Longitude" inputMode="decimal" value={s.lng} onChange={(e) => setStop(i, { lng: e.target.value })} />
            <Input aria-label={`Stop ${i + 1} scheduled time`} type="time" value={s.scheduledTime} onChange={(e) => setStop(i, { scheduledTime: e.target.value })} />
            <div className="flex items-center gap-1">
              <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={s.isCollege} onChange={(e) => setStop(i, { isCollege: e.target.checked })} /> College</label>
              <button type="button" className="btn-icon btn-ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" className="btn-icon btn-ghost" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" className="btn-icon btn-ghost" disabled={stops.length <= 2} onClick={() => setStops((x) => x.filter((_, j) => j !== i))} aria-label="Remove stop"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
        <Button variant="soft" size="sm" icon={Plus} onClick={() => setStops((s) => [...s, emptyStop()])}>Add stop</Button>

        <div className="space-y-2 rounded-2xl border border-white/20 p-3">
          <p className="label">Return journey</p>
          <Select
            label="Trips in the other direction follow"
            keepCase
            placeholder="These stops in reverse order"
            options={returnOptions}
            value={returnRoute}
            onChange={(e) => setReturnRoute(e.target.value)}
            hint="Choose a separate route when the bus returns by different roads or stops (for example one-way streets)."
          />
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold">Arrival radius per stop (advanced)</summary>
            <p className="mt-1 muted">How close the bus must come for VEXON to record an arrival. Leave empty for the default; widen it for large bus bays, narrow it where a parallel road passes close by.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {stops.map((s, i) => (
                <Input key={i} label={`${i + 1}. ${s.name || 'Stop'} (metres)`} type="number" min={10} max={500} placeholder="Default" value={s.arrivalRadiusM || ''} onChange={(e) => setStop(i, { arrivalRadiusM: e.target.value })} />
              ))}
            </div>
          </details>
        </div>

        <div className="space-y-2 rounded-2xl border border-white/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="label flex-1">Road route</p>
            <Button size="sm" icon={Navigation} loading={generating} disabled={!coordsReady} onClick={generate}>Generate road route</Button>
            {pending && <Button size="sm" variant="ghost" onClick={() => { setPending(null); setGenError(''); }}>Discard change</Button>}
            {!pending && stored && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setPending({ kind: 'remove' })}>Remove geometry</Button>}
          </div>
          <p className="text-xs" aria-live="polite">{status}</p>
          {genError && <p role="alert" className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-600">{genError}</p>}
          {generatedOutdated && (
            <p role="alert" className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-700">You changed the stops after generating this road route. Generate it again before saving.</p>
          )}
          {!pending && stored && signature !== loadedSignature && (
            <p role="alert" className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-700">You changed the stops. The saved road route was made for the old stops and will be kept unchanged — generate a new one if the bus now takes a different road.</p>
          )}
          {!pending && stored && signature === loadedSignature && info?.stale === true && (
            <p role="alert" className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-700">The stops were edited after this road route was saved, so it may no longer match them. Generate it again.</p>
          )}
          {config?.mapStyleUrl && !mapError ? (
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <RoutePreviewMap styleUrl={config.mapStyleUrl} attribution={config.mapAttribution} stops={stops} geometry={shown} onMapError={setMapError} />
            </Suspense>
          ) : mapError ? (
            <p className="text-xs muted">Map preview unavailable: {mapError}</p>
          ) : null}
          <p className="text-[11px] muted">Routing uses OpenStreetMap roads through the server’s routing service. Check the line on the map before saving — the bus’s real road may differ.</p>
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold">Paste geometry manually (advanced)</summary>
            <div className="mt-2 space-y-2">
              <Textarea
                label="GeoJSON LineString or [[longitude, latitude], …]"
                rows={3}
                placeholder='{"type":"LineString","coordinates":[[80.0,13.0],[80.01,13.01]]}'
                hint="Longitude first. The line must pass within 500 m of every stop."
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <Button size="sm" variant="soft" disabled={!pasted.trim()} onClick={applyPasted}>Preview pasted geometry</Button>
            </div>
          </details>
        </div>
      </div>
    </Modal>
  );
}

function RoutesTab() {
  const { data } = useGetTransportRoutesQuery({ all: 'true' });
  const [edit, setEdit] = useState(undefined);
  const routes = data?.routes || [];
  return (
    <Card className="space-y-3">
      <div className="flex justify-end"><Button icon={Plus} onClick={() => setEdit(null)}>Add route</Button></div>
      {!routes.length ? <EmptyState icon={RouteIcon} title="No routes yet" /> : (
        <ul className="divide-y divide-white/10 text-sm">
          {routes.map((r) => (
            <li key={r._id} className="flex items-center gap-3 py-2">
              <span className="flex-1"><strong>{r.name}</strong>{r.code ? ` (${r.code})` : ''} <span className="text-xs muted">· {r.stops.length} stops</span></span>
              {r.geometryInfo?.points ? (
                r.geometryInfo.stale ? <Badge color="warning">Road route out of date</Badge> : <Badge color="success">Road route</Badge>
              ) : (
                <Badge color="neutral">Approximate path</Badge>
              )}
              {!r.isActive && <Badge color="neutral">Inactive</Badge>}
              <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      {edit !== undefined && <RouteForm route={edit} onClose={() => setEdit(undefined)} />}
    </Card>
  );
}

/* ── Assignments ───────────────────────────────────────────────── */

function AssignmentsTab() {
  const { data: routes } = useGetTransportRoutesQuery();
  const { data: buses } = useGetBusesQuery();
  const [routeFilter, setRouteFilter] = useState('');
  const { data } = useGetTransportAssignmentsQuery(routeFilter ? { route: routeFilter } : undefined);
  const [setAssignment, { isLoading }] = useSetTransportAssignmentMutation();
  const [remove] = useDeleteTransportAssignmentMutation();
  const [person, setPerson] = useState(null);
  const [v, setV] = useState({ route: '', stop: '', bus: '' });
  const route = (routes?.routes || []).find((r) => r._id === v.route);
  const save = async () => {
    if (await run(() => setAssignment({ user: person._id, route: v.route, stop: v.stop || null, bus: v.bus || null }).unwrap(), `${person.name} assigned`)) setPerson(null);
  };
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm font-bold">Assign a rider to a route and stop</p>
        <PersonPicker kind="riders" label="Student or staff member" onPick={setPerson} />
        {person && <p className="text-sm">Selected: <strong>{person.name}</strong></p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Route" keepCase placeholder="Choose route" options={(routes?.routes || []).map((r) => ({ value: r._id, label: r.name }))} value={v.route} onChange={(e) => setV({ route: e.target.value, stop: '', bus: '' })} />
          <Select label="Boarding stop" keepCase placeholder="No stop" options={(route?.stops || []).map((s) => ({ value: s._id, label: `${s.sequence}. ${s.name}` }))} value={v.stop} onChange={(e) => setV({ ...v, stop: e.target.value })} />
          <Select label="Bus (optional)" keepCase placeholder="Any bus on the route" options={(buses?.buses || []).filter((b) => b.route?._id === v.route).map((b) => ({ value: b._id, label: b.number }))} value={v.bus} onChange={(e) => setV({ ...v, bus: e.target.value })} />
        </div>
        <Button disabled={!person || !v.route} loading={isLoading} onClick={save}>Save assignment</Button>
      </Card>
      <Card className="space-y-3">
        <Select className="sm:w-64" label="Show route" keepCase placeholder="All routes" options={(routes?.routes || []).map((r) => ({ value: r._id, label: r.name }))} value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} />
        {!data?.assignments?.length ? <EmptyState icon={Users} title="No assignments" /> : (
          <ul className="divide-y divide-white/10 text-sm">
            {data.assignments.map((a) => (
              <li key={a._id} className="flex items-center gap-3 py-2">
                <span className="flex-1">{a.user?.name} <span className="text-xs muted">· {a.user?.rollNo || a.user?.role} · {a.route?.name}{a.stop ? ` · ${a.stop.name}` : ''}{a.bus ? ` · ${a.bus.number}` : ''}</span></span>
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${a.user?.name}`} onClick={() => run(() => remove(a._id).unwrap(), 'Removed')} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Transport managers (admin, transport officer): buses, routes and stops, rider assignments. */
export default function TransportAdmin() {
  const [tab, setTab] = useState('buses');
  return (
    <div className="space-y-4">
      <PageHeader
        icon={Bus}
        title="Manage buses"
        subtitle="Buses, routes and stops, and who rides which route"
        actions={<Tabs tabs={[{ value: 'buses', label: 'Buses' }, { value: 'routes', label: 'Routes & stops' }, { value: 'assignments', label: 'Riders' }]} value={tab} onChange={setTab} />}
      />
      {tab === 'buses' && <BusesTab />}
      {tab === 'routes' && <RoutesTab />}
      {tab === 'assignments' && <AssignmentsTab />}
    </div>
  );
}
