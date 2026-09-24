import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { AlertTriangle, CalendarCheck2, Check, ClipboardCheck, ClipboardList, Lock, Save, Users, X } from 'lucide-react';
import {
  useGetAttendanceSessionsQuery,
  useGetCorrectionsQuery,
  useGetLowAttendanceQuery,
  useGetRosterQuery,
  useGetStudentAttendanceQuery,
  useGetSubjectAttendanceQuery,
  useGetSubjectsQuery,
  useGetTimetableQuery,
  useMarkClassAttendanceMutation,
  useReviewCorrectionMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { MiniStat, PercentBadge, PercentBars, RangeFilter, StatusBadge, rangeParams } from '../../components/insights';
import { errMsg, fmtClassDay, fmtDateTime, todayKey } from '../../utils/format';

const todayName = () => ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];

/* ── Mark attendance ────────────────────────────────────────────── */
function MarkAttendance({ preset, onPresetUsed }) {
  const me = useSelector(selectUser);
  const { data: subjects = [], isLoading: loadingSubjects } = useGetSubjectsQuery(me.role === 'faculty' ? { mine: 'true' } : undefined);
  const { data: tt } = useGetTimetableQuery(undefined, { skip: me.role !== 'faculty' });
  const [form, setForm] = useState({ subjectId: '', section: '', date: todayKey(), period: '' });
  const [marks, setMarks] = useState({});
  const [save, { isLoading: saving }] = useMarkClassAttendanceMutation();

  useEffect(() => {
    if (preset) {
      setForm(preset);
      onPresetUsed();
    }
  }, [preset, onPresetUsed]);

  const subject = subjects.find((s) => s._id === form.subjectId);
  const ready = form.subjectId && form.date && form.period && (!subject?.sections?.length || form.section);
  const { data: roster, isFetching, error } = useGetRosterQuery(
    { subjectId: form.subjectId, date: form.date, period: form.period, section: form.section || undefined },
    { skip: !ready, refetchOnMountOrArgChange: true }
  );

  // Start from what is saved; unmarked students default to present.
  useEffect(() => {
    if (roster) setMarks(Object.fromEntries(roster.students.map((s) => [s._id, s.status || 'present'])));
  }, [roster]);

  const todaysClasses = useMemo(
    () => (tt?.slots || []).filter((s) => !s.isBreak && s.dayOfWeek === todayName()).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [tt]
  );
  const counts = Object.values(marks).reduce((a, v) => ({ ...a, [v]: (a[v] || 0) + 1 }), {});
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    try {
      const res = await save({
        subjectId: form.subjectId,
        date: form.date,
        period: Number(form.period),
        section: form.section || undefined,
        records: Object.entries(marks).map(([student, status]) => ({ student, status })),
      }).unwrap();
      toast.success(`${res.message} · ${res.created} new, ${res.modified} changed`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-5">
      {todaysClasses.length > 0 && (
        <Card>
          <CardHeader title="Your classes today" subtitle="Pick one to load its roster" />
          <div className="flex flex-wrap gap-2">
            {todaysClasses.map((s) => (
              <button
                key={s._id}
                onClick={() => set({ subjectId: s.subject._id, section: s.section, period: String(s.period), date: todayKey() })}
                className={cn('chip', form.subjectId === s.subject._id && form.period === String(s.period) && 'chip-active')}
              >
                P{s.period} · {s.subject.code} · Sec {s.section} · {s.startTime}
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card className="grid gap-3 md:grid-cols-4">
        <div>
          <label className="label" htmlFor="m-subject">Subject</label>
          <select id="m-subject" className="input" value={form.subjectId} onChange={(e) => set({ subjectId: e.target.value, section: '' })} disabled={loadingSubjects}>
            <option value="">{loadingSubjects ? 'Loading…' : subjects.length ? 'Choose subject' : 'No subjects assigned'}</option>
            {subjects.map((s) => (
              <option key={s._id} value={s._id}>
                {s.code} · {s.name} (Sem {s.semester})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="m-section">Section</label>
          <select id="m-section" className="input" value={form.section} onChange={(e) => set({ section: e.target.value })} disabled={!subject?.sections?.length}>
            <option value="">{subject?.sections?.length ? 'Choose section' : 'All'}</option>
            {subject?.sections?.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="m-date">Date</label>
          <input id="m-date" type="date" className="input" max={todayKey()} value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="m-period">Period</label>
          <select id="m-period" className="input" value={form.period} onChange={(e) => set({ period: e.target.value })}>
            <option value="">Choose period</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((p) => (
              <option key={p} value={String(p)}>
                Period {p}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {!ready ? (
        <Card>
          <EmptyState icon={ClipboardList} title="Choose a class" text="Select the subject, section, date and period to load the class roster." />
        </Card>
      ) : isFetching && !roster ? (
        <Skeleton className="h-64" />
      ) : error ? (
        <ErrorState error={error} />
      ) : roster && !roster.students.length ? (
        <Card>
          <EmptyState icon={Users} title="No students in this class" text="Students appear once an admin assigns them to this department and section." />
        </Card>
      ) : roster ? (
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-white/60 p-4 dark:border-white/10">
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                {roster.subject.code} · {roster.subject.name}
                {roster.section ? ` · Section ${roster.section}` : ''}
              </p>
              <p className="text-xs muted">
                {fmtClassDay(roster.date, 'EEEE, dd MMM yyyy')} · Period {roster.period}
                {roster.slot ? ` · ${roster.slot.startTime}–${roster.slot.endTime}${roster.slot.room ? ` · ${roster.slot.room}` : ''}` : ' · not on the timetable'}
              </p>
            </div>
            {roster.alreadyMarked && <Badge color="info">Marked by {roster.markedBy?.name} · {fmtDateTime(roster.markedAt)}</Badge>}
            <div className="flex gap-2">
              <Button size="sm" variant="success" disabled={!roster.editable} onClick={() => setMarks(Object.fromEntries(roster.students.map((s) => [s._id, 'present'])))}>
                All present
              </Button>
              <Button size="sm" variant="danger" disabled={!roster.editable} onClick={() => setMarks(Object.fromEntries(roster.students.map((s) => [s._id, 'absent'])))}>
                All absent
              </Button>
            </div>
          </div>
          {!roster.editable && (
            <div className="m-4 flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-700">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              {roster.lockedReason}
            </div>
          )}
          <ul className="divide-y divide-white/60 dark:divide-white/5">
            {roster.students.map((s, i) => {
              const v = marks[s._id];
              return (
                <li key={s._id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-6 text-center text-xs font-bold muted">{i + 1}</span>
                  <Avatar user={s} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.name}</p>
                    <p className="text-xs muted">{s.rollNo || '—'}</p>
                  </div>
                  <div className="glass inline-flex rounded-xl p-0.5" role="radiogroup" aria-label={`Attendance for ${s.name}`}>
                    {['present', 'absent'].map((st) => (
                      <button
                        key={st}
                        role="radio"
                        aria-checked={v === st}
                        disabled={!roster.editable}
                        onClick={() => setMarks((m) => ({ ...m, [s._id]: st }))}
                        className={cn(
                          'flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition-all',
                          v === st ? (st === 'present' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white') : 'text-ink-soft hover:text-ink'
                        )}
                      >
                        {st === 'present' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                        <span className="hidden sm:inline">{st}</span>
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-white/60 p-4 dark:border-white/10">
            <p className="flex-1 text-sm">
              <span className="font-bold text-emerald-600">{counts.present || 0} present</span> ·{' '}
              <span className="font-bold text-rose-600">{counts.absent || 0} absent</span> of {roster.students.length}
            </p>
            <Button icon={Save} loading={saving} disabled={!roster.editable} onClick={submit}>
              {roster.alreadyMarked ? 'Save changes' : 'Submit attendance'}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/* ── Sessions history ───────────────────────────────────────────── */
function Sessions({ onOpen }) {
  const [range, setRange] = useState({ range: 'month' });
  const { data, isLoading, error, refetch } = useGetAttendanceSessionsQuery(rangeParams(range));
  return (
    <Card>
      <CardHeader title="Classes marked" subtitle="Open one to review or edit it" action={<RangeFilter value={range} onChange={setRange} />} />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.length ? (
        <EmptyState icon={CalendarCheck2} title="No classes marked in this period" />
      ) : (
        <ul className="divide-y divide-white/60 dark:divide-white/5">
          {data.map((s) => (
            <li key={`${s.subject._id}-${s.date}-${s.period}-${s.section}`}>
              <button
                onClick={() => onOpen({ subjectId: s.subject._id, section: s.section || '', date: String(s.date).slice(0, 10), period: String(s.period) })}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-white/60 dark:hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {s.subject.code} · {s.subject.name}
                    {s.section ? ` · Sec ${s.section}` : ''}
                  </p>
                  <p className="text-xs muted">
                    {fmtClassDay(s.date, 'EEE, dd MMM')} · P{s.period} · {s.present}/{s.total} present
                    {s.edits ? ` · ${s.edits} edit${s.edits > 1 ? 's' : ''}` : ''}
                  </p>
                </div>
                <PercentBadge value={s.percentage} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── Student detail (modal) ─────────────────────────────────────── */
function StudentModal({ id, onClose }) {
  const { data, isLoading, error } = useGetStudentAttendanceQuery({ id }, { skip: !id });
  return (
    <Modal open={Boolean(id)} onClose={onClose} title={data?.student?.name || 'Student'} subtitle={data ? `${data.student.rollNo || ''} · ${data.student.department || ''}${data.student.section ? ` · Sec ${data.student.section}` : ''}` : ''} size="lg">
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : error ? (
        <ErrorState error={error} />
      ) : data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Overall" value={`${data.overall.percentage}%`} />
            <MiniStat label="Present" value={data.overall.presentPeriods} />
            <MiniStat label="Conducted" value={data.overall.totalPeriods} />
          </div>
          <PercentBars threshold={data.threshold} rows={data.subjects.map((s) => ({ key: s._id, label: `${s.subject.code} · ${s.subject.name}`, value: s.percentage, sub: `${s.presentPeriods}/${s.totalPeriods}` }))} />
        </div>
      ) : null}
    </Modal>
  );
}

/* ── Low attendance ─────────────────────────────────────────────── */
function LowAttendance() {
  const [range, setRange] = useState({ range: 'semester' });
  const [section, setSection] = useState('');
  const [student, setStudent] = useState(null);
  const { data, isLoading, error, refetch } = useGetLowAttendanceQuery({ ...rangeParams(range), section: section || undefined });
  return (
    <Card>
      <CardHeader
        title="Students below the minimum"
        subtitle="Overall attendance across the classes you can see"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Section" className="input w-24 rounded-xl py-1.5 text-xs uppercase" placeholder="Section" maxLength={10} value={section} onChange={(e) => setSection(e.target.value.toUpperCase())} />
            <RangeFilter value={range} onChange={setRange} />
          </div>
        }
      />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.students.length ? (
        <EmptyState icon={Check} title={`Everyone is at or above ${data.threshold}% 🎉`} />
      ) : (
        <ul className="divide-y divide-white/60 dark:divide-white/5">
          {data.students.map((r) => (
            <li key={r._id}>
              <button onClick={() => setStudent(r._id)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-white/60 dark:hover:bg-white/5">
                <Avatar user={r.student} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.student.name}</p>
                  <p className="text-xs muted">
                    {r.student.rollNo || '—'} · {r.student.department}
                    {r.student.section ? ` · Sec ${r.student.section}` : ''} · {r.present}/{r.total} periods
                  </p>
                </div>
                <PercentBadge value={r.percentage} threshold={data.threshold} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <StudentModal id={student} onClose={() => setStudent(null)} />
    </Card>
  );
}

/* ── Corrections review ─────────────────────────────────────────── */
function Corrections() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState({});
  const { data, isLoading, error, refetch } = useGetCorrectionsQuery({ status, page });
  const [review, { isLoading: saving }] = useReviewCorrectionMutation();

  const act = async (id, action) => {
    try {
      await review({ id, action, note: notes[id] || undefined }).unwrap();
      toast.success(`Request ${action}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Card>
      <CardHeader
        title="Correction requests"
        action={<Tabs tabs={['pending', 'approved', 'rejected'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />}
      />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.requests.length ? (
        <EmptyState icon={ClipboardCheck} title={`No ${status} requests`} />
      ) : (
        <>
          <ul className="space-y-3">
            {data.requests.map((c) => (
              <li key={c._id} className="rounded-2xl bg-white/50 p-4 dark:bg-white/5">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar user={c.student} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">
                      {c.student?.name} <span className="font-medium muted">· {c.student?.rollNo}</span>
                    </p>
                    <p className="text-xs muted">
                      {c.subject?.code} · {fmtClassDay(c.date, 'EEE, dd MMM')} · Period {c.period}
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs">
                    <StatusBadge status={c.currentStatus} /> → <StatusBadge status={c.requestedStatus} />
                  </span>
                </div>
                <p className="mt-2 text-sm">“{c.reason}”</p>
                {c.status === 'pending' ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      className="input flex-1 rounded-xl py-2 text-xs"
                      placeholder="Note to the student (optional)"
                      maxLength={300}
                      value={notes[c._id] || ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [c._id]: e.target.value }))}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="success" loading={saving} onClick={() => act(c._id, 'approved')}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" loading={saving} onClick={() => act(c._id, 'rejected')}>
                        Reject
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs muted">
                    {c.status} by {c.reviewedBy?.name} · {fmtDateTime(c.reviewedAt)}
                    {c.reviewNote ? ` · “${c.reviewNote}”` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

/* ── Class overview (per subject) ───────────────────────────────── */
function ClassOverview() {
  const me = useSelector(selectUser);
  const { data: subjects = [] } = useGetSubjectsQuery(me.role === 'faculty' ? { mine: 'true' } : undefined);
  const [subjectId, setSubjectId] = useState('');
  const [section, setSection] = useState('');
  const [range, setRange] = useState({ range: 'semester' });
  const { data, isFetching, error } = useGetSubjectAttendanceQuery({ id: subjectId, section: section || undefined, ...rangeParams(range) }, { skip: !subjectId });
  const subject = subjects.find((s) => s._id === subjectId);

  return (
    <Card>
      <CardHeader
        title="Class overview"
        subtitle="Per-student attendance for one subject"
        action={
          <div className="flex flex-wrap gap-2">
            <select aria-label="Subject" className="input w-auto rounded-xl py-1.5 text-xs" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setSection(''); }}>
              <option value="">Choose subject</option>
              {subjects.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
            {subject?.sections?.length > 0 && (
              <select aria-label="Section" className="input w-auto rounded-xl py-1.5 text-xs" value={section} onChange={(e) => setSection(e.target.value)}>
                <option value="">All sections</option>
                {subject.sections.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
            <RangeFilter value={range} onChange={setRange} />
          </div>
        }
      />
      {!subjectId ? (
        <EmptyState icon={Users} title="Choose a subject" />
      ) : isFetching && !data ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} />
      ) : data ? (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2">
            <MiniStat label="Students" value={data.overall.totalStudents} />
            <MiniStat label="Classes held" value={data.overall.classesConducted} />
            <MiniStat label="Class average" value={`${data.overall.averagePercentage}%`} hint="Σ present ÷ Σ conducted" />
          </div>
          {data.students.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="px-2 py-2">Student</th>
                    <th className="px-2 py-2">Roll no</th>
                    <th className="px-2 py-2 text-right">Present</th>
                    <th className="px-2 py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/60 dark:divide-white/5">
                  {data.students.map((s) => (
                    <tr key={s._id} className="table-row">
                      <td className="px-2 py-2 font-semibold">{s.studentInfo.name}</td>
                      <td className="px-2 py-2 muted">{s.studentInfo.rollNo || '—'}</td>
                      <td className="px-2 py-2 text-right">
                        {s.presentPeriods}/{s.totalPeriods}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <PercentBadge value={s.percentage} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ClipboardList} title="No attendance recorded yet" />
          )}
        </>
      ) : null}
    </Card>
  );
}

export default function StaffAttendance() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'mark';
  const [preset, setPreset] = useState(null);
  const setTab = (t) => setParams(t === 'mark' ? {} : { tab: t }, { replace: true });
  const { data: pending } = useGetCorrectionsQuery({ status: 'pending', limit: 1 });

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardCheck}
        title="Attendance"
        subtitle="Mark classes, review corrections and follow up on low attendance."
      />
      <Tabs
        tabs={[
          { value: 'mark', label: 'Mark attendance' },
          { value: 'sessions', label: 'History' },
          { value: 'overview', label: 'Class overview' },
          { value: 'low', label: 'Low attendance' },
          { value: 'corrections', label: 'Corrections', count: pending?.pagination?.total || undefined },
        ]}
        value={tab}
        onChange={setTab}
        className="max-w-full"
      />
      {tab === 'mark' && <MarkAttendance preset={preset} onPresetUsed={() => setPreset(null)} />}
      {tab === 'sessions' && (
        <Sessions
          onOpen={(p) => {
            setPreset(p);
            setTab('mark');
          }}
        />
      )}
      {tab === 'overview' && <ClassOverview />}
      {tab === 'low' && <LowAttendance />}
      {tab === 'corrections' && <Corrections />}
      <p className="flex items-center gap-1.5 text-xs muted">
        <AlertTriangle className="h-3.5 w-3.5" /> Attendance % is always total present periods ÷ total conducted periods — never an average of subject percentages.
      </p>
    </div>
  );
}
