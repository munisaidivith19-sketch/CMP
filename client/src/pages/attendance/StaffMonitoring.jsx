import { useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Download, LogOut, UserCheck, Users } from 'lucide-react';
import {
  useAssignCoverMutation,
  useCancelCoverMutation,
  useCancelEarlyExitMutation,
  useDecideEarlyExitMutation,
  useGetAvailableSubstitutesQuery,
  useGetCoverQuery,
  useGetEarlyExitsQuery,
  useGetLowMonitorQuery,
  useGetStaffReportQuery,
  useRecordDepartureMutation,
  useRequestEarlyExitMutation,
} from '../../services/api';
import { downloadCsv } from '../../services/reports';
import { selectUser } from '../../features/authSlice';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select, Textarea, TimeInput } from '../../components/ui/form';
import { ACADEMIC_YEARS, DEPARTMENTS, SECTIONS, YEAR_LABELS } from '../../utils/constants';
import { errMsg, todayKey } from '../../utils/format';

const to12h = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const STATUS_COLOR = { present: 'success', absent: 'danger', leave: 'warning', unmarked: 'neutral' };
const RANGES = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
];

function RangePicker({ value, onChange }) {
  return (
    <>
      <Select className="w-full sm:w-40" label="Period" keepCase options={RANGES} value={value.range} onChange={(e) => onChange({ ...value, range: e.target.value })} />
      {value.range === 'custom' && (
        <>
          <Input className="w-full sm:w-40" label="From" type="date" value={value.from} max={todayKey()} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <Input className="w-full sm:w-40" label="To" type="date" value={value.to} max={todayKey()} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </>
      )}
    </>
  );
}
const rangeParams = (r) => (r.range === 'custom' ? { range: 'custom', from: r.from || undefined, to: r.to || undefined } : { range: r.range });

