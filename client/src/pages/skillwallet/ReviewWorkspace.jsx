import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Award, ClipboardCheck, FolderKanban, Search } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, FullImage, PageHeader, PageLoader, Pagination, Skeleton, Tabs } from '../../components/ui/primitives';
import { Field, Input, Textarea } from '../../components/ui/form';
import {
  useDecideSwCertMutation,
  useGetSwCertForReviewQuery,
  useGetSwCertQueueQuery,
  useGetSwReviewProjectQuery,
  useGetSwReviewQueueQuery,
  useGetSwReviewerRolesQuery,
  useSubmitSwReviewMutation,
} from '../../services/skillWallet';
import { displayName, errMsg, fmtClassDay, fmtDateTime, titleCase } from '../../utils/format';
import { Dates, SafeExternalLink, SectionNote, StatusBadge } from './components';

function ProjectQueue() {
  const [status, setStatus] = useState('submitted');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useGetSwReviewQueueQuery({ status, mine: mine ? 'true' : undefined, q: q || undefined, page });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={status} onChange={(s) => { setStatus(s); setPage(1); }} tabs={[{ value: 'submitted', label: 'Waiting' }, { value: 'changes_requested', label: 'Changes requested' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }]} />
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} /> Assigned to me
        </label>
        <Input className="min-w-[200px] flex-1" icon={Search} aria-label="Search projects" placeholder="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      {isLoading ? <Skeleton className="h-48" /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data.items.length ? (
        <Card><EmptyState icon={FolderKanban} title="Nothing in this queue" /></Card>
      ) : (
        <>
          <Card className="divide-y divide-white/50 p-0 dark:divide-white/10">
            {data.items.map((p) => (
              <Link key={p._id} to={`/skill-wallet/review/projects/${p._id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-primary-500/5">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{p.title}</p>
                  <p className="text-xs muted">
                    {p.domain?.label} · {displayName(p.owner)} {p.owner?.rollNo ? `(${p.owner.rollNo})` : ''} · {p.department} · revision {p.revision}
                    {p.review.submittedAt ? ` · submitted ${fmtDateTime(p.review.submittedAt)}` : ''}
                  </p>
                </div>
                {p.assignedToMe && <Badge color="info">Assigned to you</Badge>}
                {p.reviewedByMe && <Badge color="success">You reviewed</Badge>}
                <StatusBadge kind="review" status={p.review.status} />
              </Link>
            ))}
          </Card>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function CertDecision({ id, onClose }) {
  const { data, isLoading, error, refetch } = useGetSwCertForReviewQuery(id, { skip: !id });
  const [decide, { isLoading: saving }] = useDecideSwCertMutation();
  const [reason, setReason] = useState('');
  const send = async (decision) => {
    if (decision !== 'verified' && reason.trim().length < 5) return toast.error('Give the student a reason (at least 5 characters)');
    try {
      // The decision applies only to the version shown here.
      await decide({ id, decision, reason: reason.trim(), version: data?.version }).unwrap();
      toast.success('Decision recorded');
      setReason('');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
      // Changed by the student meanwhile: show the current version before deciding again.
      if (e?.status === 409) refetch();
    }
  };
  return (
    <Modal
      open={Boolean(id)}
      onClose={onClose}
      size="lg"
      title="Verify NPTEL certificate"
      subtitle="Compare the image with the hall ticket, the course details and the student."
      footer={
        data?.status === 'pending' ? (
          <>
            <Button variant="outline" loading={saving} onClick={() => send('correction_requested')}>Request correction</Button>
            <Button variant="danger" loading={saving} onClick={() => send('rejected')}>Reject</Button>
            <Button variant="success" loading={saving} onClick={() => send('verified')}>Mark verified</Button>
          </>
        ) : null
      }
    >
      {isLoading || (!data && !error) ? <Skeleton className="h-64" /> : error ? <ErrorState error={error} /> : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="muted">Student</dt><dd className="font-semibold">{data.student?.name} · {data.student?.rollNo}</dd></div>
            <div><dt className="muted">Class</dt><dd className="font-semibold">{data.student?.department} · Year {data.student?.year} · {data.student?.section}</dd></div>
            <div><dt className="muted">Hall ticket</dt><dd className="font-semibold">{data.hallTicket}</dd></div>
            <div><dt className="muted">Course</dt><dd className="font-semibold">{data.courseName}</dd></div>
            <div><dt className="muted">Institution</dt><dd className="font-semibold">{data.institution?.label}</dd></div>
            <div><dt className="muted">Dates</dt><dd className="font-semibold">{fmtClassDay(data.startDate)} – {fmtClassDay(data.endDate)} · {data.durationWeeks} wk · {data.credits} cr</dd></div>
          </dl>
          {data.imageUrl && <FullImage src={data.imageUrl} alt="Submitted certificate" className="max-h-[60vh] rounded-2xl" />}
          <SectionNote>No official NPTEL verification service is connected. Verify manually against the certificate (and the NPTEL site where needed).</SectionNote>
          {data.status === 'pending' ? (
            <Textarea label="Reason / note to the student" hint="Required to reject or request a correction" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          ) : (
            <p className="text-sm">Current status: <StatusBadge kind="cert" status={data.status} /></p>
          )}
          <div>
            <p className="section-title mb-2">History</p>
            <ol className="space-y-1 text-xs">
              {data.history.map((h) => <li key={h._id}><b>{titleCase(h.action)}</b> · {h.actor?.name} · {fmtDateTime(h.createdAt)}{h.reason ? ` — ${h.reason}` : ''}</li>)}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CertQueue() {
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const { data, isLoading, error, refetch } = useGetSwCertQueueQuery({ status, q: q || undefined, page });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={status} onChange={(s) => { setStatus(s); setPage(1); }} tabs={[{ value: 'pending', label: 'Pending' }, { value: 'correction_requested', label: 'Correction requested' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' }]} />
        <Input className="min-w-[200px] flex-1" icon={Search} aria-label="Search by course, student or roll number" placeholder="Course, student or roll no." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      {isLoading ? <Skeleton className="h-48" /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data.items.length ? (
        <Card><EmptyState icon={Award} title="No certificates here" /></Card>
      ) : (
        <>
          <Card className="divide-y divide-white/50 p-0 dark:divide-white/10">
            {data.items.map((c) => (
              <button key={c._id} type="button" onClick={() => setOpen(c._id)} className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left hover:bg-primary-500/5">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{c.courseName}</p>
                  <p className="text-xs muted">{c.student?.name} · {c.student?.rollNo} · {c.student?.department} · {c.institution?.label}</p>
                </div>
                <StatusBadge kind="cert" status={c.status} />
              </button>
            ))}
          </Card>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      )}
      <CertDecision id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Faculty Review Workspace — tabs appear for the roles the server reports. */
export default function ReviewWorkspace() {
  const { data: roles, isLoading, error } = useGetSwReviewerRolesQuery();
  const [params, setParams] = useSearchParams();
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} />;
  const tabs = [
    roles.canReviewProjects && { value: 'projects', label: 'Project reviews' },
    roles.canVerifyCertificates && { value: 'certificates', label: 'NPTEL verification' },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value;
  return (
    <div>
      <PageHeader
        title="Faculty Review Workspace"
        subtitle="Review student projects and verify NPTEL certificates you are responsible for"
        icon={ClipboardCheck}
        actions={roles.isCoordinator || roles.canManageDesignations ? <Button variant="soft" to="/skill-wallet/manage">Innovation Management</Button> : null}
      />
      {!tabs.length ? (
        <Card><EmptyState icon={ClipboardCheck} title="No review role" text="HODs review their department; Class In-Charges verify certificates for their class. The Principal can designate other reviewers and verifiers." /></Card>
      ) : (
        <>
          {tabs.length > 1 && <Tabs className="mb-5" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={tabs} />}
          {tab === 'projects' ? <ProjectQueue /> : <CertQueue />}
        </>
      )}
    </div>
  );
}

/** Review one project: evidence, rubric scoring, feedback, decision. */
export function ReviewProject() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: p, isLoading, error, refetch } = useGetSwReviewProjectQuery(id);
  const [submit, { isLoading: saving }] = useSubmitSwReviewMutation();
  const [scores, setScores] = useState({});
  const [form, setForm] = useState({ feedback: '', internalNotes: '', decision: 'approve', reason: '', recommendFunding: false, recommendIncubation: false });
  const total = useMemo(() => {
    if (!p) return 0;
    return Math.round(p.rubric.criteria.reduce((sum, c) => sum + (Number(scores[c.key]) || 0) * c.weight / 10, 0));
  }, [p, scores]);
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const complete = p.rubric.criteria.every((c) => scores[c.key] !== undefined && scores[c.key] !== '');
  const send = async (e) => {
    e.preventDefault();
    if (!complete) return toast.error('Score every rubric criterion (0–10)');
    if (form.decision !== 'approve' && form.reason.trim().length < 5) return toast.error('Give a reason for this decision');
    try {
      const r = await submit({ id: p._id, revision: p.revision, scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Number(v)])), ...form }).unwrap();
      toast.success(r.status === 'approved' ? 'Approved — the team decides whether to publish' : 'Review recorded');
      navigate('/skill-wallet/review');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div>
      <Button variant="ghost" size="sm" icon={ArrowLeft} className="mb-3" onClick={() => navigate('/skill-wallet/review')}>Review queue</Button>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{p.title}</h1>
          <p className="text-sm muted">{p.domain?.label} · {p.department} · revision {p.revision} · <StatusBadge kind="review" status={p.review.status} /></p>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <div className="space-y-5">
          <Card className="space-y-4">
            {p.imageUrl && <FullImage src={p.imageUrl} alt={`${p.title} project image`} className="max-h-96 rounded-2xl" />}
            <p className="whitespace-pre-line text-sm leading-relaxed">{p.description}</p>
            <p className="text-sm"><span className="muted">Stage:</span> <b>{titleCase(p.stage)}</b> · <Dates {...p} /></p>
            {p.skills?.length > 0 && <div className="flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>}
            <div className="flex flex-wrap gap-4 text-sm">
              {p.githubUrl && <SafeExternalLink href={p.githubUrl}>GitHub repository</SafeExternalLink>}
              {p.driveUrl && <SafeExternalLink href={p.driveUrl}>Google Drive (access depends on sharing)</SafeExternalLink>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Team" />
            <ul className="space-y-1 text-sm">
              {p.team.map((m) => <li key={m.user._id}><b>{displayName(m.user)}</b> <span className="muted">· {m.user.rollNo} · {m.user.department} · Year {m.user.year}{m.role === 'owner' ? ' · owner' : ''}</span></li>)}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Review history" subtitle="Internal notes are visible to reviewers and coordinators only" />
            {!p.reviews.length ? <p className="text-sm muted">No reviews yet.</p> : (
              <ul className="space-y-3 text-sm">
                {p.reviews.map((r) => (
                  <li key={r._id} className="rounded-2xl bg-primary-500/5 p-3">
                    <p><b>{displayName(r.reviewer)}</b> · revision {r.revision} · {fmtDateTime(r.createdAt)} · <Badge color={r.decision === 'approve' ? 'success' : r.decision === 'reject' ? 'danger' : 'warning'}>{titleCase(r.decision)}</Badge> · score {Math.round(r.totalScore)} (rubric v{r.rubricVersion})</p>
                    {r.feedback && <p className="mt-1">Feedback: {r.feedback}</p>}
                    {r.internalNotes && <p className="mt-1 text-amber-800 dark:text-amber-200">Internal: {r.internalNotes}</p>}
                    {r.reason && <p className="mt-1">Reason: {r.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {p.milestones.length > 0 && (
            <Card>
              <CardHeader title="Claimed milestones" />
              <ul className="space-y-1 text-sm">{p.milestones.map((m) => <li key={m._id}>{m.title} · {titleCase(m.kind)} · <b>{titleCase(m.status)}</b></li>)}</ul>
            </Card>
          )}
        </div>
        <Card as="form" onSubmit={send} className="h-fit space-y-4 lg:sticky lg:top-4">
          <CardHeader title="Your review" subtitle={`Rubric v${p.rubric.version} · weights are institutional defaults`} />
          {!p.canDecide ? (
            <SectionNote tone="warning">{p.review.submittedRevision === p.revision ? 'You are not assigned to decide this project.' : 'The team has edited the project since submitting. Wait for them to submit the new revision.'}</SectionNote>
          ) : (
            <>
              {p.rubric.criteria.map((c) => (
                <Field key={c.key} label={`${c.label} (${c.weight}%)`}>
                  <div className="flex items-center gap-3">
                    <input type="range" min={0} max={10} step={1} className="flex-1" aria-label={`${c.label} score`} value={scores[c.key] ?? 0} onChange={(e) => setScores((s) => ({ ...s, [c.key]: e.target.value }))} />
                    <span className="w-10 text-right font-bold">{scores[c.key] ?? '—'}</span>
                  </div>
                </Field>
              ))}
              <p className="text-sm">Weighted total: <b>{complete ? total : '—'}/100</b></p>
              <Textarea label="Feedback to the team" rows={3} maxLength={3000} value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })} />
              <Textarea label="Internal notes (not shown to students)" rows={2} maxLength={3000} value={form.internalNotes} onChange={(e) => setForm({ ...form, internalNotes: e.target.value })} />
              <Field label="Decision">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Decision">
                  {[{ value: 'approve', label: 'Approve' }, { value: 'request_changes', label: 'Request changes' }, { value: 'reject', label: 'Reject' }].map((o) => (
                    <label key={o.value} className={`chip cursor-pointer ${form.decision === o.value ? 'chip-active' : ''}`}>
                      <input type="radio" className="sr-only" name="decision" value={o.value} checked={form.decision === o.value} onChange={() => setForm({ ...form, decision: o.value })} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </Field>
              {form.decision !== 'approve' && <Textarea label="Reason (shown to the team)" rows={2} maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.recommendFunding} onChange={(e) => setForm({ ...form, recommendFunding: e.target.checked })} /> Recommend for funding</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.recommendIncubation} onChange={(e) => setForm({ ...form, recommendIncubation: e.target.checked })} /> Recommend for IIC / incubation</label>
              <p className="text-xs muted">Recommendations go to innovation coordinators; they do not allocate funding. Approval does not publish the project.</p>
              <Button type="submit" loading={saving} className="w-full">Submit review</Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
