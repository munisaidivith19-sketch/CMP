import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarOff, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  useCreateHolidayMutation,
  useDeleteHolidayMutation,
  useGetHolidayOptionsQuery,
  useGetHolidaysQuery,
  useUpdateHolidayMutation,
} from '../../services/api';
import { Badge, Button, EmptyState, Skeleton, cn } from '../../components/ui/primitives';
import { Input, Select } from '../../components/ui/form';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import MiniCalendar from '../../components/MiniCalendar';
import { errMsg, todayKey } from '../../utils/format';
import { fmtHolidayDates } from '../../utils/holidays';

/** "HOLIDAY · reason · …" block shown wherever a class or date is on holiday. */
export function HolidayBanner({ holiday, text = 'Attendance cannot be taken for this class on this date.', className }) {
  if (!holiday) return null;
  return (
    <div className={cn('flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4', className)} role="status">
      <CalendarOff className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
      <div className="min-w-0">
        <p className="text-xs font-extrabold uppercase tracking-widest text-rose-700 dark:text-rose-300">Holiday</p>
        <p className="mt-0.5 font-bold">{holiday.reason}</p>
        <p className="mt-0.5 text-xs muted">
          {holiday.scope} · {fmtHolidayDates(holiday)}
        </p>
        {text && <p className="mt-1 text-sm text-ink-soft dark:text-ink-muted">{text}</p>}
      </div>
    </div>
  );
}

const EMPTY = { reason: '', type: 'SINGLE', startDate: '', endDate: '', department: 'ALL', year: 'ALL', section: 'ALL' };

const scopePreview = (f) => {
  if (f.department === 'ALL') return 'Entire college';
  const parts = [f.department];
  if (f.year !== 'ALL') parts.push(`Year ${f.year}`);
  if (f.section !== 'ALL') parts.push(`Section ${f.section}`);
  return parts.join(' → ');
};

