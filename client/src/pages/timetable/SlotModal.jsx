import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateSlotMutation, useGetSubjectsQuery, useGetTimetableFacultyBusyQuery, useGetTimetableFacultyOptionsQuery, useUpdateSlotMutation } from '../../services/api';
import { Button } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select, TimeInput } from '../../components/ui/form';
import { WEEKDAYS, YEAR_LABELS, yearOfSemester } from '../../utils/constants';
import { errMsg, titleCase } from '../../utils/format';

const MAX_PERIOD = 12;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "09:50" → "9:50 AM". */
const to12h = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Where a busy faculty member already is: "22CYP502 · CSE · Year 3 · Sec A · 9:00 AM–10:00 AM". */
export function clashText(c) {
  return [c.subjectCode, c.department, c.year && `Year ${c.year}`, c.section && `Sec ${c.section}`, `${to12h(c.startTime)}–${to12h(c.endTime)}`]
    .filter(Boolean)
    .join(' · ');
}
const NO_SLOTS = [];

/**
 * The period number a class at `startTime` on `dayOfWeek` should get. Only
 * classes are periods — breaks are skipped entirely. The same bell time on
 * another day keeps the same number when that number fits the day's order;
 * otherwise it is one more than the last class before it. The server
 * re-checks uniqueness and time order on save.
 */
export function suggestPeriod(classSlots, { dayOfWeek, startTime }, excludeId) {
  const classes = classSlots.filter((s) => !s.isBreak && s._id !== excludeId);
  const sameDay = classes.filter((s) => s.dayOfWeek === dayOfWeek);
  const fits = (n) =>
    sameDay.every((s) => s.period !== n && (s.startTime < startTime) === (s.period < n));
  const twin = classes.find((s) => s.startTime === startTime && fits(s.period));
  if (twin) return twin.period;
  const before = sameDay.filter((s) => s.startTime < startTime).map((s) => s.period);
  return Math.min(MAX_PERIOD, Math.max(0, ...before) + 1);
}

/**
 * Add / edit one timetable period (or break) for a class (department + year +
 * section + semester). `preset` pre-fills a new slot, e.g. from clicking an
 * empty cell in the week grid; `classSlots` is the class's current timetable,
 * used to number a new class period.
 */
