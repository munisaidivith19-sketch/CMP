import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { BookOpenCheck, CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  useCreateSubjectMutation,
  useDeleteSlotMutation,
  useDeleteSubjectMutation,
  useGetSubjectsQuery,
  useGetTimetableQuery,
  useGetUsersQuery,
  useUpdateSubjectMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, IconButton, PageHeader, Skeleton, Tabs } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Input, SectionMultiSelect, Select } from '../../components/ui/form';
import { ACADEMIC_YEARS, DEPARTMENTS, SECTIONS, WEEKDAYS as DAYS, YEAR_LABELS, semestersOfYear } from '../../utils/constants';
import { errMsg, titleCase } from '../../utils/format';
import SlotModal from '../timetable/SlotModal';

/** Faculty picker: the generic People endpoint in "picker" mode (not the
 * People directory), so it works for HOD too, not just admin. */
function useFacultyOptions(department) {
  const { data } = useGetUsersQuery({ role: 'faculty', limit: 50, context: 'picker', department });
  return (data?.items || []).map((u) => ({ value: u._id, label: `${u.name}${u.department ? ` · ${u.department}` : ''}` }));
}

/* ── Subjects ───────────────────────────────────────────────────── */
function SubjectModal({ subject, open, onClose }) {
  const me = useSelector(selectUser);
  const isHod = me.role === 'hod';
  const faculty = useFacultyOptions(isHod ? me.department : undefined);
  const [create, { isLoading: creating }] = useCreateSubjectMutation();
  const [update, { isLoading: updating }] = useUpdateSubjectMutation();
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm();

  useEffect(() => {
    if (open) {
      reset({
        name: subject?.name || '',
        code: subject?.code || '',
        department: subject?.department || (isHod ? me.department : 'CSE'),
        semester: subject?.semester || 1,
        credits: subject?.credits ?? 3,
        type: subject?.type || 'theory',
        faculty: subject?.faculty?.[0]?._id || '',
        sections: subject?.sections || [],
      });
    }
  }, [open, subject, reset]);

  const onSubmit = async (v) => {
    const body = {
      name: v.name.trim(),
      code: v.code.trim(),
      department: v.department,
      semester: Number(v.semester),
      credits: Number(v.credits),
      type: v.type,
      faculty: v.faculty ? [v.faculty] : [],
      sections: v.sections || [],
    };
    try {
      if (subject) await update({ id: subject._id, ...body }).unwrap();
      else await create(body).unwrap();
      toast.success(subject ? 'Subject updated' : 'Subject created');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={subject ? `Edit ${subject.code}` : 'New subject'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={creating || updating} onClick={handleSubmit(onSubmit)}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Input label="Name" error={errors.name} {...register('name', { required: 'Required', minLength: { value: 2, message: 'Too short' } })} />
        <Input label="Code" className="uppercase" error={errors.code} {...register('code', { required: 'Required' })} />
        <Select label="Department" options={DEPARTMENTS} disabled={isHod} hint={isHod ? 'Locked to your department' : undefined} {...register('department')} />
        <Input label="Semester" type="number" min={1} max={12} {...register('semester', { required: true })} />
        <Input label="Credits" type="number" min={0} max={10} {...register('credits')} />
        <Select label="Type" options={['theory', 'lab', 'elective']} {...register('type')} />
        <Select label="Faculty" placeholder="Unassigned" options={faculty} {...register('faculty')} />
        <Controller name="sections" control={control} render={({ field }) => <SectionMultiSelect label="Sections" value={field.value} onChange={field.onChange} />} />
      </form>
    </Modal>
  );
}

function Subjects() {
  const me = useSelector(selectUser);
  const { data, isLoading, error, refetch } = useGetSubjectsQuery(me.role === 'hod' ? { department: me.department } : undefined);
  const [edit, setEdit] = useState(undefined);
  const [del, setDel] = useState(null);
  const [remove, { isLoading: removing }] = useDeleteSubjectMutation();

  return (
    <Card>
      <CardHeader title="Subjects" subtitle="Faculty assignment decides who can mark attendance." action={<Button size="sm" icon={Plus} onClick={() => setEdit(null)}>New subject</Button>} />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.length ? (
        <EmptyState icon={BookOpenCheck} title="No subjects yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="px-2 py-2">Code</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Dept · Sem</th>
                <th className="px-2 py-2">Sections</th>
                <th className="px-2 py-2">Faculty</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/60 dark:divide-white/5">
              {data.map((s) => (
                <tr key={s._id} className="table-row">
                  <td className="px-2 py-2 font-bold">{s.code}</td>
                  <td className="px-2 py-2">
                    {s.name} {s.type !== 'theory' && <Badge color="warning">{s.type}</Badge>}
                  </td>
                  <td className="px-2 py-2 muted">
                    {s.department} · {s.semester}
                  </td>
                  <td className="px-2 py-2">{s.sections?.join(', ') || '—'}</td>
                  <td className="px-2 py-2">{s.faculty?.map((f) => f.name).join(', ') || <span className="text-rose-500">Unassigned</span>}</td>
                  <td className="px-2 py-2 text-right">
                    <IconButton icon={Pencil} label={`Edit ${s.code}`} onClick={() => setEdit(s)} />
                    <IconButton icon={Trash2} label={`Remove ${s.code}`} onClick={() => setDel(s)} className="hover:!text-rose-500" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SubjectModal open={edit !== undefined} subject={edit} onClose={() => setEdit(undefined)} />
      <ConfirmDialog
        open={Boolean(del)}
        onClose={() => setDel(null)}
        title={`Retire ${del?.code}?`}
        text="The subject and its timetable slots are deactivated. Existing attendance records are kept."
        confirmText="Retire subject"
        loading={removing}
        onConfirm={async () => {
          try {
            await remove(del._id).unwrap();
            toast.success('Subject retired');
          } catch (e) {
            toast.error(errMsg(e));
          }
          setDel(null);
        }}
      />
    </Card>
  );
}

/* ── Timetable slots ────────────────────────────────────────────── */
function Slots() {
  const me = useSelector(selectUser);
  const isHod = me.role === 'hod';
  const [klass, setKlass] = useState({ department: isHod ? me.department : 'CSE', year: 3, section: 'A', semester: 5 });
  const [applied, setApplied] = useState(klass);
  const { data, isLoading, isFetching, error, refetch } = useGetTimetableQuery({ department: applied.department, year: applied.year, section: applied.section, semester: applied.semester });
  const [edit, setEdit] = useState(undefined);
  const [del, setDel] = useState(null);
  const [remove, { isLoading: removing }] = useDeleteSlotMutation();
  const byDay = useMemo(() => {
    const map = Object.fromEntries(DAYS.map((d) => [d, []]));
    (data?.slots || []).forEach((s) => map[s.dayOfWeek]?.push(s));
    Object.values(map).forEach((l) => l.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [data]);

  return (
    <div className="space-y-5">
      <Card className="grid gap-3 sm:grid-cols-[1fr_110px_100px_110px_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="ac-dept">Department</label>
          <select id="ac-dept" className="input" value={klass.department} disabled={isHod} onChange={(e) => setKlass((k) => ({ ...k, department: e.target.value }))}>
            {(isHod ? [me.department] : DEPARTMENTS).map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ac-year">Year</label>
          <select
            id="ac-year"
            className="input"
            value={klass.year}
            onChange={(e) => {
              const year = Number(e.target.value);
              setKlass((k) => ({ ...k, year, semester: semestersOfYear(year).includes(k.semester) ? k.semester : semestersOfYear(year)[0] }));
            }}
          >
            {ACADEMIC_YEARS.map((y) => (
              <option key={y} value={y}>
                {YEAR_LABELS[y]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ac-sec">Section</label>
          <select id="ac-sec" className="input" value={klass.section} onChange={(e) => setKlass((k) => ({ ...k, section: e.target.value }))}>
            {SECTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ac-sem">Semester</label>
          <select id="ac-sem" className="input" value={klass.semester} onChange={(e) => setKlass((k) => ({ ...k, semester: Number(e.target.value) }))}>
            {semestersOfYear(klass.year).map((s) => (
              <option key={s} value={s}>
                Semester {s}
              </option>
            ))}
          </select>
        </div>
        <Button loading={isFetching} disabled={!klass.section} onClick={() => setApplied(klass)}>
          Load class
        </Button>
      </Card>

      <Card>
        <CardHeader
          title={`${applied.department} · ${YEAR_LABELS[applied.year]} · Section ${applied.section} · Semester ${applied.semester}`}
          subtitle="Clashes with other sections, faculty or rooms are rejected automatically."
          action={<Button size="sm" icon={Plus} onClick={() => setEdit(null)}>Add slot</Button>}
        />
        {isLoading ? (
          <Skeleton className="h-48" />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !data?.slots?.length ? (
          <EmptyState icon={CalendarClock} title="No timetable for this class yet" action={<Button icon={Plus} onClick={() => setEdit(null)}>Add first slot</Button>} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {DAYS.map((d) => (
              <div key={d} className="rounded-3xl bg-white/40 p-3 dark:bg-white/5">
                <p className="mb-2 text-xs font-extrabold uppercase tracking-wide muted">{titleCase(d)}</p>
                {byDay[d].length ? (
                  <ul className="space-y-1.5">
                    {byDay[d].map((s) => (
                      <li key={s._id} className="flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 text-xs dark:bg-white/10">
                        <span className="w-20 shrink-0 font-semibold muted">
                          {s.startTime}–{s.endTime}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-bold">{s.isBreak ? s.breakLabel || 'Break' : `${s.subject?.code} · ${s.faculty?.name}`}</span>
                        {s.room && <span className="hidden shrink-0 muted sm:inline">{s.room}</span>}
                        <button className="rounded-lg p-1 hover:bg-white" aria-label="Edit slot" onClick={() => setEdit(s)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button className="rounded-lg p-1 hover:bg-rose-500/10 hover:text-rose-500" aria-label="Delete slot" onClick={() => setDel(s)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs muted">No classes</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      <SlotModal open={edit !== undefined} slot={edit} klass={applied} onClose={() => setEdit(undefined)} />
      <ConfirmDialog
        open={Boolean(del)}
        onClose={() => setDel(null)}
        title="Remove this slot?"
        text="Students and faculty see the change immediately."
        confirmText="Remove"
        loading={removing}
        onConfirm={async () => {
          try {
            await remove(del._id).unwrap();
            toast.success('Slot removed');
          } catch (e) {
            toast.error(errMsg(e));
          }
          setDel(null);
        }}
      />
    </div>
  );
}

export default function AdminAcademics() {
  const [tab, setTab] = useState('timetable');
  return (
    <div className="space-y-5">
      <PageHeader
        icon={BookOpenCheck}
        title="Academics"
        subtitle="Subjects, faculty assignments and class timetables. Assign students to sections from User management."
        actions={<Tabs tabs={[{ value: 'timetable', label: 'Timetable' }, { value: 'subjects', label: 'Subjects' }]} value={tab} onChange={setTab} />}
      />
      {tab === 'timetable' ? <Slots /> : <Subjects />}
    </div>
  );
}
