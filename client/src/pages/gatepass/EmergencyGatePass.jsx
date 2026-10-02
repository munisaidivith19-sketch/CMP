import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { CheckCircle2, FileText, QrCode, Siren } from 'lucide-react';
import { useCreateEmergencyGatePassMutation, useGetGatePassQrQuery, useUploadFileMutation } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Badge, Button, Skeleton } from '../../components/ui/primitives';
import { Input, Select, Textarea } from '../../components/ui/form';
import { YEAR_LABELS } from '../../utils/constants';
import { errMsg, fmtDateTime, timeAgo, todayKey } from '../../utils/format';

export const AUTHORITY_LABELS = { principal: 'PRINCIPAL', ao: 'AO', dean: 'DEAN', chairman: 'CHAIRMAN' };
const AUTHORITY_OPTIONS = Object.entries(AUTHORITY_LABELS).map(([value, label]) => ({ value, label }));
const nowTime = () => new Date().toTimeString().slice(0, 5);
const toIso = (day, time) => new Date(`${day}T${time}`).toISOString();

export const isEmergency = (pass) => pass?.passType === 'emergency';
export const EmergencyBadge = () => (
  <Badge color="danger" icon={Siren}>
    Emergency
  </Badge>
);

/** Read-only facts about the requester: always the signed-in student's own record. */
function StudentFacts({ student }) {
  const facts = [
    ['Student name', student?.name],
    ['Roll number', student?.rollNo],
    ['Department', student?.department],
    ['Year', YEAR_LABELS[student?.year] || student?.year],
    ['Section', student?.section],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl bg-white/50 p-3 text-xs dark:bg-white/5 sm:grid-cols-3">
      {facts.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="muted">{label}</dt>
          <dd className="break-words font-bold">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Emergency request form. Rendered inside the existing "Request a gate pass" modal. */
export function EmergencyRequestForm({ formId, onSubmitted, onBusy }) {
  const me = useSelector(selectUser);
  const [create, { isLoading }] = useCreateEmergencyGatePassMutation();
  const [upload, { isLoading: uploading }] = useUploadFileMutation();
  const [doc, setDoc] = useState(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: { authority: '', reason: '', destination: '', date: todayKey(), leaveTime: nowTime(), returnDate: todayKey(), returnTime: '' } });

  useEffect(() => onBusy?.(isLoading || uploading), [isLoading, uploading, onBusy]);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setDoc(await upload({ file, kind: 'document' }).unwrap());
    } catch (err) {
      toast.error(errMsg(err, 'Could not upload the document'));
    }
  };

  const onSubmit = async (v) => {
    const leaveAt = toIso(v.date, v.leaveTime);
    const expectedReturnAt = toIso(v.returnDate, v.returnTime);
    if (new Date(expectedReturnAt) <= new Date(leaveAt)) {
      toast.error('Expected return must be after the leaving time');
      return;
    }
    try {
      await create({
        authority: v.authority,
        reason: v.reason,
        destination: v.destination,
        leaveAt,
        expectedReturnAt,
        ...(doc ? { supportingDocument: { url: doc.url, name: doc.name, mimeType: doc.mimeType } } : {}),
      }).unwrap();
      toast.success(`Emergency gate pass sent to the ${AUTHORITY_LABELS[v.authority]}`);
      onSubmitted?.();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <StudentFacts student={me} />
      </div>
      <Select
        label="Authority to escalate to"
        className="sm:col-span-2"
        placeholder="Select authority"
        keepCase
        options={AUTHORITY_OPTIONS}
        error={errors.authority}
        {...register('authority', { required: 'Choose who should approve it' })}
      />
      <Textarea
        label="Reason"
        className="sm:col-span-2"
        rows={3}
        maxLength={500}
        placeholder="What is the emergency?"
        error={errors.reason}
        {...register('reason', { required: 'Please describe the emergency', minLength: { value: 5, message: 'At least 5 characters' } })}
      />
      <Input label="Destination" className="sm:col-span-2" maxLength={120} error={errors.destination} {...register('destination', { required: 'Required', minLength: { value: 2, message: 'Required' } })} />
      <Input label="Date" type="date" min={todayKey()} error={errors.date} {...register('date', { required: 'Required' })} />
      <Input label="Requested leaving time" type="time" error={errors.leaveTime} {...register('leaveTime', { required: 'Required' })} />
      <Input label="Return date" type="date" min={watch('date') || todayKey()} error={errors.returnDate} {...register('returnDate', { required: 'Required' })} />
      <Input label="Expected return time" type="time" error={errors.returnTime} {...register('returnTime', { required: 'Required' })} />
      <div className="sm:col-span-2">
        <span className="label">Supporting document (optional)</span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn btn-soft cursor-pointer px-3 py-1.5 text-xs">
            <FileText className="h-4 w-4" />
            {uploading ? 'Uploading…' : doc ? 'Replace file' : 'Attach image or PDF'}
            <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={pickFile} disabled={uploading} />
          </label>
          {doc && <span className="min-w-0 break-all text-xs muted">{doc.name}</span>}
        </div>
      </div>
    </form>
  );
}

/** Emergency facts for reviewers and the detail page. */
export function EmergencyDetails({ pass, compact = false }) {
  const s = pass.student || {};
  const rows = [
    ['Roll number', s.rollNo],
    ['Department', s.department || pass.department],
    ['Year', YEAR_LABELS[s.year] || s.year],
    ['Section', s.section || pass.section],
    ['Destination', pass.destination?.area],
    ['Leaving', fmtDateTime(pass.leaveAt)],
    ['Expected return', fmtDateTime(pass.expectedReturnAt)],
    ['Sent to', AUTHORITY_LABELS[pass.emergencyAuthority]],
    ['Requested', timeAgo(pass.createdAt)],
  ];
  return (
    <div className="space-y-2">
      {!compact && (
        <p className="break-words text-sm">
          <span className="font-bold">Reason:</span> {pass.description}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="muted">{label}</dt>
            <dd className="break-words font-bold">{value || '—'}</dd>
          </div>
        ))}
      </dl>
      {pass.supportingDocument?.url && (
        <a href={pass.supportingDocument.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-xs font-semibold text-primary-600 hover:underline">
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{pass.supportingDocument.name || 'Supporting document'}</span>
        </a>
      )}
    </div>
  );
}

/** Approved emergency pass: the one issued code, with the QR on request. */
export function EmergencyApprovedCode({ pass }) {
  const { data, isLoading, error } = useGetGatePassQrQuery(pass._id);
  const [showQr, setShowQr] = useState(false);
  if (isLoading) return <Skeleton className="mx-auto h-40 w-full max-w-xs" />;
  if (error) return <p className="text-center text-sm text-rose-600">{errMsg(error)}</p>;
  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <p className="flex items-center gap-1.5 font-extrabold uppercase tracking-wide text-emerald-600">
        <CheckCircle2 className="h-5 w-5 shrink-0" /> Emergency gate pass approved
      </p>
      <p className="text-sm">
        Approved by: <span className="font-bold">{AUTHORITY_LABELS[pass.emergencyAuthority]}</span>
      </p>
      <p className="text-xs font-bold uppercase tracking-wide muted">Gate pass code</p>
      <p className="font-mono text-4xl font-extrabold tracking-[0.3em]">{data.code}</p>
      {showQr && (
        <div className="rounded-3xl bg-white p-3 shadow-soft">
          <img src={data.qr} alt="Gate pass QR code" className="h-52 w-52 max-w-full" />
        </div>
      )}
      <Button variant="soft" icon={QrCode} onClick={() => setShowQr((v) => !v)}>
        {showQr ? 'Hide QR' : 'Show QR'}
      </Button>
      <p className="text-xs muted">Present this code or QR to Security.</p>
    </div>
  );
}
