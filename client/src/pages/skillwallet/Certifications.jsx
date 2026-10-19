import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Award, FileImage, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Button, Card, EmptyState, ErrorState, FullImage, Skeleton } from '../../components/ui/primitives';
import { Field, Input, Select } from '../../components/ui/form';
import { useDeleteMyCertificationMutation, useGetMyCertificationQuery, useGetMyCertificationsQuery, useGetSwConfigQuery, useSkillWalletUpload } from '../../services/skillWallet';
import { errMsg, fmtClassDay, fmtDateTime } from '../../utils/format';
import { CERT_ACCEPT, isRealDay, precheckImage, toDayInput, todayDay } from '../../utils/skillWallet';
import { SectionNote, StatusBadge, UploadProgress } from './components';

const blank = { hallTicket: '', courseName: '', startDate: '', endDate: '', durationWeeks: '', credits: '', institution: '', institutionOther: '' };

/** NPTEL certificate form: fields + image sent together with real upload progress. */
function CertificateForm({ open, onClose, cert }) {
  const editing = Boolean(cert);
  const { data: config } = useGetSwConfigQuery();
  const upload = useSkillWalletUpload();
  const inputRef = useRef(null);
  const [v, setV] = useState(blank);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState(null);
  const today = todayDay();

  useEffect(() => {
    if (!open) return;
    setV(
      cert
        ? {
            hallTicket: '',
            courseName: cert.courseName,
            startDate: toDayInput(cert.startDate),
            endDate: toDayInput(cert.endDate),
            durationWeeks: String(cert.durationWeeks ?? ''),
            credits: String(cert.credits ?? ''),
            institution: cert.institution?.key || '',
            institutionOther: cert.institutionOther || '',
          }
        : blank
    );
    setFile(null);
    setErrors({});
    setProgress(null);
  }, [open, cert]);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const institutions = useMemo(
    () => (config?.institutions || []).filter((i) => i.active !== false || i.key === v.institution).map((i) => ({ value: i.key, label: i.label })),
    [config, v.institution]
  );
  const set = (k) => (e) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    setErrors((s) => ({ ...s, [k]: undefined }));
  };

  const pick = (f) => {
    if (!f) return;
    const problem = precheckImage(f, { maxMb: 5 });
    if (problem) {
      setErrors((s) => ({ ...s, file: problem }));
      return;
    }
    setErrors((s) => ({ ...s, file: undefined }));
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    setFile(f);
  };

  const validate = () => {
    const e = {};
    const ht = v.hallTicket.toUpperCase().replace(/[\s-]+/g, '');
    if (!editing || ht) if (!/^[A-Z0-9]{6,30}$/.test(ht)) e.hallTicket = 'Enter the hall ticket number as printed (6–30 letters and digits)';
    if (v.courseName.trim().length < 3) e.courseName = 'Enter the course name';
    if (!isRealDay(v.startDate)) e.startDate = 'Choose the course start date';
    if (!isRealDay(v.endDate)) e.endDate = 'Choose the course end date';
    else if (isRealDay(v.startDate) && v.endDate < v.startDate) e.endDate = 'The end date cannot be earlier than the start date';
    else if (v.endDate > today) e.endDate = 'The end date cannot be in the future';
    const w = Number(v.durationWeeks);
    if (!Number.isInteger(w) || w < 1 || w > 24) e.durationWeeks = '1–24 weeks';
    const c = Number(v.credits);
    if (v.credits === '' || !Number.isFinite(c) || c < 0 || c > 20 || Math.round(c * 2) !== c * 2) e.credits = '0–20, in steps of 0.5';
    if (!v.institution) e.institution = 'Choose the institution';
    if (v.institution === 'other' && v.institutionOther.trim().length < 2) e.institutionOther = 'Name the institution';
    if (!editing && !file) e.file = 'Attach the certificate image';
    return e;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    const form = new FormData();
    for (const [k, val] of Object.entries(v)) {
      if (k === 'hallTicket' && editing && !val) continue;
      if (k === 'institutionOther' && v.institution !== 'other') continue;
      form.append(k, val);
    }
    if (file) form.append('file', file);
    setProgress(0);
    try {
      await upload({
        url: editing ? `/skill-wallet/certifications/${cert._id}` : '/skill-wallet/certifications',
        method: editing ? 'PUT' : 'POST',
        form,
        onProgress: setProgress,
        invalidates: [{ type: 'SWCert', id: 'LIST' }, { type: 'SWCert', id: cert?._id }],
      });
      toast.success(editing ? 'Certificate updated — sent for verification again' : 'Certificate submitted for verification');
      onClose();
    } catch (err) {
      setProgress(null);
      toast.error(errMsg(err, 'The certificate could not be saved'));
      setErrors((s) => ({ ...s, form: errMsg(err, 'The certificate could not be saved') }));
    }
  };

  const busy = progress !== null;
  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      size="lg"
      title={editing ? 'Edit NPTEL certificate' : 'Add NPTEL certificate'}
      subtitle="Uploading does not verify a certificate — a verifier checks it against the image and your college record."
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="sw-cert-form" loading={busy}>{editing ? 'Save and resubmit' : 'Submit for verification'}</Button>
        </>
      }
    >
      <form id="sw-cert-form" noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input
          label={editing ? 'Hall ticket number (leave blank to keep)' : 'Hall ticket number *'}
          placeholder={editing ? cert.hallTicketMasked || '' : 'As printed on the certificate'}
          value={v.hallTicket}
          onChange={set('hallTicket')}
          autoComplete="off"
          error={errors.hallTicket}
          hint="Kept private: never shown on your portfolio or the gallery"
        />
        <Input label="Course name *" value={v.courseName} onChange={set('courseName')} maxLength={200} error={errors.courseName} />
        <Input type="date" label="Course start date *" max={today} value={v.startDate} onChange={set('startDate')} error={errors.startDate} />
        <Input type="date" label="Course end date *" min={v.startDate || undefined} max={today} value={v.endDate} onChange={set('endDate')} error={errors.endDate} />
        <Input type="number" label="Duration (weeks) *" min={1} max={24} step={1} value={v.durationWeeks} onChange={set('durationWeeks')} error={errors.durationWeeks} />
        <Input type="number" label="Credits *" min={0} max={20} step={0.5} value={v.credits} onChange={set('credits')} error={errors.credits} />
        <Select label="Course-offering institution *" placeholder="Choose institution" options={institutions} keepCase value={v.institution} onChange={set('institution')} error={errors.institution} />
        {v.institution === 'other' ? (
          <Input label="Institution name *" value={v.institutionOther} onChange={set('institutionOther')} maxLength={120} error={errors.institutionOther} />
        ) : (
          <span />
        )}
        <Field label={editing ? 'Certificate image (optional — replaces the current one)' : 'Certificate image *'} error={errors.file} hint="PNG, JPEG or WebP · max 5 MB. Stored as WebP after a server check. PDF, SVG, GIF, HEIC, BMP and TIFF are refused." className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" icon={FileImage} onClick={() => inputRef.current?.click()} disabled={busy}>
              {file ? 'Choose another image' : 'Choose image'}
            </Button>
            {file && <span className="truncate text-sm muted">{file.name}</span>}
          </div>
          {preview && <FullImage src={preview} alt="Selected certificate" className="mt-3 max-h-64 rounded-2xl" />}
          <input ref={inputRef} type="file" accept={CERT_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </Field>
        {busy && (
          <div className="sm:col-span-2">
            <UploadProgress progress={progress} label="Uploading certificate" />
          </div>
        )}
        {errors.form && !busy && (
          <p role="alert" className="text-sm font-semibold text-rose-600 sm:col-span-2">
            {errors.form} — check the file and try again.
          </p>
        )}
      </form>
    </Modal>
  );
}

