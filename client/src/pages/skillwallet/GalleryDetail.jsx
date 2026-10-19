import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Flag, Heart, Mail, MessageCircle, Trash2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Avatar, Badge, Button, Card, CardHeader, ErrorState, FullImage, PageLoader, Pagination } from '../../components/ui/primitives';
import { Select, Textarea } from '../../components/ui/form';
import {
  useAddSwCommentMutation,
  useDeleteSwCommentMutation,
  useGetSwCommentsQuery,
  useGetSwGalleryProjectQuery,
  useGetSwPublicGalleryProjectQuery,
  useReportSwContentMutation,
  useRequestSwContactMutation,
  useToggleSwLikeMutation,
} from '../../services/skillWallet';
import { displayName, errMsg, timeAgo, titleCase } from '../../utils/format';
import { REPORT_REASONS } from '../../utils/skillWallet';
import { Dates, SafeExternalLink } from './components';
import { PublicShell } from './Gallery';

function ReportDialog({ target, onClose }) {
  const [report, { isLoading }] = useReportSwContentMutation();
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      size="sm"
      title={target?.commentId ? 'Report comment' : 'Report project'}
      subtitle="Innovation coordinators review reports. Reporting does not hide content automatically."
      footer={
        <Button
          loading={isLoading}
          onClick={async () => {
            try {
              await report({ id: target.id, reason, details: details.trim(), ...(target.commentId ? { commentId: target.commentId } : {}) }).unwrap();
              toast.success('Report sent to the moderators');
              onClose();
            } catch (e) {
              toast.error(errMsg(e));
            }
          }}
        >
          Send report
        </Button>
      }
    >
      <div className="grid gap-3">
        <Select label="Reason" options={REPORT_REASONS} keepCase value={reason} onChange={(e) => setReason(e.target.value)} />
        <Textarea label="Details (optional)" rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
      </div>
    </Modal>
  );
}

