import { useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarClock, CalendarDays, CheckCircle2, Clock, ListOrdered, ShieldCheck } from 'lucide-react';
import { useGetAttendanceFlowQuery, useSetAttendanceFlowMutation } from '../../services/api';
import { Badge, Button, Card, CardHeader, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { errMsg, fmtClassDay } from '../../utils/format';

const to12h = (t = '15:00') => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const OPTIONS = (rules) => [
  {
    value: 'period',
    icon: ListOrdered,
    title: 'Period-wise',
    text: 'Every period is taken by its own faculty while the period runs. Each period has its own attendance.',
    points: ['Faculty mark only during their period', 'HOD edits today only', 'No copying between periods'],
  },
  {
    value: 'day',
    icon: CalendarDays,
    title: 'Day-wise',
    text: 'The first period of the day is taken in the morning and copied to every period of that day.',
    points: [
      'The first period held that day is the morning attendance',
      `Faculty correct their own period from ${to12h(rules.editFrom)} until ${to12h(rules.editFrom)} the next day (${rules.facultyHours} h)`,
      `HOD edits on the day and for ${rules.hodHours} h from ${to12h(rules.editFrom)}`,
      'A corrected period is never overwritten by the copy',
    ],
  },
];

/** Principal: choose the college-wide attendance flow (period-wise or day-wise). */
export default function AttendanceFlowPanel() {
  const { data, isLoading, error } = useGetAttendanceFlowQuery();
  const [setFlow, { isLoading: saving }] = useSetAttendanceFlowMutation();
  const [confirm, setConfirm] = useState(null);

  if (isLoading) return <Skeleton className="h-64 rounded-3xl" />;
  if (error) return <ErrorState error={error} />;

  const rules = data.rules;
  // What tomorrow will use: the pending choice, or today's flow.
  const next = data.upcoming?.flow || data.current;

  const apply = async () => {
    try {
      const res = await setFlow({ flow: confirm }).unwrap();
      toast.success(
        res.changed
          ? res.upcoming
            ? `${confirm === 'day' ? 'Day-wise' : 'Period-wise'} attendance starts on ${fmtClassDay(res.upcoming.from, 'EEE, dd MMM')}`
            : 'Pending change cancelled — today’s flow continues'
          : 'No change'
      );
      setConfirm(null);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Attendance Flow"
          subtitle="How attendance is taken across the whole college. A change starts on the next class day, so a day is never half one flow and half the other."
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="muted">Today:</span>
          <Badge color="primary">{data.current === 'day' ? 'Day-wise' : 'Period-wise'}</Badge>
          {data.upcoming && (
            <>
              <span className="muted">· from {fmtClassDay(data.upcoming.from, 'EEE, dd MMM')}:</span>
              <Badge color="warning">{data.upcoming.flow === 'day' ? 'Day-wise' : 'Period-wise'}</Badge>
            </>
          )}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {OPTIONS(rules).map((o) => {
          const selected = next === o.value;
          return (
            <Card key={o.value} className={cn('flex flex-col border-2 transition-colors', selected ? 'border-primary-500/60' : 'border-transparent')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-600 dark:text-primary-300">
                    <o.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-base font-extrabold">{o.title}</p>
                    {data.current === o.value && <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">In use today</p>}
                  </div>
                </div>
                {selected && <CheckCircle2 className="h-5 w-5 text-primary-500" />}
              </div>
              <p className="mt-3 text-sm muted">{o.text}</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {o.points.map((p) => (
                  <li key={p} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-4">
                <Button className="w-full" variant={selected ? 'outline' : 'primary'} disabled={selected} onClick={() => setConfirm(o.value)}>
                  {selected ? (data.upcoming?.flow === o.value ? 'Starts next class day' : 'Selected') : `Use ${o.title.toLowerCase()}`}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {data.history?.length > 0 && (
        <Card>
          <CardHeader title="Change history" />
          <ul className="divide-y divide-white/10 text-sm">
            {data.history.map((h) => (
              <li key={`${h.flow}-${h.from}-${h.setAt}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 font-semibold">
                  <CalendarClock className="h-4 w-4 text-primary-500" />
                  {h.flow === 'day' ? 'Day-wise' : 'Period-wise'} from {fmtClassDay(h.from, 'EEE, dd MMM yyyy')}
                </span>
                <span className="flex items-center gap-1 text-xs muted">
                  <Clock className="h-3.5 w-3.5" />
                  {h.setBy?.name || 'Principal'} · {new Date(h.setAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm === 'day' ? 'Switch to day-wise attendance?' : 'Switch to period-wise attendance?'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={apply}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {confirm === 'day'
            ? `From the next class day, the first period's attendance is copied to every period of the day. Faculty, HODs and admins are notified.`
            : 'From the next class day, every period is taken by its own faculty while it runs. Faculty, HODs and admins are notified.'}
        </p>
        <p className="mt-2 text-xs muted">Today’s attendance is not affected. Earlier days keep the flow that applied to them.</p>
      </Modal>
    </div>
  );
}