/** Principal-only create / edit form. The server re-validates everything. */
function HolidayForm({ editing, onDone }) {
  const { data: opts } = useGetHolidayOptionsQuery();
  const [form, setForm] = useState(() =>
    editing
      ? {
          reason: editing.reason,
          type: editing.type,
          startDate: editing.startDate,
          endDate: editing.endDate,
          department: editing.department,
          year: String(editing.year),
          section: editing.section,
        }
      : EMPTY
  );
  const [errors, setErrors] = useState({});
  const [confirmCollege, setConfirmCollege] = useState(false);
  const [create, { isLoading: creating }] = useCreateHolidayMutation();
  const [update, { isLoading: updating }] = useUpdateHolidayMutation();
  const busy = creating || updating;

  // The scope is a hierarchy: choosing "ALL" above clears what sits below it.
  const set = (k, v) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === 'department' && v === 'ALL') Object.assign(next, { year: 'ALL', section: 'ALL' });
      if (k === 'year' && v === 'ALL') next.section = 'ALL';
      if (k === 'type' && v === 'SINGLE') next.endDate = '';
      return next;
    });

  const validate = () => {
    const e = {};
    if (form.reason.trim().length < 3) e.reason = 'Enter a reason (at least 3 characters)';
    if (!form.startDate) e.startDate = form.type === 'SINGLE' ? 'Choose the date' : 'Choose the "From" date';
    if (form.type === 'CUSTOM') {
      if (!form.endDate) e.endDate = 'Choose the "To" date';
      else if (form.startDate && form.endDate < form.startDate) e.endDate = '"To" cannot be before "From"';
    }
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = async () => {
    const body = {
      reason: form.reason.trim(),
      type: form.type,
      startDate: form.startDate,
      ...(form.type === 'CUSTOM' ? { endDate: form.endDate } : {}),
      department: form.department,
      year: form.year === 'ALL' ? 'ALL' : Number(form.year),
      section: form.section,
    };
    try {
      if (editing) await update({ id: editing._id, ...body }).unwrap();
      else await create(body).unwrap();
      toast.success(editing ? 'Holiday updated' : 'Holiday declared');
      onDone();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setConfirmCollege(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    if (form.department === 'ALL') setConfirmCollege(true);
    else save();
  };

  const departments = opts?.departments || [];
  const sections = opts?.sections || [];
  const years = opts?.years || [1, 2, 3, 4];

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-white/40 bg-white/40 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">{editing ? 'Edit holiday' : 'Declare a holiday'}</p>
        <button type="button" className="btn-icon btn-ghost h-8 w-8" aria-label="Close form" onClick={onDone}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <Input label="Reason" value={form.reason} maxLength={200} onChange={(e) => set('reason', e.target.value)} error={errors.reason} placeholder="e.g. Diwali" />
      <Select
        label="Holiday type"
        keepCase
        value={form.type}
        onChange={(e) => set('type', e.target.value)}
        options={[
          { value: 'SINGLE', label: 'Single Day' },
          { value: 'CUSTOM', label: 'Custom' },
        ]}
      />
      {form.type === 'SINGLE' ? (
        <Input label="Date" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} error={errors.startDate} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="From date" type="date" value={form.startDate} max={form.endDate || undefined} onChange={(e) => set('startDate', e.target.value)} error={errors.startDate} />
          <Input label="To date" type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => set('endDate', e.target.value)} error={errors.endDate} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select
          label="Department"
          keepCase
          value={form.department}
          onChange={(e) => set('department', e.target.value)}
          options={[{ value: 'ALL', label: 'ALL' }, ...departments.map((d) => ({ value: d, label: d }))]}
        />
        <Select
          label="Year"
          keepCase
          value={form.year}
          disabled={form.department === 'ALL'}
          onChange={(e) => set('year', e.target.value)}
          options={[{ value: 'ALL', label: 'ALL' }, ...years.map((y) => ({ value: String(y), label: String(y) }))]}
        />
        <Select
          label="Section"
          keepCase
          value={form.section}
          disabled={form.year === 'ALL'}
          onChange={(e) => set('section', e.target.value)}
          options={[{ value: 'ALL', label: 'ALL SECTIONS' }, ...sections.map((s) => ({ value: s, label: s }))]}
        />
      </div>
      <p className={cn('rounded-xl px-3 py-2 text-xs font-semibold', form.department === 'ALL' ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300' : 'bg-primary-500/10 text-primary-700 dark:text-primary-300')}>
        Holiday applies to: {scopePreview(form)}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {editing ? 'Save changes' : 'Submit'}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmCollege}
        onClose={() => setConfirmCollege(false)}
        onConfirm={save}
        loading={busy}
        danger={false}
        title="Entire college"
        text="This holiday will apply to the entire college. Continue?"
        confirmText="Continue"
      />
    </form>
  );
}

/**
 * The Holidays panel of the Attendance sub-dashboard. Everyone who opens it
 * sees the calendar and list of holidays that apply to them; only the
 * Principal gets the declare / edit / delete controls (and the server refuses
 * those calls from anyone else regardless).
 */
export function HolidaysModal({ open, onClose }) {
  const { data, isLoading } = useGetHolidaysQuery(undefined, { skip: !open });
  const [formFor, setFormFor] = useState(null); // null | 'new' | holiday
  const [deleting, setDeleting] = useState(null);
  const [remove, { isLoading: removing }] = useDeleteHolidayMutation();
  const canManage = Boolean(data?.canManage);
  const holidays = useMemo(() => data?.holidays || [], [data]);
  const today = todayKey();
  const upcoming = holidays.filter((h) => h.endDate >= today);
  const past = holidays.filter((h) => h.endDate < today).reverse();

  const confirmDelete = async () => {
    try {
      await remove(deleting._id).unwrap();
      toast.success('Holiday deleted');
      setDeleting(null);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const row = (h, muted) => (
    <li key={h._id} className={cn('flex items-start gap-3 rounded-2xl bg-white/50 p-3 dark:bg-white/5', muted && 'opacity-60')}>
      <span className="mt-1 h-8 w-1.5 shrink-0 rounded-full bg-rose-500" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{h.reason}</p>
        <p className="text-xs muted">{fmtHolidayDates(h)}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge color={h.entireCollege ? 'warning' : 'info'}>{h.scope}</Badge>
          <Badge color="neutral">{h.type === 'SINGLE' ? 'Single day' : 'Custom'}</Badge>
        </div>
      </div>
      {canManage && (
        <div className="flex shrink-0 gap-1">
          <button className="btn-icon btn-ghost h-8 w-8" aria-label={`Edit ${h.reason}`} title="Edit" onClick={() => setFormFor(h)}>
            <Pencil className="h-4 w-4" />
          </button>
          <button className="btn-icon btn-ghost h-8 w-8 text-rose-600" aria-label={`Delete ${h.reason}`} title="Delete" onClick={() => setDeleting(h)}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </li>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <CalendarOff className="h-5 w-5 text-rose-500" /> Holidays
        </span>
      }
      subtitle={canManage ? 'Declare, edit or delete college holidays. Attendance is closed on these days.' : 'Holidays that apply to you. Attendance is not taken on these days.'}
    >
      <div className="space-y-4">
        {canManage && !formFor && (
          <Button icon={Plus} onClick={() => setFormFor('new')}>
            Add holiday
          </Button>
        )}
        {canManage && formFor && <HolidayForm key={formFor === 'new' ? 'new' : formFor._id} editing={formFor === 'new' ? null : formFor} onDone={() => setFormFor(null)} />}

        <div className="grid gap-4 md:grid-cols-2">
          <MiniCalendar holidays={holidays} />
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide muted">Upcoming</p>
            {isLoading ? (
              <Skeleton className="h-20" />
            ) : upcoming.length ? (
              <ul className="space-y-2">{upcoming.map((h) => row(h, false))}</ul>
            ) : (
              <EmptyState icon={CalendarOff} title="No upcoming holidays" />
            )}
            {past.length > 0 && (
              <>
                <p className="pt-2 text-xs font-bold uppercase tracking-wide muted">Past</p>
                <ul className="space-y-2">{past.slice(0, 10).map((h) => row(h, true))}</ul>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={removing}
        title="Delete Holiday?"
        text="This will remove the holiday from the selected dates and restore normal timetable and attendance rules."
        confirmText="Delete"
      />
    </Modal>
  );
}

/** The small HOLIDAYS button for the Attendance sub-dashboard. */
export function HolidaysButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-rose-700 transition-all hover:bg-rose-500/20 dark:text-rose-300"
      >
        <CalendarOff className="h-3.5 w-3.5" /> Holidays
      </button>
      <HolidaysModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
