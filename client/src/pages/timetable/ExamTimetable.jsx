import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Ban, CalendarClock, ClipboardList, Clock, Pencil, Plus, Search, Send, Trash2 } from 'lucide-react';
import {
  useCancelExamMutation,
  useCreateExamsMutation,
  useGetExamOptionsQuery,
  useGetExamsQuery,
  usePublishExamMutation,
  useUpdateExamMutation,
} from '../../services/api';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select, Textarea, TimeInput } from '../../components/ui/form';
import { ACADEMIC_OVERSIGHT, ALL, EXAM_MANAGERS, YEAR_LABELS } from '../../utils/constants';
import { errMsg, fmtClassDay, todayKey } from '../../utils/format';
import { to12h } from './TimetableGrid';

const STATUS_BADGE = { draft: 'neutral', published: 'success', cancelled: 'danger' };
const STATUS_LABEL = { draft: 'Draft', published: 'Published', cancelled: 'Cancelled' };
const blankEntry = () => ({ subjectCode: '', subjectName: '', date: '', startTime: '09:30', endTime: '12:30' });
const pick1 = (list = []) => (list.length === 1 ? String(list[0]) : ALL);

/**
 * Exam Timetable — part of the Timetable dashboard.
 *
 * Everyone with timetable access reads the published exams that concern them
 * (the server decides which). The HOD (own department) and the COE (campus-wide)
 * also create, edit, publish and cancel; the buttons follow the per-exam
 * `canEdit` / `canPublish` / `canCancel` flags the server computes, and the
 * server re-checks every write regardless.
 */
