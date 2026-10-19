import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Crown, FolderKanban, Globe2, Lock, Pencil, School, Send, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, FullImage, PageLoader, Tabs } from '../../components/ui/primitives';
import { Input, Select, Textarea } from '../../components/ui/form';
import {
  useAddSwMilestoneMutation,
  useCancelSwInvitationMutation,
  useDeleteSwProjectMutation,
  useGetSwProjectHistoryQuery,
  useGetSwProjectQuery,
  useGetSwPublicationQuery,
  useGetSwTeamQuery,
  useInviteSwMemberMutation,
  useLeaveSwTeamMutation,
  useRemoveSwMemberMutation,
  useSetSwConsentMutation,
  useSetSwPublicationMutation,
  useSubmitSwProjectMutation,
  useTransferSwOwnershipMutation,
  useWithdrawSwProjectMutation,
} from '../../services/skillWallet';
import { displayName, errMsg, fmtDateTime, titleCase } from '../../utils/format';
import { MILESTONE_KINDS } from '../../utils/skillWallet';
import ProjectForm from './ProjectForm';
import { Dates, SafeExternalLink, SectionNote, StatusBadge, VisibilityBadge } from './components';

const TABS = ['overview', 'team', 'publication', 'reviews', 'history'];

function Overview({ p }) {
  const [submit, { isLoading: s }] = useSubmitSwProjectMutation();
  const [withdraw, { isLoading: w }] = useWithdrawSwProjectMutation();
  const canSubmit = p.isOwner && ['draft', 'changes_requested', 'rejected'].includes(p.review.status) && !p.review.currentRevisionApproved && !(p.review.status === 'rejected' && p.review.submittedRevision === p.revision);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="space-y-4">
        {p.imageUrl && <FullImage src={p.imageUrl} alt={`${p.title} project image`} className="max-h-96 rounded-2xl" />}
        <p className="whitespace-pre-line text-sm leading-relaxed">{p.description}</p>
        {p.skills.length > 0 && <div className="flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>}
        <div className="flex flex-wrap gap-4 text-sm">
          {p.githubUrl && <SafeExternalLink href={p.githubUrl}>GitHub repository</SafeExternalLink>}
          {p.driveUrl && <SafeExternalLink href={p.driveUrl}>Google Drive</SafeExternalLink>}
        </div>
        {p.driveUrl && <p className="text-xs muted">Drive access depends on the link’s sharing settings; VEXON does not check them.</p>}
      </Card>
      <div className="space-y-4">
        <Card className="space-y-2 text-sm">
          <p><span className="muted">Domain:</span> <b>{p.domain?.label}</b></p>
          <p><span className="muted">Stage:</span> <b>{titleCase(p.stage)}</b></p>
          <p><span className="muted">Dates:</span> <b><Dates {...p} /></b></p>
          <p><span className="muted">Mode:</span> <b>{p.mode === 'team' ? `Team (${p.memberCount})` : 'Solo'}</b></p>
          <p><span className="muted">Revision:</span> <b>{p.revision}</b></p>
          <div className="flex flex-wrap gap-1.5 pt-1"><StatusBadge kind="review" status={p.review.status} /><VisibilityBadge project={p} /></div>
          {p.hidden && p.hiddenReason && <SectionNote tone="warning">Moderator note: {p.hiddenReason}</SectionNote>}
        </Card>
        {!p.isReviewer && (
          <Card className="space-y-3">
            <p className="section-title">Faculty review</p>
            {p.review.status === 'submitted' ? (
              <>
                <p className="text-sm muted">Revision {p.review.submittedRevision} is waiting for a faculty review.</p>
                {p.isOwner && <Button variant="outline" size="sm" loading={w} onClick={() => withdraw(p._id).unwrap().catch((e) => toast.error(errMsg(e)))}>Withdraw submission</Button>}
              </>
            ) : p.review.currentRevisionApproved ? (
              <p className="text-sm">This revision is approved. Approval does not publish anything — choose an audience under <b>Publication</b>.</p>
            ) : (
              <>
                <p className="text-sm muted">Submit the current revision for review. Editing the description, dates, links or image later creates a new revision that needs review again.</p>
                {canSubmit && <Button size="sm" icon={Send} loading={s} onClick={() => submit(p._id).unwrap().then(() => toast.success('Submitted for review')).catch((e) => toast.error(errMsg(e)))}>Submit for review</Button>}
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function Team({ p }) {
  const { data, isLoading, error, refetch } = useGetSwTeamQuery(p._id);
  const [invite, { isLoading: inviting }] = useInviteSwMemberMutation();
  const [cancel] = useCancelSwInvitationMutation();
  const [remove] = useRemoveSwMemberMutation();
  const [leave, { isLoading: leaving }] = useLeaveSwTeamMutation();
  const [transfer] = useTransferSwOwnershipMutation();
  const navigate = useNavigate();
  const [rollNo, setRollNo] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(null);

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const run = async (promise, ok) => {
    try {
      await promise;
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Members" subtitle={`${data.memberCount} of ${data.maxTeamSize}`} />
        <ul className="space-y-3">
          {data.team.map((m) => (
            <li key={m.user._id} className="flex flex-wrap items-center gap-3">
              <Avatar user={m.user} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{displayName(m.user)} {m.role === 'owner' && <Badge color="warning" icon={Crown}>Owner</Badge>}</p>
                <p className="text-xs muted">{m.user.department}{m.user.year ? ` · Year ${m.user.year}` : ''}</p>
              </div>
              {p.isOwner && m.role !== 'owner' && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={Crown} onClick={() => setConfirm({ kind: 'transfer', user: m.user })}>Make owner</Button>
                  <Button size="sm" variant="ghost" icon={UserMinus} onClick={() => setConfirm({ kind: 'remove', user: m.user })}>Remove</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!p.isOwner && p.canEdit && (
          <Button className="mt-4" size="sm" variant="outline" loading={leaving} onClick={() => setConfirm({ kind: 'leave' })}>Leave this team</Button>
        )}
      </Card>
      {p.isOwner && (
        <Card>
          <CardHeader title="Invite a teammate" subtitle="By college roll number. They join only after accepting." />
          {p.mode !== 'team' ? (
            <SectionNote>This is a solo project. Edit the project and switch it to a team project to invite teammates.</SectionNote>
          ) : (
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!rollNo.trim()) return;
                try {
                  const r = await invite({ id: p._id, rollNo: rollNo.trim(), message: message.trim() }).unwrap();
                  toast.success(`Invitation sent to ${r.invitee?.name || 'the student'}`);
                  setRollNo('');
                  setMessage('');
                } catch (err) {
                  toast.error(errMsg(err));
                }
              }}
            >
              <Input label="Roll number" value={rollNo} onChange={(e) => setRollNo(e.target.value)} maxLength={30} autoComplete="off" required />
              <Textarea label="Message (optional)" rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} />
              <Button type="submit" icon={UserPlus} loading={inviting}>Send invitation</Button>
            </form>
          )}
          {data.invitations.length > 0 && (
            <>
              <p className="section-title mb-2 mt-6">Invitations</p>
              <ul className="space-y-2 text-sm">
                {data.invitations.map((i) => (
                  <li key={i._id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">{displayName(i.invitee)} <span className="muted">· {fmtDateTime(i.createdAt)}</span></span>
                    <StatusBadge kind="invite" status={i.expired ? 'expired' : i.status} />
                    {i.status === 'pending' && !i.expired && <Button size="sm" variant="ghost" onClick={() => run(cancel(i._id).unwrap(), 'Invitation cancelled')}>Cancel</Button>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'transfer' ? `Make ${confirm.user.name} the owner?` : confirm?.kind === 'remove' ? `Remove ${confirm.user.name}?` : 'Leave this team?'}
        text={
          confirm?.kind === 'transfer'
            ? 'They will manage the team and publication. You stay as a member. Pending invitations are cancelled.'
            : confirm?.kind === 'remove'
            ? 'They lose access to this project immediately.'
            : 'You lose access to this project. The owner can invite you again.'
        }
        danger={confirm?.kind !== 'transfer'}
        confirmText="Confirm"
        onConfirm={async () => {
          const c = confirm;
          setConfirm(null);
          if (c.kind === 'transfer') await run(transfer({ id: p._id, userId: c.user._id }).unwrap(), 'Ownership transferred');
          if (c.kind === 'remove') await run(remove({ id: p._id, userId: c.user._id }).unwrap(), 'Member removed');
          if (c.kind === 'leave') {
            try {
              await leave(p._id).unwrap();
              toast.success('You left the team');
              navigate('/skill-wallet');
            } catch (e) {
              toast.error(errMsg(e));
            }
          }
        }}
      />
    </div>
  );
}

const AUDIENCES = [
  { value: 'private', label: 'Private', icon: Lock, text: 'Only your team and assigned reviewers. Removes it from the gallery.' },
  { value: 'college', label: 'College-only', icon: School, text: 'Signed-in college members see the current revision in the gallery.' },
  { value: 'public', label: 'Public', icon: Globe2, text: 'Anyone on the internet. Needs faculty approval of the current revision and every team member’s confirmation.' },
];

function Publication({ p }) {
  const { data, isLoading, error, refetch } = useGetSwPublicationQuery(p._id);
  const [setPub, { isLoading: saving }] = useSetSwPublicationMutation();
  const [consent, { isLoading: consenting }] = useSetSwConsentMutation();
  const [confirmPublic, setConfirmPublic] = useState(false);
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const choose = async (audience) => {
    try {
      const r = await setPub({ id: p._id, audience, ...(audience === 'public' ? { confirmPublic: true } : {}) }).unwrap();
      toast.success(r.publicRequest ? 'Waiting for your teammates to confirm' : `Now ${audience === 'college' ? 'college-only' : audience}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <Card className="space-y-4">
        <CardHeader title="Who can see this project" subtitle={`Currently: ${titleCase(data.visibility)}${data.hidden ? ' (hidden by a moderator)' : ''}`} />
        {data.published?.outdated && data.visibility !== 'private' && (
          <SectionNote tone="warning">The gallery shows revision {data.published.revision}. Your edits (revision {data.revision}) appear only after you publish again{data.visibility === 'public' ? ' — public needs the new revision approved first' : ''}.</SectionNote>
        )}
        <div className="grid gap-3">
          {AUDIENCES.map((a) => {
            const Icon = a.icon;
            const current = data.visibility === a.value;
            const blocked = a.value === 'public' && !data.canRequestPublic;
            return (
              <div key={a.value} className={`rounded-2xl border p-4 ${current ? 'border-primary-400 bg-primary-500/5' : 'border-white/60 dark:border-white/10'}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{a.label} {current && <Badge color="primary">Current</Badge>}</p>
                    <p className="text-sm muted">{a.text}</p>
                    {blocked && <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Needs faculty approval of revision {data.revision} first.</p>}
                  </div>
                  {data.isOwner && (
                    <Button
                      size="sm"
                      variant={a.value === 'public' ? 'primary' : 'outline'}
                      disabled={blocked || saving || (current && !data.published?.outdated)}
                      onClick={() => (a.value === 'public' ? setConfirmPublic(true) : choose(a.value))}
                    >
                      {current && data.published?.outdated ? 'Publish latest' : `Make ${a.label.toLowerCase()}`}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {!data.isOwner && <p className="text-sm muted">Only the project owner changes the audience. You can confirm or withdraw consent for public publication.</p>}
      </Card>
      <div className="space-y-4">
        {data.publicRequest && (
          <Card className="space-y-2">
            <p className="section-title">Public publication request</p>
            <p className="text-sm">{data.publicRequest.consentedCount} of {data.publicRequest.memberCount} members confirmed. Waiting for {data.publicRequest.waitingFor}.</p>
            {!data.myConsent && <Button size="sm" loading={consenting} onClick={() => consent({ id: p._id, decision: 'grant' }).unwrap().then(() => toast.success('Thanks — your confirmation was recorded')).catch((e) => toast.error(errMsg(e)))}>I agree to publish publicly</Button>}
          </Card>
        )}
        {(data.myConsent || data.visibility === 'public') && (
          <Card className="space-y-2">
            <p className="section-title">Withdraw consent</p>
            <p className="text-sm muted">Withdrawing immediately moves a public project to college-only.</p>
            <Button size="sm" variant="outline" loading={consenting} onClick={() => consent({ id: p._id, decision: 'withdraw' }).unwrap().then(() => toast.success('Consent withdrawn')).catch((e) => toast.error(errMsg(e)))}>Withdraw my consent</Button>
          </Card>
        )}
        <Card>
          <p className="section-title mb-2">Publication history</p>
          <ol className="space-y-2 text-xs">
            {data.events.length ? data.events.map((e) => (
              <li key={e._id}><b>{titleCase(e.action)}</b> · {e.actor?.name || '—'} · {fmtDateTime(e.createdAt)}{e.note ? ` — ${e.note}` : ''}</li>
            )) : <li className="muted">Nothing published yet.</li>}
          </ol>
        </Card>
      </div>
      <ConfirmDialog
        open={confirmPublic}
        onClose={() => setConfirmPublic(false)}
        danger={false}
        title="Publish on the public internet?"
        text="Anyone, including people outside the college, will see the title, description, skills, links, image and team names of the approved revision. Team members must each confirm. You can unpublish at any time."
        confirmText="Yes, publish publicly"
        onConfirm={() => {
          setConfirmPublic(false);
          choose('public');
        }}
      />
    </div>
  );
}

function Reviews({ p }) {
  const [add, { isLoading }] = useAddSwMilestoneMutation();
  const [open, setOpen] = useState(false);
  const [m, setM] = useState({ kind: 'patent_filed', title: '', reference: '' });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Faculty feedback" subtitle="Scores and feedback from reviewers" />
        {!p.reviews.length ? (
          <EmptyState title="No reviews yet" text="Submit the project for review to get feedback." />
        ) : (
          <ul className="space-y-3">
            {p.reviews.map((r) => (
              <li key={r._id} className="rounded-2xl bg-primary-500/5 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{displayName(r.reviewer)}</b>
                  <span className="muted">revision {r.revision} · {fmtDateTime(r.createdAt)}</span>
                  <Badge color={r.decision === 'approve' ? 'success' : r.decision === 'reject' ? 'danger' : 'warning'}>{titleCase(r.decision)}</Badge>
                  <Badge color="neutral">Score {Math.round(r.totalScore)}</Badge>
                </div>
                {r.feedback && <p className="mt-2 whitespace-pre-line">{r.feedback}</p>}
                {r.reason && <p className="mt-1 text-amber-800 dark:text-amber-200">Reason: {r.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Milestones" subtitle="Patents, startups, funding — verified by innovation coordinators" action={p.canEdit && !p.isReviewer ? <Button size="sm" variant="soft" onClick={() => setOpen(true)}>Add milestone</Button> : null} />
        {!p.milestones.length ? <p className="text-sm muted">No milestones claimed.</p> : (
          <ul className="space-y-2 text-sm">
            {p.milestones.map((x) => (
              <li key={x._id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1"><b>{x.title}</b> <span className="muted">· {titleCase(x.kind)}</span></span>
                <Badge color={x.status === 'verified' ? 'success' : x.status === 'rejected' ? 'danger' : 'neutral'}>{x.status === 'claimed' ? 'Claimed (unverified)' : titleCase(x.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Claim a milestone"
        subtitle="Claims show as unverified until an innovation coordinator checks the evidence."
        footer={<Button loading={isLoading} onClick={async () => {
          try {
            await add({ id: p._id, ...m }).unwrap();
            toast.success('Milestone added');
            setOpen(false);
            setM({ kind: 'patent_filed', title: '', reference: '' });
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}>Add</Button>}
      >
        <div className="grid gap-3">
          <Select label="Type" options={MILESTONE_KINDS} keepCase value={m.kind} onChange={(e) => setM({ ...m, kind: e.target.value })} />
          <Input label="Title" value={m.title} maxLength={160} onChange={(e) => setM({ ...m, title: e.target.value })} />
          <Input label="Reference (application no., registration no.)" value={m.reference} maxLength={200} onChange={(e) => setM({ ...m, reference: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}

function History({ id }) {
  const { data, isLoading, error } = useGetSwProjectHistoryQuery(id);
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} />;
  return (
    <Card>
      <CardHeader title="Revisions" />
      <ol className="space-y-2 text-sm">
        {data.revisions.map((r) => (
          <li key={r._id}><b>Revision {r.number}</b> · {r.editedBy?.name || '—'} · {fmtDateTime(r.createdAt)}{r.changed?.length ? <span className="muted"> — changed {r.changed.join(', ')}</span> : null}</li>
        ))}
      </ol>
    </Card>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: p, isLoading, error, refetch } = useGetSwProjectQuery(id);
  const [del, { isLoading: deleting }] = useDeleteSwProjectMutation();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const visibleTabs = p.isReviewer ? ['overview', 'reviews', 'history'] : TABS;
  const tab = visibleTabs.includes(params.get('tab')) ? params.get('tab') : 'overview';
  return (
    <div>
      <Button variant="ghost" size="sm" icon={ArrowLeft} className="mb-3" onClick={() => navigate(p.isReviewer ? '/skill-wallet/review' : '/skill-wallet')}>Back</Button>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-glow"><FolderKanban className="h-6 w-6" /></div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{p.title}</h1>
            <p className="text-sm muted">{p.domain?.label} · revision {p.revision}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.isReviewer && <Button size="sm" to={`/skill-wallet/review/projects/${p._id}`}>Open in review workspace</Button>}
          {p.canEdit && !p.isReviewer && <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
          {p.isOwner && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRemoving(true)}>Delete</Button>}
        </div>
      </div>
      <Tabs className="mb-5 max-w-full" value={tab} onChange={(t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })} tabs={visibleTabs.map((t) => ({ value: t, label: titleCase(t) }))} />
      {tab === 'overview' && <Overview p={p} />}
      {tab === 'team' && <Team p={p} />}
      {tab === 'publication' && <Publication p={p} />}
      {tab === 'reviews' && <Reviews p={p} />}
      {tab === 'history' && <History id={p._id} />}
      {editing && <ProjectForm open project={p} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        loading={deleting}
        title="Delete this project?"
        text="It is removed from your Skill Wallet and the gallery, the team loses access, and pending invitations are cancelled."
        confirmText="Delete project"
        onConfirm={async () => {
          try {
            await del(p._id).unwrap();
            toast.success('Project deleted');
            navigate('/skill-wallet');
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
