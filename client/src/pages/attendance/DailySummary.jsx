import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Check, Lock, Phone, Save, UserCheck, Users, X } from 'lucide-react';
import {
  useGetAttendanceSummaryQuery,
  useGetFacultyRosterQuery,
  useGetSummaryFacultyQuery,
  useGetSummaryStudentsQuery,
  useMarkFacultyAttendanceMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { MiniStat, StatusBadge } from '../../components/insights';
import { DEPARTMENTS } from '../../utils/constants';
import { errMsg, fmtClassDay, todayKey } from '../../utils/format';

/** Date + (admin/principal only) department filter shared by both tabs. */
function Filters({ value, onChange, canPickDepartment }) {
  return (
    <Card className="grid gap-3 sm:grid-cols-3">
      <div>
        <label className="label" htmlFor="ds-date">Date</label>
        <input id="ds-date" type="date" className="input" max={todayKey()} value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
      </div>
      {canPickDepartment && (
        <div>
          <label className="label" htmlFor="ds-dept">Department</label>
          <select id="ds-dept" className="input" value={value.department} onChange={(e) => onChange({ ...value, department: e.target.value })}>
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
      )}
    </Card>
  );
}

const clean = (f) => ({ date: f.date, ...(f.department ? { department: f.department } : {}) });

const STATUS_CHIPS = [
  { value: '', label: 'All' },
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'unmarked', label: 'Not marked' },
];