function CertificateDetail({ id, onClose }) {
  const { data, isLoading, error } = useGetMyCertificationQuery(id, { skip: !id });
  return (
    <Modal open={Boolean(id)} onClose={onClose} size="lg" title={data?.courseName || 'Certificate'}>
      {isLoading || (!data && !error) ? (
        <Skeleton className="h-64" />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <StatusBadge kind="cert" status={data.status} />
          </div>
          {data.decisionReason && <SectionNote tone={data.status === 'verified' ? 'info' : 'warning'}>Verifier: {data.decisionReason}</SectionNote>}
          {data.imageUrl && <FullImage src={data.imageUrl} alt={`Certificate for ${data.courseName}`} className="max-h-[60vh] rounded-2xl" />}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="muted">Hall ticket</dt><dd className="font-semibold">{data.hallTicket}</dd></div>
            <div><dt className="muted">Institution</dt><dd className="font-semibold">{data.institution?.label}</dd></div>
            <div><dt className="muted">Course dates</dt><dd className="font-semibold">{fmtClassDay(data.startDate)} – {fmtClassDay(data.endDate)}</dd></div>
            <div><dt className="muted">Duration · credits</dt><dd className="font-semibold">{data.durationWeeks} weeks · {data.credits} credits</dd></div>
          </dl>
          <div>
            <p className="section-title mb-2">Verification history</p>
            <ol className="space-y-2 text-sm">
              {(data.history || []).map((h) => (
                <li key={h._id} className="rounded-2xl bg-primary-500/5 px-3 py-2">
                  <span className="font-semibold capitalize">{String(h.action).replace(/_/g, ' ')}</span>
                  <span className="muted"> · {h.actor?.name || '—'} · {fmtDateTime(h.createdAt)}</span>
                  {h.reason && <p className="mt-1">{h.reason}</p>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Certifications() {
  const { data, isLoading, error, refetch } = useGetMyCertificationsQuery();
  const [del, { isLoading: deleting }] = useDeleteMyCertificationMutation();
  const [form, setForm] = useState({ open: false, cert: null });
  const [viewing, setViewing] = useState(null);
  const [removing, setRemoving] = useState(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm muted">Add each NPTEL course you completed. A verifier marks it verified after checking the certificate.</p>
        <Button icon={Plus} onClick={() => setForm({ open: true, cert: null })}>Add certificate</Button>
      </div>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.items?.length ? (
        <Card><EmptyState icon={Award} title="No NPTEL certificates yet" text="Add a certificate with its hall ticket number and a PNG, JPEG or WebP image." /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.items.map((c) => (
            <Card key={c._id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="min-w-0 text-left" onClick={() => setViewing(c._id)}>
                  <p className="font-bold hover:underline">{c.courseName}</p>
                  <p className="text-xs muted">{c.institution?.label} · {c.durationWeeks} weeks · {c.credits} credits</p>
                </button>
                <StatusBadge kind="cert" status={c.status} />
              </div>
              <p className="text-xs muted">{fmtClassDay(c.startDate)} – {fmtClassDay(c.endDate)} · Hall ticket {c.hallTicketMasked}</p>
              {c.decisionReason && c.status !== 'verified' && <p className="text-sm text-amber-800 dark:text-amber-200">{c.decisionReason}</p>}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="soft" onClick={() => setViewing(c._id)}>View</Button>
                {c.canEdit && <Button size="sm" variant="outline" icon={Pencil} onClick={() => setForm({ open: true, cert: c })}>Edit</Button>}
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRemoving(c)}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <CertificateForm open={form.open} cert={form.cert} onClose={() => setForm({ open: false, cert: null })} />
      <CertificateDetail id={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        loading={deleting}
        title="Delete this certificate?"
        text="The certificate is withdrawn from your Skill Wallet and its image is deleted. A verified status is not kept. This cannot be undone."
        confirmText="Delete"
        onConfirm={async () => {
          try {
            await del(removing._id).unwrap();
            toast.success('Certificate deleted');
            setRemoving(null);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