export default function ExamTimetable({ me }) {
  const isManager = EXAM_MANAGERS.includes(me.role);
  const campusReader = ACADEMIC_OVERSIGHT.includes(me.role);
  const hasScopeFilters = isManager || campusReader;

  const [filters, setFilters] = useState({ department: '', year: '', section: '', from: todayKey(), to: '', subject: '', status: '' });
  const [subjectInput, setSubjectInput] = useState('');
  const [form, setForm] = useState(undefined); // undefined = closed, null = new, object = editing
  const [cancelling, setCancelling] = useState(null);

  // Debounce the subject search so typing does not fire a request per key.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, subject: subjectInput.trim() })), 300);
    return () => clearTimeout(t);
  }, [subjectInput]);

  const { data: options } = useGetExamOptionsQuery(
    { department: filters.department || undefined, year: filters.year || undefined },
    { skip: !hasScopeFilters }
  );
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null));
  const { data, isLoading, isFetching, error, refetch } = useGetExamsQuery(params);
  const exams = useMemo(() => data?.exams || [], [data]);
  const byDate = useMemo(() => {
    const map = new Map();
    exams.forEach((e) => map.set(e.date, [...(map.get(e.date) || []), e]));
    return [...map.entries()];
  }, [exams]);

  const [publish, { isLoading: publishing }] = usePublishExamMutation();
  const doPublish = async (exam) => {
    try {
      await publish(exam._id).unwrap();
      toast.success(`${exam.subjectCode} published — regular attendance is now blocked during the exam`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-5">
      <Card className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {hasScopeFilters && (
          <>
            {options?.fixedDepartment ? (
              <div className="w-full sm:w-auto">
                <p className="label">Department</p>
                <p className="input flex items-center bg-white/30 dark:bg-white/5">{options.fixedDepartment}</p>
              </div>
            ) : (
              <Select
                className="w-full sm:min-w-[11rem] sm:flex-1"
                label="Department"
                keepCase
                placeholder="All Departments"
                options={(options?.departments || []).map((d) => ({ value: d, label: d }))}
                value={filters.department}
                onChange={(e) => set({ department: e.target.value, section: '' })}
              />
            )}
            <Select
              className="w-full sm:w-36"
              label="Year"
              keepCase
              placeholder="All Years"
              options={(options?.years || []).map((y) => ({ value: String(y), label: YEAR_LABELS[y] }))}
              value={filters.year}
              onChange={(e) => set({ year: e.target.value, section: '' })}
            />
            <Select
              className="w-full sm:w-36"
              label="Section"
              keepCase
              placeholder="All Sections"
              options={(options?.sections || []).map((s) => ({ value: s, label: `Section ${s}` }))}
              value={filters.section}
              onChange={(e) => set({ section: e.target.value })}
            />
          </>
        )}
        <Input className="w-full sm:w-40" label="From" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        <Input className="w-full sm:w-40" label="To" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
        <Input
          className="w-full sm:min-w-[12rem] sm:flex-1"
          label="Subject"
          icon={Search}
          placeholder="Code or name"
          value={subjectInput}
          onChange={(e) => setSubjectInput(e.target.value)}
        />
        {isManager && (
          <Select
            className="w-full sm:w-36"
            label="Status"
            keepCase
            placeholder="Any status"
            options={['draft', 'published', 'cancelled'].map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            value={filters.status}
            onChange={(e) => set({ status: e.target.value })}
          />
        )}
        {isManager && (
          <Button icon={Plus} className="w-full sm:w-auto" onClick={() => setForm(null)}>
            Create Exam
          </Button>
        )}
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data?.needsSection ? (
        <Card>
          <EmptyState icon={CalendarClock} title="Your class section isn’t set yet" text="Once your department, year and section are assigned, your exam timetable appears here." />
        </Card>
      ) : !exams.length ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="No exams scheduled"
            text={isManager ? 'No exams match these filters. Create one to publish it to the students concerned.' : 'No published exams match these filters.'}
            action={isManager && <Button icon={Plus} onClick={() => setForm(null)}>Create Exam</Button>}
          />
        </Card>
      ) : (
        <div className={cn('space-y-4', isFetching && 'opacity-70 transition-opacity')} aria-busy={isFetching}>
          {byDate.map(([date, list]) => (
            <Card key={date} className="p-0 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/40 px-4 py-3 dark:border-white/10">
                <CalendarClock className="h-4 w-4 text-primary-500" />
                <h3 className="text-sm font-extrabold">{fmtClassDay(date, 'EEEE, dd MMM yyyy')}</h3>
                <span className="text-xs muted">· {list.length} exam{list.length > 1 ? 's' : ''}</span>
              </div>
              <ul className="divide-y divide-white/40 dark:divide-white/10">
                {list.map((e) => (
                  <li key={e._id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3', e.status === 'cancelled' && 'opacity-70')}>
                    <div className="flex w-full items-center gap-1.5 text-sm font-bold sm:w-44">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-primary-500" />
                      {to12h(e.startTime)} – {to12h(e.endTime)}
                    </div>
                    <div className="min-w-0 flex-1 basis-56">
                      <p className={cn('truncate text-sm font-bold', e.status === 'cancelled' && 'line-through')}>
                        <span className="mr-2 rounded-lg bg-primary-500/10 px-1.5 py-0.5 font-mono text-xs text-primary-700 dark:text-primary-300">{e.subjectCode}</span>
                        {e.subjectName}
                      </p>
                      <p className="truncate text-xs muted">{e.scope}</p>
                      {e.status === 'cancelled' && e.cancelReason && <p className="text-xs text-rose-600 dark:text-rose-300">Cancelled: {e.cancelReason}</p>}
                      {e.notes && <p className="truncate text-xs muted">{e.notes}</p>}
                    </div>
                    <Badge color={STATUS_BADGE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                    {(e.canEdit || e.canPublish || e.canCancel) && (
                      <div className="flex flex-wrap gap-1.5">
                        {e.canPublish && (
                          <Button size="sm" icon={Send} loading={publishing} onClick={() => doPublish(e)}>
                            Publish
                          </Button>
                        )}
                        {e.canEdit && (
                          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setForm(e)} aria-label={`Edit ${e.subjectCode} exam`}>
                            Edit
                          </Button>
                        )}
                        {e.canCancel && (
                          <Button size="sm" variant="ghost" icon={Ban} onClick={() => setCancelling(e)} aria-label={`Cancel ${e.subjectCode} exam`}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          {exams.length >= 500 && <p className="text-center text-xs muted">Showing the first 500 exams — narrow the filters to see more.</p>}
        </div>
      )}

      {isManager && form !== undefined && <ExamFormModal open exam={form} onClose={() => setForm(undefined)} />}
      {cancelling && <CancelExamModal exam={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

/**
 * Create one or more exams for one target group, or edit one exam. The
 * Department / Year / Section choices come from the server (an HOD's
 * department is fixed; sections are the ones configured for the chosen
 * department and year).
 */
function ExamFormModal({ open, exam, onClose }) {
  const editing = Boolean(exam);
  const [scope, setScope] = useState({
    department: editing ? pick1(exam.departments) : ALL,
    year: editing ? pick1(exam.years) : ALL,
    section: editing ? pick1(exam.sections) : ALL,
  });
  const [entries, setEntries] = useState(
    editing ? [{ subjectCode: exam.subjectCode, subjectName: exam.subjectName, date: exam.date, startTime: exam.startTime, endTime: exam.endTime, notes: exam.notes || '' }] : [blankEntry()]
  );
  const [publishNow, setPublishNow] = useState(false);
  const [errors, setErrors] = useState({});
  const { data: options } = useGetExamOptionsQuery({
    department: scope.department !== ALL ? scope.department : undefined,
    year: scope.year !== ALL ? scope.year : undefined,
  });
  const [create, { isLoading: creating }] = useCreateExamsMutation();
  const [update, { isLoading: updating }] = useUpdateExamMutation();
  const fixedDepartment = options?.fixedDepartment;

  // A section that does not exist for the newly chosen department / year is dropped.
  useEffect(() => {
    if (options?.sections && scope.section !== ALL && !options.sections.includes(scope.section)) setScope((s) => ({ ...s, section: ALL }));
  }, [options?.sections, scope.section]);

  const setEntry = (i, patch) => setEntries((list) => list.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const today = todayKey();

  const validate = () => {
    const errs = {};
    entries.forEach((e, i) => {
      if (!e.subjectCode.trim()) errs[`${i}.subjectCode`] = 'Subject code is required';
      if (!e.subjectName.trim()) errs[`${i}.subjectName`] = 'Subject name is required';
      if (!e.date) errs[`${i}.date`] = 'Choose the exam date';
      else if (e.date < today) errs[`${i}.date`] = 'The date cannot be in the past';
      if (!(e.endTime > e.startTime)) errs[`${i}.endTime`] = 'End time must be after the start time';
    });
    setErrors(errs);
    return !Object.keys(errs).length;
  };

  const submit = async () => {
    if (!validate()) return;
    const scopeBody = { ...(fixedDepartment ? {} : { department: scope.department }), year: scope.year, section: scope.section };
    try {
      if (editing) {
        const [e] = entries;
        await update({ id: exam._id, ...scopeBody, ...e, notes: e.notes || null }).unwrap();
        toast.success(`${e.subjectCode.toUpperCase()} exam updated`);
      } else {
        const res = await create({
          ...scopeBody,
          status: publishNow ? 'published' : 'draft',
          entries: entries.map((e) => ({ ...e, notes: e.notes || undefined })),
        }).unwrap();
        toast.success(res.message);
      }
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${exam.subjectCode} exam` : 'Create Exam'}
      subtitle={editing ? `${STATUS_LABEL[exam.status]} · ${exam.scope}` : 'Add one or more exams for the same student group.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button loading={creating || updating} onClick={submit}>
            {editing ? 'Save changes' : publishNow ? `Publish ${entries.length} exam${entries.length > 1 ? 's' : ''}` : `Save ${entries.length > 1 ? `${entries.length} drafts` : 'draft'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="label mb-1 sm:col-span-3">Students</legend>
          {fixedDepartment ? (
            <div>
              <p className="label">Department</p>
              <p className="input flex items-center bg-white/30 dark:bg-white/5">{fixedDepartment}</p>
            </div>
          ) : (
            <Select
              label="Department"
              keepCase
              options={[{ value: ALL, label: 'All Departments' }, ...(options?.departments || []).map((d) => ({ value: d, label: d }))]}
              value={scope.department}
              onChange={(e) => setScope((s) => ({ ...s, department: e.target.value }))}
            />
          )}
          <Select
            label="Year"
            keepCase
            options={[
              { value: ALL, label: options?.years?.length === 1 ? `All Years (${YEAR_LABELS[options.years[0]]})` : 'All Years' },
              ...(options?.years || []).map((y) => ({ value: String(y), label: YEAR_LABELS[y] })),
            ]}
            value={scope.year}
            onChange={(e) => setScope((s) => ({ ...s, year: e.target.value }))}
            hint={fixedDepartment && scope.year === ALL ? 'Your department’s years 2–4 (1st year is managed by the Science & Humanities HOD).' : undefined}
          />
          <Select
            label="Section"
            keepCase
            options={[{ value: ALL, label: 'All Sections' }, ...(options?.sections || []).map((s) => ({ value: s, label: `Section ${s}` }))]}
            value={scope.section}
            onChange={(e) => setScope((s) => ({ ...s, section: e.target.value }))}
          />
        </fieldset>

        {entries.map((e, i) => (
          <fieldset key={i} className="rounded-2xl border border-white/50 p-3 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between">
              <legend className="text-xs font-bold uppercase tracking-wider muted">{editing ? 'Exam' : `Exam ${i + 1}`}</legend>
              {!editing && entries.length > 1 && (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setEntries((list) => list.filter((_, j) => j !== i))} aria-label={`Remove exam ${i + 1}`}>
                  Remove
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Subject code"
                placeholder="e.g. CS501"
                maxLength={20}
                value={e.subjectCode}
                error={errors[`${i}.subjectCode`]}
                onChange={(ev) => setEntry(i, { subjectCode: ev.target.value.toUpperCase() })}
              />
              <Input
                label="Subject name"
                placeholder="e.g. Compiler Design"
                maxLength={120}
                value={e.subjectName}
                error={errors[`${i}.subjectName`]}
                onChange={(ev) => setEntry(i, { subjectName: ev.target.value })}
              />
              <Input label="Exam date" type="date" min={today} value={e.date} error={errors[`${i}.date`]} onChange={(ev) => setEntry(i, { date: ev.target.value })} />
              <div className="hidden sm:block" aria-hidden />
              <TimeInput label="Starts" value={e.startTime} onChange={(v) => setEntry(i, { startTime: v })} />
              <TimeInput label="Ends" value={e.endTime} error={errors[`${i}.endTime`]} onChange={(v) => setEntry(i, { endTime: v })} />
              {editing && (
                <Textarea className="sm:col-span-2" label="Notes (optional)" rows={2} maxLength={300} value={e.notes} onChange={(ev) => setEntry(i, { notes: ev.target.value })} />
              )}
            </div>
          </fieldset>
        ))}

        {!editing && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="soft" icon={Plus} disabled={entries.length >= 30} onClick={() => setEntries((list) => [...list, { ...blankEntry(), startTime: list.at(-1).startTime, endTime: list.at(-1).endTime }])}>
              Add another exam
            </Button>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={publishNow} onChange={(ev) => setPublishNow(ev.target.checked)} />
              Publish now (students see it, and regular attendance is blocked during the exam)
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CancelExamModal({ exam, onClose }) {
  const [reason, setReason] = useState('');
  const [cancel, { isLoading }] = useCancelExamMutation();
  const submit = async () => {
    try {
      await cancel({ id: exam._id, reason: reason.trim() || undefined }).unwrap();
      toast.success(`${exam.subjectCode} exam cancelled — attendance for its periods is open again`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Cancel the ${exam.subjectCode} exam?`}
      subtitle={`${fmtClassDay(exam.date)} · ${to12h(exam.startTime)} – ${to12h(exam.endTime)} · ${exam.scope}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep exam
          </Button>
          <Button variant="danger" loading={isLoading} onClick={submit}>
            Cancel exam
          </Button>
        </>
      }
    >
      <Textarea label="Reason (shown to students)" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="mt-2 text-xs muted">Attendance already recorded is not changed.</p>
    </Modal>
  );
}