/* ── Today: counts + full student / faculty lists ─────────────────── */
export function DailySummary() {
  const me = useSelector(selectUser);
  const canPick = me.role !== 'hod';
  const [filters, setFilters] = useState({ date: todayKey(), department: '' });
  const [who, setWho] = useState('students');
  const [status, setStatus] = useState('');
  const params = clean(filters);

  const { data: summary, isLoading, error } = useGetAttendanceSummaryQuery(params);
  const students = useGetSummaryStudentsQuery({ ...params, ...(status ? { status } : {}) }, { skip: who !== 'students' });
  const faculty = useGetSummaryFacultyQuery({ ...params, ...(status ? { status } : {}) }, { skip: who !== 'faculty' });
  const list = who === 'students' ? students : faculty;
  const rows = (who === 'students' ? students.data?.students : faculty.data?.faculty) || [];

  return (
    <div className="space-y-5">
      <Filters value={filters} onChange={setFilters} canPickDepartment={canPick} />

      {isLoading ? (
        <Skeleton className="h-28" />
      ) : error ? (
        <ErrorState error={error} />
      ) : summary ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniStat label="Students" value={summary.students.total} hint={summary.department} />
          <MiniStat label="Students present" value={summary.students.present} hint={`${summary.students.percentage}% of marked`} />
          <MiniStat label="Students absent" value={summary.students.absent} hint={`${summary.students.unmarked} not marked`} />
          <MiniStat
            label="Faculty present"
            value={`${summary.faculty.present}/${summary.faculty.total}`}
            hint={`${summary.faculty.absent} absent · ${summary.faculty.leave} on leave`}
          />
        </div>
      ) : null}

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/60 p-4 dark:border-white/10">
          <div className="glass inline-flex rounded-xl p-0.5">
            {['students', 'faculty'].map((w) => (
              <button
                key={w}
                onClick={() => setWho(w)}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-bold capitalize', who === w ? 'bg-primary-500 text-white' : 'text-ink-soft hover:text-ink')}
              >
                {w}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {[...STATUS_CHIPS, ...(who === 'faculty' ? [{ value: 'leave', label: 'Leave' }] : [])].map((c) => (
              <button key={c.value} onClick={() => setStatus(c.value)} className={cn('chip', status === c.value && 'chip-active')}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {list.isFetching && !list.data ? (
          <Skeleton className="m-4 h-40" />
        ) : list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} />
          </div>
        ) : !rows.length ? (
          <EmptyState icon={Users} title="Nobody here" text="No one matches this filter for the selected day." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide muted">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">{who === 'students' ? 'Roll no' : 'Employee ID'}</th>
                  <th className="px-4 py-2">{who === 'students' ? 'Section' : 'Department'}</th>
                  <th className="px-4 py-2">Mobile</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/60 dark:divide-white/5">
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Avatar user={r} size="xs" />
                        <span className="font-semibold">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2">{(who === 'students' ? r.rollNo : r.employeeId) || '—'}</td>
                    <td className="px-4 py-2">{(who === 'students' ? [r.department, r.section].filter(Boolean).join(' · ') : r.department) || '—'}</td>
                    <td className="px-4 py-2">
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:text-primary-600">
                          <Phone className="h-3.5 w-3.5" /> {r.phone}
                        </a>
                      ) : (
                        '—'
                      )}
                      {who === 'students' && r.parentPhone && <p className="text-[11px] muted">Parent: {r.parentPhone}</p>}
                    </td>
                    <td className="px-4 py-2">
                      {r.status === 'unmarked' ? <Badge color="neutral">Not marked</Badge> : <StatusBadge status={r.status} />}
                      {who === 'students' && r.totalPeriods > 0 && (
                        <span className="ml-1.5 text-[11px] muted">
                          {r.presentPeriods}/{r.totalPeriods} periods
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {summary && <p className="text-xs muted">Showing {fmtClassDay(summary.date, 'EEEE, dd MMM yyyy')}. A student counts as present if they attended at least one period that day.</p>}
    </div>
  );
}

/* ── HOD / admin: mark faculty attendance ─────────────────────────── */
const FAC_STATES = [
  { value: 'present', icon: Check, on: 'bg-emerald-500 text-white' },
  { value: 'absent', icon: X, on: 'bg-rose-500 text-white' },
  { value: 'leave', icon: Lock, on: 'bg-amber-500 text-white' },
];

export function FacultyMarking() {
  const me = useSelector(selectUser);
  const [filters, setFilters] = useState({ date: todayKey(), department: '' });
  const { data, isFetching, error } = useGetFacultyRosterQuery(clean(filters), { refetchOnMountOrArgChange: true });
  const [marks, setMarks] = useState({});
  const [save, { isLoading: saving }] = useMarkFacultyAttendanceMutation();

  useEffect(() => {
    if (data) setMarks(Object.fromEntries(data.faculty.map((f) => [f._id, f.status || 'present'])));
  }, [data]);

  const submit = async () => {
    try {
      const res = await save({ date: filters.date, records: Object.entries(marks).map(([faculty, status]) => ({ faculty, status })) }).unwrap();
      toast.success(res.message);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const counts = Object.values(marks).reduce((a, v) => ({ ...a, [v]: (a[v] || 0) + 1 }), {});

  return (
    <div className="space-y-5">
      <Filters value={filters} onChange={setFilters} canPickDepartment={me.role === 'admin'} />
      {isFetching && !data ? (
        <Skeleton className="h-64" />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data?.faculty.length ? (
        <Card>
          <EmptyState icon={UserCheck} title="No faculty to mark" text="Faculty appear here once an admin creates their logins in this department." />
        </Card>
      ) : (
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-white/60 p-4 dark:border-white/10">
            <div className="min-w-0 flex-1">
              <p className="font-bold">Faculty · {data.department}</p>
              <p className="text-xs muted">{fmtClassDay(data.date, 'EEEE, dd MMM yyyy')}</p>
            </div>
            <Button size="sm" variant="success" disabled={!data.editable} onClick={() => setMarks(Object.fromEntries(data.faculty.map((f) => [f._id, 'present'])))}>
              All present
            </Button>
          </div>
          {!data.editable && (
            <div className="m-4 flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-700">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              {data.lockedReason}
            </div>
          )}
          <ul className="divide-y divide-white/60 dark:divide-white/5">
            {data.faculty.map((f) => (
              <li key={f._id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar user={f} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{f.name}</p>
                  <p className="truncate text-xs muted">
                    {[f.employeeId, f.designation || (f.role === 'hod' ? 'HOD' : null), f.department].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="glass inline-flex rounded-xl p-0.5" role="radiogroup" aria-label={`Attendance for ${f.name}`}>
                  {FAC_STATES.map(({ value, icon: Icon, on }) => (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={marks[f._id] === value}
                      disabled={!data.editable}
                      onClick={() => setMarks((m) => ({ ...m, [f._id]: value }))}
                      className={cn(
                        'flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition-all',
                        marks[f._id] === value ? on : 'text-ink-soft hover:text-ink'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{value}</span>
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-white/60 p-4 dark:border-white/10">
            <p className="flex-1 text-sm muted">
              {counts.present || 0} present · {counts.absent || 0} absent · {counts.leave || 0} on leave
            </p>
            <Button onClick={submit} loading={saving} disabled={!data.editable}>
              <Save className="h-4 w-4" /> Save
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