async function exportCsv(path, params) {
  try {
    const name = await downloadCsv(path, params);
    toast.success(`Downloaded ${name}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}

/* ── Staff attendance report ───────────────────────────────────── */

/**
 * Daily presence and period-wise teaching side by side, never merged: a
 * faculty member can be Present for the day and still have periods covered by
 * a substitute or not conducted. HOD: own department (fixed by the server);
 * Principal / Office / college roles: any department or the whole college.
 */
export function StaffReport() {
  const me = useSelector(selectUser);
  const isHod = me.role === 'hod';
  const [range, setRange] = useState({ range: 'day', from: '', to: '' });
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const params = { ...rangeParams(range), department: isHod ? undefined : department || undefined, status: status || undefined, limit: 500 };
  const { data, isLoading, isFetching, error, refetch } = useGetStaffReportQuery(params, { skip: range.range === 'custom' && (!range.from || !range.to) });

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <RangePicker value={range} onChange={setRange} />
        {!isHod && (
          <Select className="w-full sm:w-48" label="Department" keepCase placeholder="All departments" options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} value={department} onChange={(e) => setDepartment(e.target.value)} />
        )}
        <Select
          className="w-full sm:w-36"
          label="Daily status"
          keepCase
          placeholder="Any"
          options={['present', 'absent', 'leave', 'unmarked'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        />
        <Button variant="soft" icon={Download} onClick={() => exportCsv('/attendance/staff-report', { ...params, limit: undefined })}>
          Export CSV
        </Button>
      </Card>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.rows?.length ? (
        <Card>
          <EmptyState icon={Users} title="No staff records" text="No staff match these filters for the chosen period." />
        </Card>
      ) : (
        <div className={cn('space-y-4', isFetching && 'opacity-70')}>
          {!isHod && data.departments.length > 1 && (
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-left text-xs">
                <caption className="px-4 pt-3 text-left text-sm font-bold">Department comparison</caption>
                <thead className="text-ink-muted">
                  <tr>{['Department', 'Staff', 'Present', 'Absent', 'Leave', 'Unmarked', 'Periods scheduled', 'Taken', 'Not submitted'].map((h) => <th key={h} className="px-4 py-2 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.departments.map((d) => (
                    <tr key={d.department} className="border-t border-white/10">
                      <td className="px-4 py-2 font-semibold">{d.department}</td>
                      <td className="px-4 py-2">{d.staff}</td>
                      <td className="px-4 py-2">{d.present}</td>
                      <td className="px-4 py-2">{d.absent}</td>
                      <td className="px-4 py-2">{d.leave}</td>
                      <td className="px-4 py-2">{d.unmarked}</td>
                      <td className="px-4 py-2">{d.scheduled}</td>
                      <td className="px-4 py-2">{d.taken}</td>
                      <td className={cn('px-4 py-2', d.notSubmitted && 'font-bold text-rose-600 dark:text-rose-400')}>{d.notSubmitted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[900px] text-left text-xs">
              <caption className="px-4 pt-3 text-left text-sm font-bold">
                {data.range.from === data.range.to ? data.range.from : `${data.range.from} → ${data.range.to}`} · daily presence and period-wise teaching
              </caption>
              <thead className="text-ink-muted">
                <tr>{['Date', 'Staff', 'Department', 'Daily', 'Scheduled', 'Taken', 'Substitute covered', 'Not conducted', 'Pending', 'Not submitted', 'As substitute', 'Early exit'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.staffId}-${r.date}`} className="border-t border-white/10">
                    <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-2 font-semibold">{r.name}<span className="block text-[10px] font-normal text-ink-muted">{r.employeeId}</span></td>
                    <td className="px-3 py-2">{r.department}</td>
                    <td className="px-3 py-2"><Badge color={STATUS_COLOR[r.dailyStatus]}>{r.dailyStatus}{r.dailySource === 'auto' ? ' · auto' : ''}</Badge></td>
                    <td className="px-3 py-2">{r.scheduled}</td>
                    <td className="px-3 py-2">{r.taken}</td>
                    <td className="px-3 py-2">{r.covered}</td>
                    <td className="px-3 py-2">{r.notConducted}</td>
                    <td className="px-3 py-2">{r.pending}</td>
                    <td className={cn('px-3 py-2', r.notSubmitted && 'font-bold text-rose-600 dark:text-rose-400')}>{r.notSubmitted}</td>
                    <td className="px-3 py-2">{r.substituteTaken}</td>
                    <td className="px-3 py-2">{r.earlyExit ? `${r.earlyExit.status} · ${to12h(r.earlyExit.departureTime)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {data.pagination.total > data.rows.length && <p className="text-center text-xs muted">Showing {data.rows.length} of {data.pagination.total} rows — export the CSV for all of them.</p>}
        </div>
      )}
    </div>
  );
}

/* ── Low-attendance monitor ────────────────────────────────────── */

/**
 * Students below the threshold, overall and per subject: attended ÷ held over
 * the periods actually conducted. HOD: own department (server-enforced);
 * Office / Principal / college roles: the college.
 */
export function LowAttendanceMonitor() {
  const me = useSelector(selectUser);
  const isHod = me.role === 'hod';
  const [f, setF] = useState({ department: '', year: '', section: '', semester: '', range: 'semester', from: '', to: '', all: false });
  const [page, setPage] = useState(1);
  const params = {
    ...rangeParams(f),
    department: isHod ? undefined : f.department || undefined,
    year: f.year || undefined,
    section: f.section || undefined,
    semester: f.semester || undefined,
    all: f.all ? 'true' : undefined,
    page,
    limit: 50,
  };
  const { data, isLoading, isFetching, error, refetch } = useGetLowMonitorQuery(params);
  const set = (patch) => {
    setPage(1);
    setF((x) => ({ ...x, ...patch }));
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {!isHod && <Select className="w-full sm:w-44" label="Department" keepCase placeholder="All" options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} value={f.department} onChange={(e) => set({ department: e.target.value })} />}
        <Select className="w-full sm:w-32" label="Year" keepCase placeholder="All" options={ACADEMIC_YEARS.map((y) => ({ value: String(y), label: YEAR_LABELS[y] }))} value={f.year} onChange={(e) => set({ year: e.target.value })} />
        <Select className="w-full sm:w-28" label="Section" keepCase placeholder="All" options={SECTIONS.map((s) => ({ value: s, label: s }))} value={f.section} onChange={(e) => set({ section: e.target.value })} />
        <Select className="w-full sm:w-28" label="Semester" keepCase placeholder="All" options={[1, 2, 3, 4, 5, 6, 7, 8].map((s) => ({ value: String(s), label: `Sem ${s}` }))} value={f.semester} onChange={(e) => set({ semester: e.target.value })} />
        <Select
          className="w-full sm:w-40"
          label="Calculated over"
          keepCase
          options={[{ value: 'semester', label: 'This semester' }, { value: 'month', label: 'Last 30 days' }, { value: 'all', label: 'All records' }, { value: 'custom', label: 'Custom range' }]}
          value={f.range}
          onChange={(e) => set({ range: e.target.value })}
        />
        {f.range === 'custom' && (
          <>
            <Input className="w-full sm:w-40" label="From" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
            <Input className="w-full sm:w-40" label="To" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
          </>
        )}
        <label className="flex items-center gap-2 text-sm font-semibold sm:pb-2.5">
          <input type="checkbox" checked={f.all} onChange={(e) => set({ all: e.target.checked })} /> Show every student
        </label>
        <Button variant="soft" icon={Download} onClick={() => exportCsv('/attendance/low-monitor', { ...params, page: undefined, limit: undefined })}>
          Export CSV
        </Button>
      </Card>
      <p className="text-xs muted">
        Percentage = periods attended ÷ periods held. Periods not conducted (or never held) are not counted. Below {data?.threshold ?? 75}% is highlighted.
      </p>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.students?.length ? (
        <Card>
          <EmptyState icon={UserCheck} title="No students below the threshold" text="Nobody in this selection is below the attendance requirement." />
        </Card>
      ) : (
        <Card className={cn('overflow-x-auto p-0', isFetching && 'opacity-70')}>
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="text-ink-muted">
              <tr>{['Roll No', 'Student', 'Class', 'Overall', 'Attended / held', 'Subject-wise', 'Last updated'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s._id} className="border-t border-white/10 align-top">
                  <td className="px-3 py-2 font-mono">{s.rollNo || '—'}</td>
                  <td className="px-3 py-2 font-semibold">{s.name}</td>
                  <td className="px-3 py-2">{s.department} · Y{s.year}{s.section ? ` · ${s.section}` : ''}</td>
                  <td className={cn('px-3 py-2 font-bold', s.below ? 'text-rose-600 dark:text-rose-400' : '')}>{s.percentage == null ? 'No classes held' : `${s.percentage}%`}</td>
                  <td className="px-3 py-2">{s.attended} / {s.held}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {s.subjects.map((x) => (
                        <Badge key={x.subjectId} color={x.below ? 'danger' : 'neutral'}>
                          {x.code} {x.percentage}%
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{s.lastUpdated ? new Date(s.lastUpdated).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.pagination.pages > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-2 text-xs">
              <span className="muted">Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} students</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="ghost" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* ── Cover & early exits (HOD / Principal / Admin) ─────────────── */

export function CoverManager() {
  const [date, setDate] = useState(todayKey());
  const { data, isLoading, error, refetch } = useGetCoverQuery({ date });
  const { data: exits = [] } = useGetEarlyExitsQuery({ date });
  const [assigning, setAssigning] = useState(null);
  const [cancelCover] = useCancelCoverMutation();
  const [decide] = useDecideEarlyExitMutation();
  const [depart] = useRecordDepartureMutation();
  const run = async (fn, ok) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input className="w-full sm:w-44" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <p className="text-xs muted sm:pb-2.5">
          Periods of staff marked absent / on leave or leaving early. Assign a free substitute, or record the class as not conducted. Students are never marked present because a teacher is away.
        </p>
      </Card>

      {exits.length > 0 && (
        <Card>
          <h4 className="mb-2 text-sm font-bold">Early exits</h4>
          <ul className="divide-y divide-white/10 text-sm">
            {exits.map((x) => (
              <li key={x._id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="flex-1 min-w-[12rem]">
                  <strong>{x.faculty?.name}</strong> · from {to12h(x.departureTime)} · {x.reason}
                  <span className="block text-xs muted">{x.affectedPeriods.length} period(s) affected{x.actualDepartureAt ? ` · left ${new Date(x.actualDepartureAt).toLocaleTimeString()}` : ''}</span>
                </span>
                <Badge color={x.status === 'approved' ? 'success' : x.status === 'pending' ? 'warning' : 'neutral'}>{x.status}</Badge>
                {x.status === 'pending' && (
                  <>
                    <Button size="sm" onClick={() => run(() => decide({ id: x._id, action: 'approve' }).unwrap(), 'Early exit approved')}>Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => run(() => decide({ id: x._id, action: 'reject' }).unwrap(), 'Early exit rejected')}>Reject</Button>
                  </>
                )}
                {x.status === 'approved' && !x.actualDepartureAt && (
                  <Button size="sm" variant="ghost" icon={LogOut} onClick={() => run(() => depart(x._id).unwrap(), 'Departure recorded')}>Record departure</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.periods?.length ? (
        <Card>
          <EmptyState icon={UserCheck} title="Nothing needs cover" text="No absent or leaving staff with periods on this date." />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-white/10">
            {data.periods.map((p) => (
              <li key={p.slotId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
                <span className="w-24 shrink-0 font-bold text-primary-500">P{p.period} · {to12h(p.startTime)}</span>
                <span className="min-w-[14rem] flex-1">
                  <strong>{p.subject?.code}</strong> · {p.department} Y{p.year}{p.section ? ` · ${p.section}` : ''}{p.room ? ` · ${p.room}` : ''}
                  <span className="block text-xs muted">{p.faculty?.name}{p.reason ? ` · ${p.reason.replace('_', ' ')}` : ''}</span>
                </span>
                {p.attendanceTakenBy ? (
                  <Badge color="success">Taken by {p.attendanceTakenBy.name}</Badge>
                ) : p.cover ? (
                  <>
                    <Badge color={p.cover.kind === 'substitute' ? 'info' : 'warning'}>
                      {p.cover.kind === 'substitute' ? `Substitute: ${p.cover.substitute?.name}` : p.cover.kind === 'not_conducted' ? 'Not conducted' : 'Pending verification'}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => run(() => cancelCover({ id: p.cover._id }).unwrap(), 'Arrangement cancelled')}>Cancel</Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => setAssigning(p)}>Arrange</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {assigning && <AssignCoverModal period={assigning} date={date} onClose={() => setAssigning(null)} />}
    </div>
  );
}

function AssignCoverModal({ period, date, onClose }) {
  const { data, isLoading } = useGetAvailableSubstitutesQuery({ slotId: period.slotId, date });
  const [assign, { isLoading: saving }] = useAssignCoverMutation();
  const [kind, setKind] = useState('substitute');
  const [substitute, setSubstitute] = useState('');
  const [reason, setReason] = useState('');
  const submit = async () => {
    try {
      await assign({ slotId: period.slotId, date, kind, substitute: kind === 'substitute' ? substitute : undefined, reason: reason || undefined }).unwrap();
      toast.success(kind === 'substitute' ? 'Substitute assigned — they have been notified' : 'Recorded');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Arrange P${period.period} · ${period.subject?.code}`}
      subtitle={`${period.department} Year ${period.year}${period.section ? ` Sec ${period.section}` : ''} · ${to12h(period.startTime)}–${to12h(period.endTime)} · ${date}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button loading={saving} disabled={kind === 'substitute' && !substitute} onClick={submit}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="What happens to this class"
          keepCase
          options={[{ value: 'substitute', label: 'A substitute takes it' }, { value: 'not_conducted', label: 'Class not conducted' }, { value: 'pending_verification', label: 'Pending verification' }]}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        />
        {kind === 'substitute' && (
          <Select
            label="Free faculty at this time"
            keepCase
            placeholder={isLoading ? 'Loading…' : data?.faculty?.length ? 'Choose a substitute' : 'Nobody is free at this time'}
            options={(data?.faculty || []).map((f) => ({ value: f._id, label: `${f.name} — ${f.department}` }))}
            value={substitute}
            onChange={(e) => setSubstitute(e.target.value)}
            hint="Only staff with no class, cover or absence at this time are listed."
          />
        )}
        <Textarea label="Note (optional)" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

/* ── Faculty: request an emergency early exit ──────────────────── */

export function EarlyExitButton() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const now = new Date();
  const [time, setTime] = useState(`${String(now.getHours()).padStart(2, '0')}:${String(Math.floor(now.getMinutes() / 5) * 5).padStart(2, '0')}`);
  const { data: mine = [] } = useGetEarlyExitsQuery({ date: todayKey() });
  const [request, { isLoading }] = useRequestEarlyExitMutation();
  const [cancel] = useCancelEarlyExitMutation();
  const open_ = mine.find((x) => ['pending', 'approved'].includes(x.status));
  const submit = async () => {
    try {
      await request({ reason, departureTime: time }).unwrap();
      toast.success('Request sent to your HOD');
      setOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <>
      {open_ ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          <LogOut className="h-4 w-4" />
          <span className="flex-1">Early exit from {to12h(open_.departureTime)} — {open_.status}{open_.status === 'approved' ? '. Your HOD arranges your remaining periods.' : '.'}</span>
          {open_.status === 'pending' && (
            <Button size="sm" variant="ghost" onClick={() => cancel(open_._id).unwrap().then(() => toast.success('Request withdrawn')).catch((e) => toast.error(errMsg(e)))}>Withdraw</Button>
          )}
        </div>
      ) : (
        <Button variant="outline" size="sm" icon={LogOut} onClick={() => setOpen(true)}>Emergency early exit</Button>
      )}
      {open && (
        <Modal
          open
          size="sm"
          onClose={() => setOpen(false)}
          title="Emergency early exit"
          subtitle="Your attendance for today stays as it is. Your HOD is notified and arranges your remaining periods."
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
              <Button loading={isLoading} disabled={reason.trim().length < 5} onClick={submit}>Send request</Button>
            </>
          }
        >
          <div className="space-y-3">
            <TimeInput label="Leaving at" value={time} onChange={setTime} />
            <Textarea label="Reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Modal>
      )}
    </>
  );
}
