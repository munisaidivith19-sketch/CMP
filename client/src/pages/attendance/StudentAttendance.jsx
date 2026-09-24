import { useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { AlertTriangle, CalendarCheck2, CheckCircle2, ClipboardCheck, History, XCircle } from 'lucide-react';
import {
  useGetAttendanceRecordsQuery,
  useGetAttendanceTrendsQuery,
  useGetCorrectionsQuery,
  useGetMyAttendanceQuery,
  useRequestCorrectionMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/form';
import { MiniStat, PercentBars, PercentRing, PercentTrend, RangeFilter, StatusBadge, rangeParams } from '../../components/insights';
import { errMsg, fmtClassDay, fmtDateTime } from '../../utils/format';

function CorrectionModal({ record, onClose }) {
  const [reason, setReason] = useState('');
  const [send, { isLoading }] = useRequestCorrectionMutation();
  if (!record) return null;
  const requested = record.status === 'present' ? 'absent' : 'present';
  return (
    <Modal
      open
      onClose={onClose}
      title="Request a correction"
      subtitle={`${record.subject?.code} · ${fmtClassDay(record.date)} · Period ${record.period}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={isLoading}
            disabled={reason.trim().length < 5}
            onClick={async () => {
              try {
                await send({ subjectId: record.subject._id, date: String(record.date).slice(0, 10), period: record.period, requestedStatus: requested, reason: reason.trim() }).unwrap();
                toast.success('Correction request sent to your faculty');
                onClose();
              } catch (e) {
                toast.error(errMsg(e));
              }
            }}
          >
            Send request
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm">
        Marked <StatusBadge status={record.status} /> — you are asking for <StatusBadge status={requested} />.
      </p>
      <Textarea
        label="Reason"
        rows={4}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. I was present but marked absent — I sat in the second row."
        hint="Your subject faculty reviews the request. At least 5 characters."
      />
    </Modal>
  );
}

function History_({ subjects }) {
  const [page, setPage] = useState(1);
  const [subject, setSubject] = useState('');
  const [status, setStatus] = useState('');
  const [correct, setCorrect] = useState(null);
  const { data, isLoading, error, refetch } = useGetAttendanceRecordsQuery({ page, limit: 15, subject: subject || undefined, status: status || undefined });

  return (
    <Card>
      <CardHeader
        title="Day-by-day history"
        action={
          <div className="flex flex-wrap gap-2">
            <select aria-label="Subject" className="input w-auto rounded-xl py-1.5 text-xs" value={subject} onChange={(e) => { setSubject(e.target.value); setPage(1); }}>
              <option value="">All subjects</option>
              {subjects.map((s) => (
                <option key={s.subject._id} value={s.subject._id}>
                  {s.subject.code}
                </option>
              ))}
            </select>
            <select aria-label="Status" className="input w-auto rounded-xl py-1.5 text-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Present & absent</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
            </select>
          </div>
        }
      />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.records.length ? (
        <EmptyState icon={History} title="No attendance records" text="Records appear here as soon as your faculty marks a class." />
      ) : (
        <>
          <ul className="divide-y divide-white/60 dark:divide-white/5">
            {data.records.map((r) => (
              <li key={r._id} className="flex items-center gap-3 py-2.5">
                {r.status === 'present' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <XCircle className="h-5 w-5 shrink-0 text-rose-500" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {r.subject?.code} · {r.subject?.name}
                  </p>
                  <p className="text-xs muted">
                    {fmtClassDay(r.date, 'EEE, dd MMM yyyy')} · Period {r.period}
                    {r.correctedAt ? ' · corrected' : ''}
                  </p>
                </div>
                <StatusBadge status={r.status} />
                <Button size="sm" variant="ghost" onClick={() => setCorrect(r)} aria-label="Request correction">
                  Dispute
                </Button>
              </li>
            ))}
          </ul>
          <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
        </>
      )}
      <CorrectionModal record={correct} onClose={() => setCorrect(null)} />
    </Card>
  );
}

function MyCorrections() {
  const { data, isLoading } = useGetCorrectionsQuery({ limit: 10 });
  if (isLoading) return <Skeleton className="h-32" />;
  if (!data?.requests?.length) return null;
  return (
    <Card>
      <CardHeader title="My correction requests" />
      <ul className="space-y-2">
        {data.requests.map((c) => (
          <li key={c._id} className="rounded-2xl bg-white/50 p-3 dark:bg-white/5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {c.subject?.code} · {fmtClassDay(c.date)} · P{c.period}
              </p>
              <StatusBadge status={c.status} />
            </div>
            <p className="mt-1 text-xs muted">
              {c.currentStatus} → {c.requestedStatus} · “{c.reason}”
            </p>
            {c.reviewNote && <p className="mt-1 text-xs">Reviewer: {c.reviewNote}</p>}
            <p className="mt-1 text-[11px] muted">{fmtDateTime(c.createdAt)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function StudentAttendance() {
  const me = useSelector(selectUser);
  const [range, setRange] = useState({ range: 'semester' });
  const [groupBy, setGroupBy] = useState('week');
  const params = rangeParams(range);
  const { data, isLoading, error, refetch } = useGetMyAttendanceQuery(params);
  const { data: trend } = useGetAttendanceTrendsQuery({ ...params, groupBy });

  const header = (
    <PageHeader
      icon={ClipboardCheck}
      title="My attendance"
      subtitle={me.section ? `${me.department} · Section ${me.section}` : 'Attendance across all your subjects'}
      actions={<RangeFilter value={range} onChange={setRange} />}
    />
  );
  if (isLoading) return <div>{header}<Skeleton className="h-64" /></div>;
  if (error) return <div>{header}<ErrorState error={error} onRetry={refetch} /></div>;

  const o = data.overall;
  const low = o.totalPeriods > 0 && o.percentage < data.threshold;

  return (
    <div className="space-y-5">
      {header}

      {low && (
        <div role="alert" className="flex items-start gap-3 rounded-3xl border border-rose-300/60 bg-rose-500/10 p-4 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Your attendance is below {data.threshold}%.</p>
            <p>
              Attend the next {o.mustAttend} class{o.mustAttend === 1 ? '' : 'es'} without missing any to get back to {data.threshold}%.
              {data.belowThreshold.length > 0 && ` Low in: ${data.belowThreshold.map((s) => s.subject.code).join(', ')}.`}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col 2xl:flex-row">
          <PercentRing value={o.percentage} threshold={data.threshold} sub={`${o.presentPeriods}/${o.totalPeriods} periods`} />
          <div className="grid w-full grid-cols-2 gap-2">
            <MiniStat label="Present" value={o.presentPeriods} icon={CheckCircle2} tone="text-emerald-600 bg-emerald-500/10" />
            <MiniStat label="Absent" value={o.absentPeriods} icon={XCircle} tone="text-rose-600 bg-rose-500/10" />
            <MiniStat label="Conducted" value={o.totalPeriods} icon={CalendarCheck2} />
            <MiniStat
              label={low ? 'Must attend' : 'Can miss'}
              value={low ? o.mustAttend : o.canMiss}
              hint={`to stay ≥ ${data.threshold}%`}
              icon={AlertTriangle}
              tone={low ? 'text-rose-600 bg-rose-500/10' : 'text-amber-600 bg-amber-500/10'}
            />
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Subject-wise" subtitle="Present ÷ conducted periods per subject" />
          {data.subjects.length ? (
            <PercentBars
              threshold={data.threshold}
              rows={data.subjects.map((s) => ({ key: s._id, label: `${s.subject.code} · ${s.subject.name}`, value: s.percentage, sub: `${s.presentPeriods}/${s.totalPeriods}` }))}
            />
          ) : (
            <EmptyState icon={ClipboardCheck} title="No classes recorded in this period" />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Trend"
          subtitle="Attendance % over time"
          action={<Tabs tabs={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} value={groupBy} onChange={setGroupBy} />}
        />
        {trend?.length ? <PercentTrend data={trend} xKey="_id" groupBy={groupBy} threshold={data.threshold} /> : <p className="py-10 text-center text-sm muted">No data for this period yet.</p>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <History_ subjects={data.subjects} />
        </div>
        <MyCorrections />
      </div>
    </div>
  );
}
