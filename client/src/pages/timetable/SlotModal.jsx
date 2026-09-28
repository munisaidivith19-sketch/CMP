import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateSlotMutation, useGetSubjectsQuery, useGetTimetableFacultyOptionsQuery, useUpdateSlotMutation } from '../../services/api';
import { Button } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select, TimeInput } from '../../components/ui/form';
import { WEEKDAYS, YEAR_LABELS, yearOfSemester } from '../../utils/constants';
import { errMsg, titleCase } from '../../utils/format';

/**
 * Add / edit one timetable period for a class (department + year + section + semester).
 * `preset` pre-fills a new slot, e.g. from clicking an empty cell in the week grid.
 */
export default function SlotModal({ slot, klass, preset, open, onClose }) {
  const { data: subjects = [], isFetching: loadingSubjects } = useGetSubjectsQuery({ department: klass.department, semester: klass.semester }, { skip: !open });
  // Every active faculty member in the college — cross-department teaching is allowed.
  const { data: facultyList = [] } = useGetTimetableFacultyOptionsQuery(undefined, { skip: !open });
  const [create, { isLoading: creating }] = useCreateSlotMutation();
  const [update, { isLoading: updating }] = useUpdateSlotMutation();
  const { register, handleSubmit, reset, watch, control, formState: { errors } } = useForm();
  const isBreak = watch('isBreak');
  const noSubjects = !loadingSubjects && !subjects.length;

  useEffect(() => {
    if (open) {
      reset({
        isBreak: slot?.isBreak || false,
        breakLabel: slot?.breakLabel || 'Lunch break',
        subject: slot?.subject?._id || '',
        faculty: slot?.faculty?._id || '',
        dayOfWeek: slot?.dayOfWeek || preset?.dayOfWeek || 'monday',
        period: slot?.period || preset?.period || 1,
        startTime: slot?.startTime || preset?.startTime || '09:00',
        endTime: slot?.endTime || preset?.endTime || '09:50',
        room: slot?.room || '',
      });
    }
  }, [open, slot, preset, reset]);

  const onSubmit = async (v) => {
    const body = {
      isBreak: Boolean(v.isBreak),
      breakLabel: v.isBreak ? v.breakLabel : undefined,
      subject: v.isBreak ? undefined : v.subject,
      faculty: v.isBreak ? undefined : v.faculty,
      section: klass.section,
      department: klass.department,
      year: yearOfSemester(klass.semester),
      semester: Number(klass.semester),
      dayOfWeek: v.dayOfWeek,
      period: Number(v.period),
      startTime: v.startTime,
      endTime: v.endTime,
      room: v.room || undefined,
    };
    try {
      if (slot) await update({ id: slot._id, ...body }).unwrap();
      else await create(body).unwrap();
      toast.success(slot ? 'Period updated' : 'Period added');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={slot ? 'Edit period' : 'Add period'}
      subtitle={`${klass.department} · ${YEAR_LABELS[yearOfSemester(klass.semester)]} · Section ${klass.section} · Semester ${klass.semester}`}
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
        <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2">
          <input type="checkbox" {...register('isBreak')} /> This is a break (lunch, recess…)
        </label>
        {isBreak ? (
          <Input label="Break label" className="sm:col-span-2" {...register('breakLabel')} />
        ) : (
          <>
            <Select
              label="Subject"
              keepCase
              placeholder={loadingSubjects ? 'Loading…' : noSubjects ? 'No subjects configured' : 'Select subject'}
              options={subjects.map((s) => ({ value: s._id, label: `${s.name} — ${s.code}` }))}
              error={errors.subject}
              hint={noSubjects ? 'No subjects configured for this semester. Add them in server/src/data/timetableData.js or Academics → Subjects.' : undefined}
              {...register('subject', { required: 'Select a subject' })}
            />
            <Select
              label="Faculty"
              keepCase
              placeholder={facultyList.length ? 'Select faculty' : 'No active faculty'}
              options={facultyList.map((f) => ({ value: f._id, label: f.department ? `${f.name} — ${f.department}` : f.name }))}
              error={errors.faculty}
              {...register('faculty', { required: 'Select a faculty member' })}
            />
          </>
        )}
        <Select label="Day" options={WEEKDAYS.map((d) => ({ value: d, label: titleCase(d) }))} {...register('dayOfWeek')} />
        <Input label="Period" type="number" min={1} max={12} {...register('period', { required: true })} />
        <Controller
          name="startTime"
          control={control}
          rules={{ required: 'Choose a start time' }}
          render={({ field }) => <TimeInput label="Starts" value={field.value} onChange={field.onChange} error={errors.startTime} />}
        />
        <Controller
          name="endTime"
          control={control}
          rules={{ required: 'Choose an end time', validate: (v, all) => v > all.startTime || 'End time must be after the start time' }}
          render={({ field }) => <TimeInput label="Ends" value={field.value} onChange={field.onChange} error={errors.endTime} />}
        />
        {!isBreak && <Input label="Room" className="sm:col-span-2" placeholder="e.g. LH-301" {...register('room')} />}
      </form>
    </Modal>
  );
}
