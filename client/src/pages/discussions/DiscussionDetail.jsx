import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import toast from 'react-hot-toast';
import { ArrowLeft, Eye, EyeOff, Lock, MessageSquare, Pin, Send, ThumbsUp, Trash2, Unlock } from 'lucide-react';
import {
  api,
  useAddReplyMutation,
  useDeleteDiscussionMutation,
  useDeleteReplyMutation,
  useGetDiscussionQuery,
  useModerateDiscussionMutation,
  useUpvoteDiscussionMutation,
  useUpvoteReplyMutation,
} from '../../services/api';
import { useSocketEvent, useSocketRoom } from '../../services/socket';
import { Avatar, Badge, Button, Card, ErrorState, PageLoader, cn } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import { ReportButton } from '../../components/domain';
import { ROLE_LABELS } from '../../utils/constants';
import { errMsg, timeAgo } from '../../utils/format';

function Upvote({ active, count, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all duration-300 ease-smooth active:scale-95',
        active ? 'bg-primary-500 text-white shadow-glow' : 'bg-primary-500/10 text-primary-600 hover:bg-primary-500/20 dark:text-primary-300'
      )}
    >
      <ThumbsUp className={cn('h-3.5 w-3.5', active && 'fill-white')} /> {count}
    </button>
  );
}

export default function DiscussionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { data: d, isLoading, error, refetch } = useGetDiscussionQuery(id);
  const [reply, setReply] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addReply, { isLoading: posting }] = useAddReplyMutation();
  const [deleteReply] = useDeleteReplyMutation();
  const [upvote] = useUpvoteDiscussionMutation();
  const [upvoteReply] = useUpvoteReplyMutation();
  const [moderate] = useModerateDiscussionMutation();
  const [remove, { isLoading: removing }] = useDeleteDiscussionMutation();

  // Live replies: join this discussion's socket room (re-joined after reconnects).
  useSocketRoom('discussion:join', 'discussion:leave', id);
  useSocketEvent('discussion:reply', ({ discussionId }) => {
    if (discussionId === id) dispatch(api.util.invalidateTags([{ type: 'Discussion', id }]));
  });

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const submitReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    try {
      await addReply({ id, body: reply.trim() }).unwrap();
      setReply('');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const mod = (action) =>
    moderate({ id, action })
      .unwrap()
      .then(() => toast.success('Updated'))
      .catch((e) => toast.error(errMsg(e)));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/discussions" className="inline-flex items-center gap-2 text-sm font-semibold muted hover:text-primary-600">
        <ArrowLeft className="h-4 w-4" /> All discussions
      </Link>

      <Card className="p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          {d.isPinned && <Badge icon={Pin}>Pinned</Badge>}
          {d.isLocked && <Badge color="warning" icon={Lock}>Locked</Badge>}
          {d.isHidden && <Badge color="danger" icon={EyeOff}>Hidden</Badge>}
          <Badge color="neutral">{d.category}</Badge>
          {d.tags?.map((t) => (
            <span key={t} className="text-xs font-semibold text-primary-500">
              #{t}
            </span>
          ))}
        </div>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{d.title}</h1>
        <div className="mt-4 flex items-center gap-3">
          <Avatar user={d.author} />
          <div>
            <Link to={`/people/${d.author._id}`} className="text-sm font-bold hover:text-primary-600">
              {d.author.name}
            </Link>
            <p className="text-xs muted">
              {ROLE_LABELS[d.author.role]} · {timeAgo(d.createdAt)} ·{' '}
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3 w-3" /> {d.views}
              </span>
            </p>
          </div>
        </div>
        <p className="mt-5 whitespace-pre-line leading-relaxed">{d.body}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/60 pt-4 dark:border-white/10">
          <Upvote active={d.hasUpvoted} count={d.upvoteCount} onClick={() => upvote(id)} />
          <span className="flex items-center gap-1.5 text-xs font-semibold muted">
            <MessageSquare className="h-3.5 w-3.5" /> {d.replies.length} replies
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {d.canModerate && (
              <>
                <Button size="sm" variant="ghost" icon={Pin} onClick={() => mod('pin')}>
                  {d.isPinned ? 'Unpin' : 'Pin'}
                </Button>
                <Button size="sm" variant="ghost" icon={d.isLocked ? Unlock : Lock} onClick={() => mod('lock')}>
                  {d.isLocked ? 'Unlock' : 'Lock'}
                </Button>
                <Button size="sm" variant="ghost" icon={d.isHidden ? Eye : EyeOff} onClick={() => mod('hide')}>
                  {d.isHidden ? 'Unhide' : 'Hide'}
                </Button>
              </>
            )}
            {(d.canEdit || d.canModerate) && (
              <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            {!d.canEdit && <ReportButton targetType="discussion" targetId={id} />}
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        <h2 className="section-title px-1">
          {d.replies.length} {d.replies.length === 1 ? 'reply' : 'replies'}
        </h2>
        {d.replies.map((r, i) => (
          <Card key={r._id} className={cn('animate-fade-up', r.isHidden && 'opacity-60')} style={{ animationDelay: `${i * 30}ms` }}>
            <div className="flex gap-3">
              <Avatar user={r.author} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/people/${r.author?._id}`} className="text-sm font-bold hover:text-primary-600">
                    {r.author?.name}
                  </Link>
                  {r.author?._id === d.author._id && <Badge>Author</Badge>}
                  {['faculty', 'admin'].includes(r.author?.role) && <Badge color="info">{ROLE_LABELS[r.author.role]}</Badge>}
                  {r.isHidden && <Badge color="danger">hidden</Badge>}
                  <span className="text-xs muted">{timeAgo(r.createdAt)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed">{r.body}</p>
                <div className="mt-3 flex items-center gap-3">
                  <Upvote active={r.hasUpvoted} count={r.upvoteCount} onClick={() => upvoteReply({ id, replyId: r._id })} />
                  {r.canDelete && (
                    <button
                      className="text-xs font-semibold text-ink-muted hover:text-rose-500"
                      onClick={() =>
                        deleteReply({ id, replyId: r._id })
                          .unwrap()
                          .then(() => toast.success('Reply deleted'))
                      }
                    >
                      Delete
                    </button>
                  )}
                  {!r.canDelete && <ReportButton targetType="reply" targetId={id} replyId={r._id} />}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {d.isLocked ? (
        <Card className="text-center text-sm muted">
          <Lock className="mx-auto mb-2 h-5 w-5" /> This discussion is locked. New replies are disabled.
        </Card>
      ) : (
        <Card>
          <form onSubmit={submitReply} className="flex flex-col gap-3">
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={3000} placeholder="Write a helpful reply…" className="input resize-y" />
            <div className="flex justify-end">
              <Button type="submit" icon={Send} loading={posting} disabled={!reply.trim()}>
                Reply
              </Button>
            </div>
          </form>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this discussion?"
        text="The post and all replies will be removed permanently."
        confirmText="Delete"
        loading={removing}
        onConfirm={async () => {
          try {
            await remove(id).unwrap();
            toast.success('Discussion deleted');
            navigate('/discussions');
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
