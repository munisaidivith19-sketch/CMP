import { useMemo, useState } from 'react';
import { BarChart3, History, PenLine, X } from 'lucide-react';
import {
  useGetBusesQuery,
  useGetTransportConfigQuery,
  useGetTransportHistoryQuery,
  useGetTransportHistoryTripQuery,
  useGetTransportReportQuery,
  useGetTransportRoutesQuery,
  useRecordStopEventMutation,
} from '../../services/api';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs, cn } from '../../components/ui/primitives';
import { Input, Select } from '../../components/ui/form';
import { errMsg } from '../../utils/format';
import { DIRECTION_LABEL, SOURCE_LABEL, TRIP_STATUS_LABEL, campusDate, campusDateTime, campusDayKey, campusLocalToIso, campusTime, delayText } from './journeyFormat';

const RANGES = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'all', label: 'Everything kept' },
  { value: 'custom', label: 'Choose dates' },
];
const mins = (m) => (m == null ? '—' : `${m} min`);

/**
 * Journey history (transport managers, principal, dean, AO, chairman: every
 * bus; trip sharers: the trips they ran) and measured reports. Recorded
 * times only — GPS-detected or entered by staff, always labelled — with the
 * prediction beside each arrival for comparison. Times on the campus clock.
 */
export default function TransportHistory() {
  const { data: config, isLoading: cfgLoading, error: cfgError, refetch: refetchCfg } = useGetTransportConfigQuery();
  const tz = config?.timezone;
  const [tab, setTab] = useState('trips');
  const [f, setF] = useState({ range: 'week', from: '', to: '', bus: '', route: '', direction: '', status: '' });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState('');
  const set = (k) => (e) => {
    setF((cur) => ({ ...cur, [k]: e.target.value }));
    setPage(1);
  };
  const params = useMemo(() => {
    const p = { page, limit: 20 };
    for (const [k, v] of Object.entries(f)) if (v && !((k === 'from' || k === 'to') && f.range !== 'custom')) p[k] = v;
    return p;
  }, [f, page]);
  const { data: buses } = useGetBusesQuery();
  const { data: routes } = useGetTransportRoutesQuery();
  const { data, isLoading, isFetching, error, refetch } = useGetTransportHistoryQuery(params, { skip: !config?.canViewHistory });
  const reportParams = useMemo(() => {
    const { page: _p, limit: _l, ...rest } = params;
    return rest;
  }, [params]);
  const { data: report, isFetching: reportLoading, error: reportError } = useGetTransportReportQuery(reportParams, { skip: tab !== 'report' || !config?.canViewReports });

  if (cfgLoading) return <Skeleton className="h-[60vh]" />;
  if (cfgError) return <ErrorState error={cfgError} onRetry={refetchCfg} />;
  if (!config?.canViewHistory) {
    return (
      <div className="space-y-4">
        <PageHeader icon={History} title="Journey history" />
        <EmptyState icon={History} title="Not available" text="Journey history is for transport staff and the staff who run bus trips." />
      </div>
    );
  }

  const filters = (
    <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <Select label="Period" keepCase options={RANGES} value={f.range} onChange={set('range')} />
      {f.range === 'custom' && (
        <>
          <Input label="From" type="date" value={f.from} max={campusDayKey(new Date(), tz)} onChange={set('from')} />
          <Input label="To" type="date" value={f.to} max={campusDayKey(new Date(), tz)} onChange={set('to')} />
        </>
      )}
      <Select label="Bus" keepCase placeholder="All buses" options={(buses?.buses || []).map((b) => ({ value: String(b._id), label: b.number }))} value={f.bus} onChange={set('bus')} />
      <Select label="Route" keepCase placeholder="All routes" options={(routes?.routes || []).map((r) => ({ value: String(r._id), label: r.name }))} value={f.route} onChange={set('route')} />
      <Select label="Direction" keepCase placeholder="Both" options={Object.entries(DIRECTION_LABEL).map(([value, label]) => ({ value, label }))} value={f.direction} onChange={set('direction')} />
      {tab === 'trips' && (
        <Select
          label="Status"
          keepCase
          placeholder="Any"
          options={[{ value: 'completed', label: 'Completed' }, { value: 'interrupted', label: 'Interrupted' }, { value: 'active', label: 'In progress' }]}
          value={f.status}
          onChange={set('status')}
        />
      )}
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader icon={History} title="Journey history" subtitle={`Recorded bus trips · times in ${tz || 'campus time'}`} actions={<Button variant="soft" to="/transport">Bus Tracking</Button>} />
      {config.canViewReports && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'trips', label: 'Trips' },
            { value: 'report', label: 'Reports' },
          ]}
        />
      )}
      {filters}
      {tab === 'report' ? (
        <ReportView report={report} loading={reportLoading} error={reportError} />
      ) : (
        <div className={cn('grid gap-4', openId && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]')}>
          <Card>
            {isLoading ? (
              <Skeleton className="h-64" />
            ) : error ? (
              <ErrorState error={error} onRetry={refetch} />
            ) : !data?.trips?.length ? (
              <EmptyState icon={History} title="No trips found" text={data?.scope === 'own' ? 'Trips you share appear here once you run one.' : 'No bus trips match these filters.'} />
            ) : (
              <>
                <p className="mb-2 text-xs muted" role="status">
                  {data.total} trip{data.total === 1 ? '' : 's'}{data.scope === 'own' ? ' you ran' : ''}{isFetching ? ' · updating…' : ''}
                </p>
                <ul className="divide-y divide-white/10">
                  {data.trips.map((t) => (
                    <li key={t._id}>
                      <button type="button" onClick={() => setOpenId(t._id)} className={cn('w-full rounded-xl px-2 py-2.5 text-left hover:bg-white/50 dark:hover:bg-white/5', openId === t._id && 'bg-primary-500/10')} aria-current={openId === t._id ? 'true' : undefined}>
                        <span className="flex flex-wrap items-center gap-2">
                          <strong>{t.bus?.number || 'Bus'}</strong>
                          <span className="text-xs muted">{t.route?.name || ''}</span>
                          {t.direction && <Badge color={t.directionAssumed ? 'warning' : 'primary'}>{DIRECTION_LABEL[t.direction]}{t.directionAssumed ? ' (assumed)' : ''}</Badge>}
                          <Badge color={t.status === 'completed' ? 'success' : t.status === 'active' ? 'primary' : 'warning'}>{TRIP_STATUS_LABEL[t.status] || t.status}</Badge>
                        </span>
                        <span className="mt-0.5 block text-xs muted">
                          {campusDate(t.tripStartedAt, tz)} · {campusTime(t.tripStartedAt, tz)}
                          {t.endedAt ? `–${campusTime(t.endedAt, tz)}` : ''} · {mins(t.durationMinutes)}
                          {t.hasJourney ? ` · ${t.stopsRecorded}/${t.stopsPlanned} stops recorded` : ' · started before stop recording'}
                          {t.collegeArrivedAt ? ` · college ${campusTime(t.collegeArrivedAt, tz)}` : ''}
                          {t.operator ? ` · ${t.operator.name}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Pagination page={data.page} pages={Math.ceil(data.total / data.limit)} onChange={setPage} />
              </>
            )}
          </Card>
          {openId && <TripDetail id={openId} tz={tz} canRecord={config.canManage} onClose={() => setOpenId('')} />}
        </div>
      )}
    </div>
  );
}

function TripDetail({ id, tz, canRecord, onClose }) {
  const { data, isLoading, error, refetch } = useGetTransportHistoryTripQuery(id);
  const [recording, setRecording] = useState(false);
  if (isLoading) return <Card><Skeleton className="h-80" /></Card>;
  if (error) return <Card><ErrorState error={error} onRetry={refetch} /></Card>;
  const { trip, stops, events } = data;
  return (
    <Card className="space-y-3" aria-label="Trip details">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold">{trip.bus?.number} · {trip.route?.name}</h2>
          <p className="text-xs muted">
            {campusDateTime(trip.tripStartedAt, tz)}
            {trip.direction ? ` · ${DIRECTION_LABEL[trip.direction]}${trip.directionAssumed ? ' (assumed)' : ''}` : ''}
            {trip.routeMode === 'reverse' ? ' · same stops, reverse order' : trip.routeMode === 'return_route' ? ' · return route' : ''}
          </p>
        </div>
        <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Close trip details" />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div><dt className="muted">Status</dt><dd className="font-semibold">{TRIP_STATUS_LABEL[trip.status] || trip.status}{trip.interrupted ? ' (interrupted)' : ''}</dd></div>
        <div><dt className="muted">Trip duration</dt><dd className="font-semibold">{mins(trip.durationMinutes)}</dd></div>
        <div><dt className="muted">Stop to stop</dt><dd className="font-semibold">{mins(trip.journeyMinutes)}</dd></div>
        <div><dt className="muted">College arrival</dt><dd className="font-semibold">{trip.collegeArrivedAt ? campusTime(trip.collegeArrivedAt, tz) : '—'}</dd></div>
        {trip.operator && <div className="col-span-2"><dt className="muted">Shared by</dt><dd className="font-semibold">{trip.operator.name}</dd></div>}
        {trip.endReason && <div className="col-span-2"><dt className="muted">Ended</dt><dd className="font-semibold">{trip.endReason}</dd></div>}
      </dl>
      {!trip.hasJourney ? (
        <p className="text-sm muted">This trip started before stop arrival recording was available — only its start and end are known.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <caption className="sr-only">Stops in travel order with recorded and predicted times</caption>
            <thead className="muted">
              <tr>
                <th scope="col" className="py-1 pr-2">Stop</th>
                <th scope="col" className="pr-2">Timetable</th>
                <th scope="col" className="pr-2">Arrived</th>
                <th scope="col" className="pr-2">Left</th>
                <th scope="col" className="pr-2">From previous</th>
                <th scope="col" className="pr-2">Predicted</th>
                <th scope="col">Recorded by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {stops.map((s) => (
                <tr key={s.order}>
                  <th scope="row" className="py-1.5 pr-2 font-semibold">{s.order + 1}. {s.name}</th>
                  <td className="pr-2">{s.scheduledAt ? campusTime(s.scheduledAt, tz) : '—'}{s.delayMinutes != null && <span className="block muted">{delayText(s.delayMinutes)}</span>}</td>
                  <td className="pr-2">{s.actualArrivalAt ? campusTime(s.actualArrivalAt, tz) : <span className="muted">{s.notRecorded === 'before_tracking' ? 'before tracking' : s.notRecorded === 'pending' ? '—' : 'not detected'}</span>}</td>
                  <td className="pr-2">{s.actualDepartureAt ? campusTime(s.actualDepartureAt, tz) : '—'}{s.dwellMinutes != null && <span className="block muted">stopped {s.dwellMinutes} min</span>}</td>
                  <td className="pr-2">{mins(s.minutesFromPreviousStop)}</td>
                  <td className="pr-2">{s.predictedArrivalAt ? campusTime(s.predictedArrivalAt, tz) : '—'}{s.predictionErrorMinutes != null && <span className="block muted">{s.predictionErrorMinutes > 0 ? `${s.predictionErrorMinutes} min later` : `${-s.predictionErrorMinutes} min earlier`}</span>}</td>
                  <td>
                    {[s.arrival, s.departure].filter(Boolean).map((e) => (
                      <span key={e._id} className="block">
                        {SOURCE_LABEL[e.source]}
                        {e.gps?.accuracyM != null ? ` ±${Math.round(e.gps.accuracyM)} m` : ''}
                        {e.corrected ? ' · corrected' : ''}
                        {e.reason ? ` — ${e.reason}` : ''}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {events.length > 0 && (
        <ul className="text-[11px] muted">
          {events.map((e) => (
            <li key={e._id}>{e.type === 'trip_started' ? 'Trip started' : `Trip ended (${e.endStatus || 'ended'})`} · {campusDateTime(e.at, tz)}</li>
          ))}
        </ul>
      )}
      {canRecord && trip.hasJourney && (recording ? <RecordForm trip={trip} stops={stops} tz={tz} onDone={() => setRecording(false)} /> : (
        <Button size="sm" variant="soft" icon={PenLine} onClick={() => setRecording(true)}>Record or correct a stop time</Button>
      ))}
    </Card>
  );
}

/** Managers: record a missing arrival / departure or correct one. Reason required; audited by the server. */
function RecordForm({ trip, stops, tz, onDone }) {
  const [record, { isLoading }] = useRecordStopEventMutation();
  const [form, setForm] = useState({ order: '', type: 'arrival', at: '', reason: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((cur) => ({ ...cur, [k]: e.target.value }));
  const existing = form.order !== '' ? stops[Number(form.order)]?.[form.type === 'arrival' ? 'actualArrivalAt' : 'actualDepartureAt'] : null;
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await record({ id: trip._id, order: Number(form.order), type: form.type, at: campusLocalToIso(form.at, tz), reason: form.reason.trim() }).unwrap();
      onDone();
    } catch (ex) {
      setErr(errMsg(ex));
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded-2xl border border-white/20 p-3">
      <p className="text-sm font-bold">Record or correct a stop time</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Select label="Stop" keepCase placeholder="Choose" required options={stops.map((s) => ({ value: String(s.order), label: `${s.order + 1}. ${s.name}` }))} value={form.order} onChange={set('order')} />
        <Select label="Event" keepCase options={[{ value: 'arrival', label: 'Arrival' }, { value: 'departure', label: 'Departure' }]} value={form.type} onChange={set('type')} />
        <Input label={`Time (${tz || 'campus time'})`} type="datetime-local" required value={form.at} onChange={set('at')} />
      </div>
      {existing && <p className="text-xs text-amber-700 dark:text-amber-300">This replaces the recorded time {campusTime(existing, tz)}; the original is kept with the correction.</p>}
      <Input label="Reason" required minLength={3} maxLength={300} placeholder="e.g. GPS lost near the stop; confirmed by the driver" value={form.reason} onChange={set('reason')} />
      {err && <p role="alert" className="text-xs text-rose-600">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={isLoading} disabled={form.order === '' || !form.at || form.reason.trim().length < 3}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function Figure({ label, f, unit = 'min' }) {
  return (
    <div className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
      <p className="text-xs muted">{label}</p>
      {f?.sufficient ? (
        <>
          <p className="text-lg font-extrabold">{f.averageMinutes} {unit}</p>
          <p className="text-[11px] muted">average · median {f.medianMinutes} {unit} · {f.samples} trips</p>
        </>
      ) : (
        <p className="text-sm muted">Not enough recorded trips yet ({f?.samples ?? 0})</p>
      )}
    </div>
  );
}

function ReportView({ report, loading, error }) {
  if (loading && !report) return <Card><Skeleton className="h-48" /></Card>;
  if (error) return <Card><ErrorState error={error} /></Card>;
  if (!report) return null;
  return (
    <Card className="space-y-4" aria-label="Journey report">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5" />
        <p className="font-bold">Measured from recorded trips</p>
      </div>
      <p className="text-xs muted">
        {report.trips.total} trips · {report.trips.completed} completed · {report.trips.interrupted} interrupted. Figures need at least {report.minSamples} recorded trips; nothing here is estimated.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Figure label="Journey time (first departure → final stop)" f={report.journeyDuration} />
        <div className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
          <p className="text-xs muted">Punctuality against the timetable</p>
          {!report.punctuality ? (
            <p className="text-sm muted">No timetable times on these stops — punctuality is not measured.</p>
          ) : report.punctuality.sufficient ? (
            <>
              <p className="text-lg font-extrabold">{report.punctuality.onTimePercent}% on time</p>
              <p className="text-[11px] muted">within ±{report.punctuality.toleranceMinutes} min · average {delayText(report.punctuality.averageDelayMinutes)} · {report.punctuality.samples} arrivals</p>
            </>
          ) : (
            <p className="text-sm muted">Not enough timetabled arrivals yet ({report.punctuality.samples})</p>
          )}
        </div>
      </div>
      <div>
        <p className="label">Time between stops</p>
        {!report.segments.length ? (
          <p className="text-sm muted">No stop-to-stop times recorded in this period.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {report.segments.map((s) => (
              <li key={`${s.from}-${s.to}`} className="flex justify-between gap-2">
                <span>{s.from} → {s.to}</span>
                <span className="font-semibold">{s.sufficient ? `${s.averageMinutes} min (median ${s.medianMinutes})` : <span className="muted">{s.samples} trip{s.samples === 1 ? '' : 's'} — not enough</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
