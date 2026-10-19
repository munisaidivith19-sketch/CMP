import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { EyeOff, Lightbulb, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageLoader, Pagination, Skeleton, StatCard, Tabs } from '../../components/ui/primitives';
import { Input, Select, Textarea } from '../../components/ui/form';
import {
  useAssignSwReviewersMutation,
  useDecideSwMilestoneMutation,
  useGetSwConfigQuery,
  useGetSwDesignationsQuery,
  useGetSwManagedProjectsQuery,
  useGetSwMilestonesQuery,
  useGetSwOverviewQuery,
  useGetSwRecommendationsQuery,
  useGetSwReportsQuery,
  useGetSwReviewerRolesQuery,
  useGrantSwDesignationMutation,
  useHideSwProjectMutation,
  useResolveSwReportMutation,
  useRevokeSwDesignationMutation,
  useSearchSwStaffQuery,
  useUnhideSwProjectMutation,
  useUpdateSwConfigMutation,
  useUpdateSwRecommendationMutation,
} from '../../services/skillWallet';
import { DEPARTMENTS } from '../../utils/constants';
import { displayName, errMsg, fmtDateTime, titleCase } from '../../utils/format';
import { SectionNote, StatusBadge } from './components';

function StaffPicker({ onPick, exclude = [] }) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useSearchSwStaffQuery(q, { skip: q.trim().length < 2 });
  return (
    <div className="space-y-2">
      <Input icon={Search} aria-label="Search staff" placeholder="Search faculty by name, ID or department" value={q} onChange={(e) => setQ(e.target.value)} />
      {isFetching && <p className="text-xs muted">Searching…</p>}
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {(data?.items || []).filter((u) => !exclude.includes(u._id)).map((u) => (
          <li key={u._id}>
            <button type="button" className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-primary-500/10" onClick={() => onPick(u)}>
              <span><b>{displayName(u)}</b> <span className="muted">· {titleCase(u.role)} · {u.department || '—'}</span></span>
              <Plus className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssignReviewers({ project, onClose }) {
  const [assign, { isLoading }] = useAssignSwReviewersMutation();
  const [list, setList] = useState([]);
  useEffect(() => setList(project?.review?.reviewers || []), [project]);
  return (
    <Modal
      open={Boolean(project)}
      onClose={onClose}
      title="Assign reviewers"
      subtitle={project?.title}
      footer={<Button loading={isLoading} onClick={async () => {
        try {
          await assign({ id: project._id, reviewerIds: list.map((r) => r._id) }).unwrap();
          toast.success('Reviewers updated');
          onClose();
        } catch (e) {
          toast.error(errMsg(e));
        }
      }}>Save</Button>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {list.length ? list.map((r) => (
            <span key={r._id} className="chip">{displayName(r)}<button type="button" aria-label={`Remove ${r.name}`} onClick={() => setList(list.filter((x) => x._id !== r._id))}><X className="h-3 w-3" /></button></span>
          )) : <span className="text-sm muted">No reviewers assigned. The department HOD can still review.</span>}
        </div>
        {list.length < 5 && <StaffPicker exclude={list.map((r) => r._id)} onPick={(u) => setList([...list, u])} />}
      </div>
    </Modal>
  );
}

function Projects() {
  const [q, setQ] = useState('');
  const [hidden, setHidden] = useState(false);
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useGetSwManagedProjectsQuery({ q: q || undefined, hidden: hidden ? 'true' : undefined, page });
  const [hide] = useHideSwProjectMutation();
  const [unhide] = useUnhideSwProjectMutation();
  const [assigning, setAssigning] = useState(null);
  const [hiding, setHiding] = useState(null);
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input className="min-w-[200px] flex-1" icon={Search} aria-label="Search projects" placeholder="Search submitted or published projects" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hidden only</label>
      </div>
      <SectionNote>Coordinators assign reviewers and may temporarily hide content. They never publish, unpublish or change review decisions. Private drafts that were never submitted are not listed.</SectionNote>
      {isLoading ? <Skeleton className="h-48" /> : error ? <ErrorState error={error} onRetry={refetch} /> : !data.items.length ? <Card><EmptyState title="No projects" /></Card> : (
        <>
          <Card className="divide-y divide-white/50 p-0 dark:divide-white/10">
            {data.items.map((p) => (
              <div key={p._id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <Link to={`/skill-wallet/review/projects/${p._id}`} className="font-bold hover:underline">{p.title}</Link>
                  <p className="text-xs muted">{displayName(p.owner)} · {p.department} · {titleCase(p.visibility)} · reviewers: {(p.review?.reviewers || []).map((r) => r.name).join(', ') || 'none'}</p>
                </div>
                <StatusBadge kind="review" status={p.review?.status} />
                {p.moderation?.hidden && <Badge color="danger" icon={EyeOff}>Hidden</Badge>}
                {p.review?.submittedRevision ? <Button size="sm" variant="soft" icon={UserPlus} onClick={() => setAssigning(p)}>Reviewers</Button> : null}
                {p.moderation?.hidden ? (
                  <Button size="sm" variant="outline" onClick={() => unhide({ id: p._id }).unwrap().then(() => toast.success('Visible again')).catch((e) => toast.error(errMsg(e)))}>Unhide</Button>
                ) : (
                  <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => { setHiding(p); setReason(''); }}>Hide</Button>
                )}
              </div>
            ))}
          </Card>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      )}
      <AssignReviewers project={assigning} onClose={() => setAssigning(null)} />
      <Modal open={Boolean(hiding)} onClose={() => setHiding(null)} size="sm" title="Hide temporarily" subtitle="Removes it from the gallery, search and leaderboards until unhidden. The team is told; the action is audited."
        footer={<Button variant="danger" disabled={reason.trim().length < 5} onClick={async () => {
          try {
            await hide({ id: hiding._id, reason: reason.trim() }).unwrap();
            toast.success('Project hidden');
            setHiding(null);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}>Hide project</Button>}>
        <Textarea label="Reason (shown to the team)" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}

function Recommendations() {
  const [status, setStatus] = useState('open');
  const { data, isLoading, error } = useGetSwRecommendationsQuery({ status });
  const [update] = useUpdateSwRecommendationMutation();
  return (
    <div className="space-y-4">
      <Tabs value={status} onChange={setStatus} tabs={[{ value: 'open', label: 'Open' }, { value: 'acknowledged', label: 'Acknowledged' }, { value: 'closed', label: 'Closed' }]} />
      <SectionNote>Recommendations are notes from reviewers. Recording them here does not approve, allocate or pay any funding.</SectionNote>
      {isLoading ? <Skeleton className="h-40" /> : error ? <ErrorState error={error} /> : !data.items.length ? <Card><EmptyState title="Nothing here" /></Card> : (
        <Card className="divide-y divide-white/50 p-0 dark:divide-white/10">
          {data.items.map((r) => (
            <div key={r._id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <Link to={`/skill-wallet/review/projects/${r.project?._id}`} className="font-bold hover:underline">{r.project?.title}</Link>
                <p className="text-xs muted">{r.kind === 'funding' ? 'Funding' : 'IIC / incubation'} · by {displayName(r.recommendedBy)} · {fmtDateTime(r.createdAt)}{r.handlingNote ? ` · note: ${r.handlingNote}` : ''}</p>
              </div>
              {status === 'open' && <Button size="sm" variant="soft" onClick={() => update({ id: r._id, status: 'acknowledged' }).unwrap().catch((e) => toast.error(errMsg(e)))}>Acknowledge</Button>}
              {status !== 'closed' && <Button size="sm" variant="ghost" onClick={() => update({ id: r._id, status: 'closed' }).unwrap().catch((e) => toast.error(errMsg(e)))}>Close</Button>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Milestones() {
  const [status, setStatus] = useState('claimed');
  const { data, isLoading, error } = useGetSwMilestonesQuery({ status });
  const [decide] = useDecideSwMilestoneMutation();
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  return (
    <div className="space-y-4">
      <Tabs value={status} onChange={setStatus} tabs={[{ value: 'claimed', label: 'Claimed' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' }]} />
      {isLoading ? <Skeleton className="h-40" /> : error ? <ErrorState error={error} /> : !data.items.length ? <Card><EmptyState title="Nothing here" /></Card> : (
        <Card className="divide-y divide-white/50 p-0 dark:divide-white/10">
          {data.items.map((m) => (
            <div key={m._id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{m.title} <span className="text-xs font-normal muted">· {titleCase(m.kind)}</span></p>
                <p className="text-xs muted">{m.project?.title} · claimed by {displayName(m.claimedBy)}{m.reference ? ` · ref ${m.reference}` : ''}</p>
              </div>
              {status === 'claimed' && (
                <>
                  <Button size="sm" variant="success" onClick={() => decide({ id: m._id, decision: 'verified' }).unwrap().then(() => toast.success('Verified')).catch((e) => toast.error(errMsg(e)))}>Verify</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setRejecting(m); setNote(''); }}>Reject</Button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}
      <Modal open={Boolean(rejecting)} onClose={() => setRejecting(null)} size="sm" title="Reject milestone"
        footer={<Button variant="danger" disabled={note.trim().length < 5} onClick={() => decide({ id: rejecting._id, decision: 'rejected', note: note.trim() }).unwrap().then(() => setRejecting(null)).catch((e) => toast.error(errMsg(e)))}>Reject</Button>}>
        <Textarea label="Reason" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </div>
  );
}

function Reports() {
  const [status, setStatus] = useState('open');
  const { data, isLoading, error } = useGetSwReportsQuery({ status });
  const [resolve] = useResolveSwReportMutation();
  const [acting, setActing] = useState(null);
  const [note, setNote] = useState('');
  return (
    <div className="space-y-4">
      <Tabs value={status} onChange={setStatus} tabs={[{ value: 'open', label: 'Open' }, { value: 'actioned', label: 'Actioned' }, { value: 'dismissed', label: 'Dismissed' }]} />
      {isLoading ? <Skeleton className="h-40" /> : error ? <ErrorState error={error} /> : !data.items.length ? <Card><EmptyState title="No reports" /></Card> : (
        <Card className="divide-y divide-white/50 p-0 dark:divide-white/10">
          {data.items.map((r) => (
            <div key={r._id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{r.project?.published?.title || r.project?.title} <Badge color="warning">{titleCase(r.reason)}</Badge></p>
                {r.comment && <p className="text-sm">Comment: “{r.comment.body}”</p>}
                {r.details && <p className="text-sm muted">{r.details}</p>}
                <p className="text-xs muted">Reported by {displayName(r.reporter)} · {fmtDateTime(r.createdAt)}</p>
              </div>
              {status === 'open' && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => resolve({ id: r._id, action: 'dismiss' }).unwrap().catch((e) => toast.error(errMsg(e)))}>Dismiss</Button>
                  {r.comment && <Button size="sm" variant="outline" onClick={() => { setActing({ r, action: 'hide_comment' }); setNote(''); }}>Hide comment</Button>}
                  <Button size="sm" variant="danger" onClick={() => { setActing({ r, action: 'hide_project' }); setNote(''); }}>Hide project</Button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}
      <Modal open={Boolean(acting)} onClose={() => setActing(null)} size="sm" title={acting?.action === 'hide_comment' ? 'Hide comment' : 'Hide project'}
        footer={<Button variant="danger" disabled={note.trim().length < 5} onClick={() => resolve({ id: acting.r._id, action: acting.action, note: note.trim() }).unwrap().then(() => { toast.success('Done'); setActing(null); }).catch((e) => toast.error(errMsg(e)))}>Confirm</Button>}>
        <Textarea label="Reason (recorded in the audit log)" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </div>
  );
}

const CAPS = [
  { value: 'innovation_coordinator', label: 'Innovation / IIC coordinator' },
  { value: 'project_reviewer', label: 'Project reviewer' },
  { value: 'certificate_verifier', label: 'Certificate verifier' },
];

function Designations() {
  const { data, isLoading, error } = useGetSwDesignationsQuery();
  const [grant, { isLoading: granting }] = useGrantSwDesignationMutation();
  const [revoke] = useRevokeSwDesignationMutation();
  const [form, setForm] = useState({ user: null, capability: 'project_reviewer', scope: 'department', department: DEPARTMENTS[0] });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Grant a role" subtitle="Faculty, HOD, Principal or Dean accounts only" />
        <div className="space-y-3">
          {form.user ? (
            <span className="chip">{displayName(form.user)}<button type="button" aria-label="Clear" onClick={() => setForm({ ...form, user: null })}><X className="h-3 w-3" /></button></span>
          ) : (
            <StaffPicker onPick={(u) => setForm({ ...form, user: u })} />
          )}
          <Select label="Role" options={CAPS} keepCase value={form.capability} onChange={(e) => setForm({ ...form, capability: e.target.value })} />
          <Select label="Scope" options={[{ value: 'department', label: 'One department' }, { value: 'campus', label: 'Whole campus' }]} keepCase value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
          {form.scope === 'department' && <Select label="Department" options={DEPARTMENTS} keepCase value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />}
          <Button disabled={!form.user} loading={granting} onClick={async () => {
            try {
              await grant({ userId: form.user._id, capability: form.capability, scope: form.scope, department: form.scope === 'department' ? form.department : undefined }).unwrap();
              toast.success('Role granted');
              setForm({ ...form, user: null });
            } catch (e) {
              toast.error(errMsg(e));
            }
          }}>Grant</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Current roles" />
        {isLoading ? <Skeleton className="h-32" /> : error ? <ErrorState error={error} /> : !data.items.length ? <p className="text-sm muted">No designations yet.</p> : (
          <ul className="space-y-2 text-sm">
            {data.items.map((d) => (
              <li key={d._id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1"><b>{displayName(d.user)}</b> <span className="muted">· {CAPS.find((c) => c.value === d.capability)?.label} · {d.scope === 'campus' ? 'campus' : d.department}</span></span>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => revoke(d._id).unwrap().then(() => toast.success('Revoked')).catch((e) => toast.error(errMsg(e)))}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

function OptionsEditor({ title, items, onSave, saving }) {
  const [list, setList] = useState(items);
  const [label, setLabel] = useState('');
  useEffect(() => setList(items), [items]);
  return (
    <Card>
      <CardHeader title={title} subtitle="Options in use can be retired (hidden from new entries) but not removed" />
      <ul className="space-y-2">
        {list.map((o, i) => (
          <li key={o.key} className="flex items-center gap-2">
            <Input className="flex-1" aria-label={`${o.key} label`} value={o.label} maxLength={80} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <label className="flex items-center gap-1 text-xs font-semibold"><input type="checkbox" checked={o.active !== false} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} /> Active</label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Input className="flex-1" aria-label="New option" placeholder="Add an option" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
        <Button type="button" variant="soft" icon={Plus} disabled={slug(label).length < 2 || list.some((o) => o.key === slug(label))} onClick={() => { setList([...list, { key: slug(label), label: label.trim(), active: true }]); setLabel(''); }}>Add</Button>
      </div>
      <Button className="mt-4" loading={saving} onClick={() => onSave(list)}>Save {title.toLowerCase()}</Button>
    </Card>
  );
}

function Configuration() {
  const { data, isLoading, error } = useGetSwConfigQuery();
  const [save, { isLoading: saving }] = useUpdateSwConfigMutation();
  const [rubric, setRubric] = useState([]);
  useEffect(() => data && setRubric(data.rubric.criteria.map((c) => ({ ...c }))), [data]);
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} />;
  const put = (body, msg) => save(body).unwrap().then(() => toast.success(msg)).catch((e) => toast.error(errMsg(e)));
  const total = rubric.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  return (
    <div className="space-y-5">
      <SectionNote>Only campus-wide innovation coordinators can change these settings.</SectionNote>
      <div className="grid gap-5 lg:grid-cols-2">
        <OptionsEditor title="Project domains" items={data.domains} saving={saving} onSave={(domains) => put({ domains }, 'Domains saved')} />
        <OptionsEditor title="NPTEL institutions" items={data.institutions} saving={saving} onSave={(institutions) => put({ institutions }, 'Institutions saved')} />
      </div>
      <Card>
        <CardHeader title={`Review rubric (version ${data.rubric.version})`} subtitle="Weights must total 100. Changing them starts a new version; past reviews keep the version they used." />
        <ul className="space-y-2">
          {rubric.map((c, i) => (
            <li key={c.key} className="grid grid-cols-[1fr_100px] gap-2">
              <Input aria-label={`${c.key} label`} value={c.label} maxLength={80} onChange={(e) => setRubric(rubric.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input aria-label={`${c.label} weight`} type="number" min={1} max={100} value={c.weight} onChange={(e) => setRubric(rubric.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} />
            </li>
          ))}
        </ul>
        <p className={`mt-2 text-sm font-semibold ${total === 100 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600'}`}>Total: {total}</p>
        <Button className="mt-3" disabled={total !== 100} loading={saving} onClick={() => put({ rubric: { criteria: rubric } }, 'Rubric saved')}>Save rubric</Button>
      </Card>
    </div>
  );
}

function Overview() {
  const { data, isLoading, error } = useGetSwOverviewQuery();
  if (isLoading) return <Skeleton className="h-32" />;
  if (error) return <ErrorState error={error} />;
  const items = [
    ['Awaiting review', data.awaitingReview],
    ['Without reviewers', data.unassigned],
    ['Open recommendations', data.recommendations],
    ['Milestones to verify', data.milestones],
    ['Open reports', data.reports],
    ['Hidden projects', data.hidden],
    ['Published projects', data.published],
  ];
  return (
    <div>
      <p className="mb-3 text-sm muted">Scope: {data.scope === null ? 'whole campus' : data.scope.join(', ')}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{items.map(([label, value]) => <StatCard key={label} icon={Lightbulb} label={label} value={value} />)}</div>
    </div>
  );
}

/** Innovation Management — coordinators (designated by the Principal) and the Principal for designations. */
export default function Management() {
  const { data: roles, isLoading, error } = useGetSwReviewerRolesQuery();
  const [params, setParams] = useSearchParams();
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} />;
  const tabs = [
    ...(roles.isCoordinator
      ? [
          { value: 'overview', label: 'Overview' },
          { value: 'projects', label: 'Projects' },
          { value: 'recommendations', label: 'Recommendations' },
          { value: 'milestones', label: 'Milestones' },
          { value: 'reports', label: 'Reports' },
          { value: 'config', label: 'Settings' },
        ]
      : []),
    ...(roles.canManageDesignations ? [{ value: 'designations', label: 'Designations' }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value;
  return (
    <div>
      <PageHeader title="Innovation Management" subtitle="Reviewer assignment, recommendations, milestones and moderation" icon={Lightbulb} />
      {!tabs.length ? (
        <Card><EmptyState icon={Lightbulb} title="No management role" text="The Principal designates innovation / IIC coordinators." /></Card>
      ) : (
        <>
          <Tabs className="mb-5 max-w-full" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={tabs} />
          {tab === 'overview' && <Overview />}
          {tab === 'projects' && <Projects />}
          {tab === 'recommendations' && <Recommendations />}
          {tab === 'milestones' && <Milestones />}
          {tab === 'reports' && <Reports />}
          {tab === 'config' && <Configuration />}
          {tab === 'designations' && <Designations />}
        </>
      )}
    </div>
  );
}
