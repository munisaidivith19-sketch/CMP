import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, Bus, Plus, Route as RouteIcon, Trash2, Users } from 'lucide-react';
import {
  useCreateBusMutation,
  useCreateBusRouteMutation,
  useDeleteTransportAssignmentMutation,
  useGetBusesQuery,
  useGetTransportAssignmentsQuery,
  useGetTransportRoutesQuery,
  usePickTransportPeopleQuery,
  useSetTransportAssignmentMutation,
  useStopBusTripMutation,
  useUpdateBusMutation,
  useUpdateBusRouteMutation,
} from '../../services/api';
import { Badge, Button, Card, EmptyState, PageHeader, Tabs } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select, Textarea } from '../../components/ui/form';
import { errMsg } from '../../utils/format';

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

function RouteForm({ route, onClose }) {
  const [name, setName] = useState(route?.name || '');
  const [code, setCode] = useState(route?.code || '');
  const [stops, setStops] = useState(route?.stops?.length ? route.stops.map((s) => ({ ...s, lat: String(s.lat), lng: String(s.lng), scheduledTime: s.scheduledTime || '' })) : [emptyStop(), emptyStop()]);
  const [geometry, setGeometry] = useState('');
  const [create, { isLoading: c }] = useCreateBusRouteMutation();
  const [update, { isLoading: u }] = useUpdateBusRouteMutation();
  const setStop = (i, patch) => setStops((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) => setStops((s) => {
    const n = [...s];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  const save = async () => {
    let geo;
    if (geometry.trim()) {
      try {
        const parsed = JSON.parse(geometry);
        geo = parsed?.type === 'LineString' ? parsed.coordinates : parsed?.geometry?.type === 'LineString' ? parsed.geometry.coordinates : parsed;
        if (!Array.isArray(geo)) throw new Error();
      } catch {
        return toast.error('Road geometry must be a GeoJSON LineString or a [[longitude, latitude], …] list');
      }
    }
    const body = {
      name,
      code: code || null,
      stops: stops.map((s, i) => ({ ...(s._id ? { _id: s._id } : {}), name: s.name, lat: Number(s.lat), lng: Number(s.lng), sequence: i + 1, scheduledTime: s.scheduledTime || undefined, isCollege: Boolean(s.isCollege) })),
      ...(geo ? { geometry: geo } : {}),
    };
    if (await run(() => (route ? update({ id: route._id, ...body }) : create(body)).unwrap(), route ? 'Route updated' : 'Route added')) onClose();
  };
  return (
    <Modal open size="lg" onClose={onClose} title={route ? `Edit ${route.name}` : 'Add route'} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={c || u} onClick={save}>Save</Button></>}>
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
        <Textarea
          label={`Road geometry (optional${route?.geometry ? ' — leave empty to keep the current one' : ''})`}
          rows={3}
          placeholder='GeoJSON LineString, e.g. {"type":"LineString","coordinates":[[80.0,13.0],[80.01,13.01]]}'
          hint="Without it, ETAs follow straight lines between stops and are marked approximate."
          value={geometry}
          onChange={(e) => setGeometry(e.target.value)}
        />
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