function Comments({ id, onReport }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useGetSwCommentsQuery({ id, page });
  const [add, { isLoading: adding }] = useAddSwCommentMutation();
  const [del] = useDeleteSwCommentMutation();
  const [text, setText] = useState('');
  return (
    <Card>
      <CardHeader title="Comments" subtitle="Visible to signed-in college members only" />
      <form
        className="mb-4 space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          try {
            await add({ id, body: text.trim() }).unwrap();
            setText('');
          } catch (err) {
            toast.error(errMsg(err));
          }
        }}
      >
        <Textarea aria-label="Write a comment" rows={2} maxLength={1000} placeholder="Share feedback respectfully" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" size="sm" loading={adding} disabled={!text.trim()}>Post comment</Button>
      </form>
      {isLoading ? <PageLoader /> : error ? <ErrorState error={error} /> : !data.items.length ? <p className="text-sm muted">No comments yet.</p> : (
        <>
          <ul className="space-y-3">
            {data.items.map((c) => (
              <li key={c._id} className="flex gap-3">
                <Avatar user={c.author} size="xs" />
                <div className="min-w-0 flex-1 text-sm">
                  <p><b>{displayName(c.author)}</b> <span className="text-xs muted">{timeAgo(c.createdAt)}</span></p>
                  <p className="whitespace-pre-line break-words">{c.body}</p>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  {c.canDelete && <button type="button" aria-label="Delete comment" className="btn-icon btn-ghost" onClick={() => del({ id, commentId: c._id }).unwrap().catch((e) => toast.error(errMsg(e)))}><Trash2 className="h-4 w-4" /></button>}
                  <button type="button" aria-label="Report comment" className="btn-icon btn-ghost" onClick={() => onReport({ id, commentId: c._id })}><Flag className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

function Detail({ p, publicMode }) {
  const navigate = useNavigate();
  const [like, { isLoading: liking }] = useToggleSwLikeMutation();
  const [contact, { isLoading: contacting }] = useRequestSwContactMutation();
  const [reportTarget, setReportTarget] = useState(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <div>
      <Button variant="ghost" size="sm" icon={ArrowLeft} className="mb-3" onClick={() => navigate(publicMode ? '/gallery' : '/skill-wallet/gallery')}>Gallery</Button>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card className="space-y-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">{p.title}</h1>
              <p className="text-sm muted">{p.domain?.label} · {titleCase(p.stage || '')} · <Dates {...p} /></p>
            </div>
            {p.imageUrl && <FullImage src={p.imageUrl} alt={`${p.title} project image`} className="max-h-[28rem] rounded-2xl" />}
            <p className="whitespace-pre-line text-sm leading-relaxed">{p.description}</p>
            {p.skills?.length > 0 && <div className="flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>}
            <div className="flex flex-wrap gap-4 text-sm">
              {p.githubUrl && <SafeExternalLink href={p.githubUrl}>GitHub repository</SafeExternalLink>}
              {p.driveUrl && <SafeExternalLink href={p.driveUrl}>Google Drive</SafeExternalLink>}
            </div>
          </Card>
          {!publicMode && <Comments id={p._id} onReport={setReportTarget} />}
        </div>
        <div className="space-y-4">
          <Card className="space-y-3">
            <p className="section-title">Team</p>
            <ul className="space-y-2">
              {p.team.map((m, i) => (
                <li key={`${m.name}-${i}`} className="flex items-center gap-2 text-sm">
                  <Avatar name={m.name} src={m.avatar} size="xs" />
                  <span className="font-semibold">{displayName(m)}</span>
                  {m.role === 'owner' && <Badge color="neutral">Owner</Badge>}
                </li>
              ))}
            </ul>
            <p className="text-xs muted">{p.department}{p.year ? ` · Year ${p.year}` : ''}</p>
          </Card>
          <Card className="space-y-3">
            {p.facultyScore != null ? <p className="text-sm">Faculty evaluation: <b>{p.facultyScore}/100</b></p> : <p className="text-sm muted">No faculty evaluation shown.</p>}
            <div className="flex flex-wrap gap-2">
              {publicMode ? (
                <span className="text-sm muted">♥ {p.likeCount} · 💬 {p.commentCount}</span>
              ) : (
                <>
                  <Button size="sm" variant={p.likedByMe ? 'primary' : 'outline'} icon={Heart} loading={liking} aria-pressed={p.likedByMe} onClick={() => like(p._id).unwrap().catch((e) => toast.error(errMsg(e)))}>
                    {p.likeCount}
                  </Button>
                  <span className="flex items-center gap-1 text-sm muted"><MessageCircle className="h-4 w-4" /> {p.commentCount}</span>
                  {p.canContact && !p.isMine && <Button size="sm" variant="soft" icon={Mail} onClick={() => setContactOpen(true)}>Contact team</Button>}
                  <Button size="sm" variant="ghost" icon={Flag} onClick={() => setReportTarget({ id: p._id })}>Report</Button>
                </>
              )}
            </div>
            <p className="text-xs muted">Likes show community interest, not technical merit.</p>
          </Card>
        </div>
      </div>
      <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />
      <Modal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        title="Contact the project team"
        subtitle="The team sees your name and message. They decide whether to share their college email with you."
        footer={
          <Button
            loading={contacting}
            disabled={message.trim().length < 10}
            onClick={async () => {
              try {
                await contact({ id: p._id, message: message.trim() }).unwrap();
                toast.success('Request sent');
                setContactOpen(false);
                setMessage('');
              } catch (e) {
                toast.error(errMsg(e));
              }
            }}
          >
            Send request
          </Button>
        }
      >
        <Textarea label="Message" rows={4} maxLength={500} hint="At least 10 characters" value={message} onChange={(e) => setMessage(e.target.value)} />
      </Modal>
    </div>
  );
}

export default function GalleryDetail() {
  const { id } = useParams();
  const { data, isLoading, error, refetch } = useGetSwGalleryProjectQuery(id);
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return <Detail p={data} />;
}

export function PublicGalleryDetail() {
  const { id } = useParams();
  const { data, isLoading, error } = useGetSwPublicGalleryProjectQuery(id);
  return (
    <PublicShell>
      {isLoading ? <PageLoader /> : error ? <ErrorState error={error} /> : <Detail p={data} publicMode />}
    </PublicShell>
  );
}
