import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  GraduationCap,
  Lock,
  Phone,
  Save,
  Search,
  Sparkles,
  UserCheck,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import {
  useGetAttendanceSummaryQuery,
  useGetFacultyRosterQuery,
  useGetSummaryFacultyQuery,
  useGetSummaryStudentsQuery,
  useMarkFacultyAttendanceMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  StatCard,
  cn,
} from '../../components/ui/primitives';
import { StatusBadge } from '../../components/insights';
import { DEPARTMENTS } from '../../utils/constants';
import { errMsg, fmtClassDay, todayKey } from '../../utils/format';

/** Date + (admin/principal only) department filter shared by both tabs. */
function Filters({ value, onChange, canPickDepartment }) {
  const isToday = value.date === todayKey();

  const setYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    onChange({ ...value, date: d.toISOString().slice(0, 10) });
  };

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-4 border border-white/10 shadow-sm backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary-500" />
          <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">Date:</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="ds-date"
            type="date"
            className="input w-auto py-1.5 px-3 text-sm rounded-xl font-medium"
            max={todayKey()}
            value={value.date}
            onChange={(e) => onChange({ ...value, date: e.target.value })}
          />
          <button
            type="button"
            onClick={() => onChange({ ...value, date: todayKey() })}
            className={cn(
              'rounded-xl px-2.5 py-1 text-xs font-bold transition-all',
              isToday
                ? 'bg-primary-500 text-white shadow-glow'
                : 'bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 text-ink-soft'
            )}
          >
            Today
          </button>
          <button
            type="button"
            onClick={setYesterday}
            className="rounded-xl bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 px-2.5 py-1 text-xs font-bold text-ink-soft transition-all"
          >
            Yesterday
          </button>
        </div>
      </div>

      {canPickDepartment && (
        <div className="flex items-center gap-2">
          <label htmlFor="ds-dept" className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            Dept:
          </label>
          <select
            id="ds-dept"
            className="input w-auto min-w-[200px] py-1.5 px-3 text-sm rounded-xl font-medium"
            value={value.department}
            onChange={(e) => onChange({ ...value, department: e.target.value })}
          >
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}
    </Card>
  );
}

const clean = (f) => ({ date: f.date, ...(f.department ? { department: f.department } : {}) });

const STATUS_CHIPS = [
  { value: '', label: 'All', icon: Sparkles },
  { value: 'present', label: 'Present', icon: CheckCircle2, color: 'text-emerald-700 dark:text-emerald-400' },
  { value: 'absent', label: 'Absent', icon: XCircle, color: 'text-rose-700 dark:text-rose-400' },
  { value: 'unmarked', label: 'Not marked', icon: Clock, color: 'text-amber-700 dark:text-amber-400' },
];