export default function SlotModal({ slot, klass, preset, classSlots = NO_SLOTS, open, onClose }) {
  const { data: subjects = [], isFetching: loadingSubjects } = useGetSubjectsQuery({ department: klass.department, semester: klass.semester }, { skip: !open });
  // Every active faculty member in the college — cross-department teaching is allowed.
  const { data: facultyList = [] } = useGetTimetableFacultyOptionsQuery(undefined, { skip: !open });
  const [create, { isLoading: creating }] = useCreateSlotMutation();
  const [update, { isLoading: updating }] = useUpdateSlotMutation();
  const { register, handleSubmit, reset, watch, control, setValue, getFieldState, formState: { errors } } = useForm();
  const isBreak = watch('isBreak');
  const dayOfWeek = watch('dayOfWeek');
  const startTime = watch('startTime');
  const endTime = watch('endTime');
  const chosenFaculty = watch('faculty');
  // Who already teaches at an overlapping time that day (any class, college-wide).
  // 9:50–10:40 overlaps 9:00–10:00; back-to-back periods do not.
  const timeReady = Boolean(dayOfWeek && HHMM.test(startTime || '') && HHMM.test(endTime || '') && endTime > startTime);
  const { data: busyList = [], isFetching: checkingBusy } = useGetTimetableFacultyBusyQuery(
    { dayOfWeek, startTime, endTime, excludeId: slot?._id },
    { skip: !open || isBreak || !timeReady }
  );
  const busy = useMemo(() => {
    const map = new Map();
    if (timeReady) busyList.forEach((c) => map.has(c.faculty) || map.set(c.faculty, c));
    return map;
  }, [busyList, timeReady]);
  const clash = !isBreak && chosenFaculty ? busy.get(chosenFaculty) : null;
  const clashMessage = clash
    ? `${clash.facultyName || 'This faculty member'} is already assigned at this time — ${clashText(clash)} (${titleCase(clash.dayOfWeek)}). Choose another faculty member or change the time.`
    : null;
  const noSubjects = !loadingSubjects && !subjects.length;
  // A new class, or a break being turned into a class, gets its number from the timetable.
  const autoNumber = !slot || slot.isBreak;

  useEffect(() => {
    if (open) {
      reset({
        isBreak: slot?.isBreak ?? preset?.isBreak ?? false,
        breakLabel: slot?.breakLabel || preset?.breakLabel || 'Lunch break',
        subject: slot?.subject?._id || '',
        faculty: slot?.faculty?._id || '',
        dayOfWeek: slot?.dayOfWeek || preset?.dayOfWeek || 'monday',
        period: (!slot?.isBreak && slot?.period) || preset?.period || 1,
        startTime: slot?.startTime || preset?.startTime || '09:00',
        endTime: slot?.endTime || preset?.endTime || '09:50',
        room: slot?.room || '',
      });
    }
  }, [open, slot, preset, reset]);

  // Keep the suggested number in step with the chosen day and time until the
  // user types a number of their own.
  useEffect(() => {
    if (!open || !autoNumber || isBreak || !dayOfWeek || !startTime) return;
    if (getFieldState('period').isDirty) return;
    setValue('period', suggestPeriod(classSlots, { dayOfWeek, startTime }, slot?._id));
  }, [open, autoNumber, isBreak, dayOfWeek, startTime, classSlots, slot, setValue, getFieldState]);

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
      // A break is not a period, so it never carries a period number.
      period: v.isBreak ? undefined : Number(v.period),
      startTime: v.startTime,
      endTime: v.endTime,
      room: v.room || undefined,
    };
    try {
      if (slot) await update({ id: slot._id, ...body }).unwrap();
      else await create(body).unwrap();
      toast.success(v.isBreak ? (slot ? 'Break updated' : 'Break added') : slot ? 'Period updated' : 'Period added');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const what = isBreak ? 'break' : 'period';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={slot ? `Edit ${what}` : `Add ${what}`}
      subtitle={`${klass.department} · ${YEAR_LABELS[yearOfSemester(klass.semester)]} · Section ${klass.section} · Semester ${klass.semester}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={creating || updating} disabled={Boolean(clash)} onClick={handleSubmit(onSubmit)}>
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
          <Input
            label="Break label"
            className="sm:col-span-2"
            hint="A break is not a period — it has no period number, and classes after it keep counting P1, P2, P3…"
            {...register('breakLabel')}
          />
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
              options={facultyList.map((f) => {
                const c = busy.get(String(f._id));
                const name = f.department ? `${f.name} — ${f.department}` : f.name;
                // A busy faculty member cannot be picked (unless already chosen, so the warning stays visible).
                return { value: f._id, label: c ? `${name} (Busy: ${clashText(c)})` : name, disabled: Boolean(c) && String(f._id) !== chosenFaculty };
              })}
              error={errors.faculty || clashMessage}
              hint={timeReady ? (checkingBusy ? 'Checking who is free at this time…' : busy.size ? `${busy.size} faculty already have a class at this time and are greyed out.` : 'Everyone is free at this time.') : 'Pick the day and time to see who is free.'}
              {...register('faculty', {
                required: 'Select a faculty member',
                validate: (v) => !busy.get(v) || 'This faculty member is already assigned at this time',
              })}
            />
          </>
        )}
        <Select label="Day" options={WEEKDAYS.map((d) => ({ value: d, label: titleCase(d) }))} {...register('dayOfWeek')} />
        {isBreak ? (
          <div className="hidden sm:block" aria-hidden />
        ) : (
          <Input
            label="Period"
            type="number"
            min={1}
            max={MAX_PERIOD}
            error={errors.period}
            hint={autoNumber ? 'Numbered from the start time — breaks are not counted.' : undefined}
            {...register('period', {
              required: 'Enter the period number',
              min: { value: 1, message: `Period must be 1–${MAX_PERIOD}` },
              max: { value: MAX_PERIOD, message: `Period must be 1–${MAX_PERIOD}` },
            })}
          />
        )}
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