/* ── Today: counts + full student / faculty lists ─────────────────── */
export function DailySummary() {
  const me = useSelector(selectUser);
  const canPick = me.role !== 'hod';
  const [filters, setFilters] = useState({ date: todayKey(), department: '' });
  const [who, setWho] = useState('students');
  const [status, setStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const params = clean(filters);

  const { data: summary, isLoading, error } = useGetAttendanceSummaryQuery(params);
  const students = useGetSummaryStudentsQuery({ ...params, ...(status ? { status } : {}) }, { skip: who !== 'students' });
  const faculty = useGetSummaryFacultyQuery({ ...params, ...(status ? { status } : {}) }, { skip: who !== 'faculty' });
  const list = who === 'students' ? students : faculty;
  const rawRows = (who === 'students' ? students.data?.students : faculty.data?.faculty) || [];

  // Client-side quick filter for instant search responsiveness
  const rows = useMemo(() => {
    if (!searchQuery.trim()) return rawRows;
    const q = searchQuery.toLowerCase().trim();
    return rawRows.filter((r) => {
      const name = r.name?.toLowerCase() || '';
      const roll = (r.rollNo || r.employeeId || '').toLowerCase();
      const sec = (r.section || '').toLowerCase();
      const dept = (r.department || '').toLowerCase();
      return name.includes(q) || roll.includes(q) || sec.includes(q) || dept.includes(q);
    });
  }, [rawRows, searchQuery]);

  return (
    <div className="space-y-5 animate-fade-in">
      <Filters value={filters} onChange={setFilters} canPickDepartment={canPick} />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-3xl" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} />
      ) : summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={GraduationCap}
            label="Total Students"
            value={summary.students.total}
            hint={summary.department || 'All Departments'}
            gradient="from-violet-500 to-indigo-600"
          />
          <StatCard
            icon={CheckCircle2}
            label="Students Present"
            value={summary.students.present}
            hint={`${summary.students.percentage}% marked present`}
            gradient="from-emerald-400 to-teal-600"
          />
          <StatCard
            icon={XCircle}
            label="Students Absent"
            value={summary.students.absent}
            hint={`${summary.students.unmarked} not yet marked`}
            gradient="from-rose-500 to-pink-600"
          />
          <StatCard
            icon={UserCheck}
            label="Faculty Present"
            value={`${summary.faculty.present} / ${summary.faculty.total}`}
            hint={`${summary.faculty.absent} absent · ${summary.faculty.leave} leave`}
            gradient="from-sky-400 to-blue-600"
          />
        </div>
      ) : null}

      <Card className="p-0 overflow-hidden border border-white/10 shadow-lg backdrop-blur-md">
        {/* Controls Bar */}
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 md:flex-row md:items-center md:justify-between bg-white/[0.02]">
          <div className="flex flex-wrap items-center gap-3">
            {/* Students / Faculty Pill Toggle */}
            <div className="glass inline-flex rounded-2xl p-1 shadow-inner">
              {[
                { key: 'students', label: 'Students', icon: GraduationCap, count: summary?.students?.total },
                { key: 'faculty', label: 'Faculty', icon: Users, count: summary?.faculty?.total },
              ].map(({ key, label, icon: Icon, count }) => (
                <button
                  key={key}
                  onClick={() => {
                    setWho(key);
                    setStatus('');
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200',
                    who === key
                      ? 'bg-primary-500 text-white shadow-glow'
                      : 'text-ink-soft hover:text-ink hover:bg-black/5 dark:hover:bg-white/5'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                  {count !== undefined && (
                    <span className={cn('rounded-full px-1.5 py-0.2 text-[10px]', who === key ? 'bg-white/20 text-white' : 'bg-black/5 text-ink-soft dark:bg-white/10 dark:text-ink-soft')}>
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Status Filter Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                ...STATUS_CHIPS,
                ...(who === 'faculty' ? [{ value: 'leave', label: 'On Leave', icon: Clock, color: 'text-purple-700 dark:text-purple-400' }] : []),
              ].map((c) => {
                const Icon = c.icon;
                const active = status === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setStatus(c.value)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all',
                      active
                        ? 'bg-ink/10 text-ink font-bold ring-1 ring-ink/20 shadow-sm dark:bg-white/20 dark:text-white dark:ring-white/30'
                        : 'bg-black/5 text-ink-soft hover:bg-black/10 hover:text-ink dark:bg-white/5 dark:text-ink-soft dark:hover:bg-white/10 dark:hover:text-ink'
                    )}
                  >
                    <Icon className={cn('h-3.5 w-3.5', c.color || 'text-primary-600 dark:text-primary-400')} />
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Search */}
          <div className="relative min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted" />
            <input
              type="text"
              placeholder={`Search ${who}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-9 pr-3 py-1.5 text-xs rounded-xl w-full"
            />
          </div>
        </div>

        {/* Content Table / Empty States */}
        {list.isFetching && !list.data ? (
          <div className="p-6 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14 rounded-2xl" />
            ))}
          </div>
        ) : list.error ? (
          <div className="p-6">
            <ErrorState error={list.error} />
          </div>
        ) : !rows.length ? (
          <EmptyState
            icon={Users}
            title={searchQuery ? 'No results found' : 'Nobody in this view'}
            text={
              searchQuery
                ? `No ${who} matched "${searchQuery}". Try clearing search.`
                : 'No records match this status filter for the selected day.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02] text-left text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                  <th className="px-5 py-3">Member</th>
                  <th className="px-4 py-3">{who === 'students' ? 'Roll No' : 'Employee ID'}</th>
                  <th className="px-4 py-3">{who === 'students' ? 'Class / Section' : 'Department'}</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Status Today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((r) => {
                  const isPresent = r.status === 'present';
                  const isAbsent = r.status === 'absent';
                  const isLeave = r.status === 'leave';

                  return (
                    <tr
                      key={r._id}
                      className={cn(
                        'transition-colors hover:bg-white/[0.04]',
                        isPresent && 'border-l-4 border-l-emerald-500',
                        isAbsent && 'border-l-4 border-l-rose-500 bg-rose-500/[0.02]',
                        isLeave && 'border-l-4 border-l-amber-500',
                        !isPresent && !isAbsent && !isLeave && 'border-l-4 border-l-slate-500/30'
                      )}
                    >
                      {/* Name & Avatar */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <Avatar user={r} size="sm" />
                          <div className="min-w-0">
                            <p className="font-bold text-ink truncate">{r.name}</p>
                            <p className="text-[11px] text-ink-muted truncate">{r.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Roll / Emp ID */}
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-lg bg-white/5 border border-white/10">
                          {(who === 'students' ? r.rollNo : r.employeeId) || '—'}
                        </span>
                      </td>

                      {/* Section / Dept */}
                      <td className="px-4 py-3.5">
                        {who === 'students' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-lg bg-primary-500/10 px-2 py-0.5 text-xs font-bold text-primary-700 dark:text-primary-300">
                              {r.department}
                            </span>
                            {r.section && (
                              <span className="rounded-lg bg-black/5 dark:bg-white/10 px-2 py-0.5 text-xs font-bold">
                                Sec {r.section}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="rounded-lg bg-sky-500/10 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300">
                            {r.department || '—'}
                          </span>
                        )}
                      </td>

                      {/* Mobile phone */}
                      <td className="px-4 py-3.5">
                        {r.phone ? (
                          <a
                            href={`tel:${r.phone}`}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-soft hover:bg-primary-500/10 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                          >
                            <Phone className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
                            <span>{r.phone}</span>
                          </a>
                        ) : (
                          <span className="text-xs text-ink-muted">—</span>
                        )}
                        {who === 'students' && r.parentPhone && (
                          <p className="text-[11px] text-ink-muted mt-0.5 flex items-center gap-1">
                            <span className="text-[10px] uppercase font-bold text-ink-soft/70">Parent:</span> {r.parentPhone}
                          </p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-1 items-start">
                          {r.status === 'unmarked' ? (
                            <Badge color="neutral" icon={Clock}>
                              Not marked
                            </Badge>
                          ) : (
                            <StatusBadge status={r.status} />
                          )}
                          {who === 'students' && r.totalPeriods > 0 && (
                            <span className="text-[11px] font-medium text-ink-muted">
                              {r.presentPeriods} of {r.totalPeriods} periods attended
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-4 border-t border-white/10 bg-white/[0.01] flex items-center justify-between text-xs text-ink-muted">
          <span>
            Showing {rows.length} of {rawRows.length} {who}
          </span>
          {summary && (
            <span>
              Recorded for {fmtClassDay(summary.date, 'EEEE, dd MMMM yyyy')}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ── HOD / admin: mark faculty attendance ─────────────────────────── */
const FAC_STATES = [
  { value: 'present', label: 'Present', icon: Check, activeClass: 'bg-emerald-500 text-white shadow-glow' },
  { value: 'absent', label: 'Absent', icon: X, activeClass: 'bg-rose-500 text-white shadow-glow' },
  { value: 'leave', label: 'Leave', icon: Lock, activeClass: 'bg-amber-500 text-white shadow-glow' },
];

export function FacultyMarking() {
  const me = useSelector(selectUser);
  const [filters, setFilters] = useState({ date: todayKey(), department: '' });
  const [search, setSearch] = useState('');
  const { data, isFetching, error } = useGetFacultyRosterQuery(clean(filters), { refetchOnMountOrArgChange: true });
  const [marks, setMarks] = useState({});
  const [save, { isLoading: saving }] = useMarkFacultyAttendanceMutation();

  useEffect(() => {
    if (data) setMarks(Object.fromEntries(data.faculty.map((f) => [f._id, f.status || 'present'])));
  }, [data]);

  const submit = async () => {
    try {
      const res = await save({
        date: filters.date,
        records: Object.entries(marks).map(([faculty, status]) => ({ faculty, status })),
      }).unwrap();
      toast.success(res.message);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const counts = Object.values(marks).reduce((a, v) => ({ ...a, [v]: (a[v] || 0) + 1 }), {});

  const filteredFaculty = useMemo(() => {
    if (!data?.faculty) return [];
    if (!search.trim()) return data.faculty;
    const q = search.toLowerCase();
    return data.faculty.filter(
      (f) =>
        f.name?.toLowerCase().includes(q) ||
        f.employeeId?.toLowerCase().includes(q) ||
        f.designation?.toLowerCase().includes(q)
    );
  }, [data, search]);

  return (
    <div className="space-y-5 animate-fade-in">
      <Filters value={filters} onChange={setFilters} canPickDepartment={me.role === 'admin'} />

      {isFetching && !data ? (
        <Skeleton className="h-72 rounded-3xl" />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data?.faculty.length ? (
        <Card className="border border-white/10 shadow-lg">
          <EmptyState
            icon={UserCheck}
            title="No faculty to mark"
            text="Faculty members appear here once their accounts are set up under this department."
          />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden border border-white/10 shadow-lg backdrop-blur-md">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 p-5 bg-white/[0.02]">
            <div>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                <h3 className="text-base font-extrabold tracking-tight">
                  Faculty Attendance · {data.department || 'Department'}
                </h3>
              </div>
              <p className="text-xs text-ink-muted mt-0.5">
                {fmtClassDay(data.date, 'EEEE, dd MMMM yyyy')} · Tap any status to mark
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Quick search */}
              <div className="relative w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted" />
                <input
                  type="text"
                  placeholder="Filter faculty..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input pl-9 pr-3 py-1 text-xs rounded-xl w-full"
                />
              </div>

              <Button
                size="sm"
                variant="success"
                disabled={!data.editable}
                icon={Check}
                onClick={() => setMarks(Object.fromEntries(data.faculty.map((f) => [f._id, 'present'])))}
              >
                All Present
              </Button>
            </div>
          </div>

          {!data.editable && (
            <div className="m-4 flex items-center gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3.5 text-sm text-amber-700 dark:text-amber-300">
              <Lock className="h-4 w-4 shrink-0 text-amber-500" />
              <span>{data.lockedReason || 'This date is locked for editing.'}</span>
            </div>
          )}

          {/* List */}
          <div className="divide-y divide-white/5">
            {filteredFaculty.map((f) => {
              const currentStatus = marks[f._id] || 'present';
              return (
                <div
                  key={f._id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar user={f} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{f.name}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {[f.employeeId, f.designation || (f.role === 'hod' ? 'HOD' : null), f.department]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>

                  {/* Status Toggle Pills */}
                  <div
                    className="glass inline-flex rounded-xl p-1 shadow-inner"
                    role="radiogroup"
                    aria-label={`Attendance for ${f.name}`}
                  >
                    {FAC_STATES.map(({ value, label, icon: Icon, activeClass }) => {
                      const active = currentStatus === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={!data.editable}
                          onClick={() => setMarks((m) => ({ ...m, [f._id]: value }))}
                          className={cn(
                            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                            active ? activeClass : 'text-ink-soft hover:text-ink hover:bg-white/5',
                            !data.editable && 'cursor-not-allowed opacity-60'
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer action bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 p-4 bg-white/[0.02]">
            <div className="flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                {counts.present || 0} Present
              </span>
              <span className="text-ink-muted">·</span>
              <span className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-400">
                <span className="h-2 w-2 rounded-full bg-rose-500 inline-block" />
                {counts.absent || 0} Absent
              </span>
              <span className="text-ink-muted">·</span>
              <span className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-400">
                <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />
                {counts.leave || 0} On Leave
              </span>
              <span className="text-xs text-ink-muted">({data.faculty.length} total)</span>
            </div>

            <Button
              onClick={submit}
              loading={saving}
              disabled={!data.editable}
              icon={Save}
              className="shadow-glow"
            >
              Save Faculty Attendance
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
