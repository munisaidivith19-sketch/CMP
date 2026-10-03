import { useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Users,
  Compass,
  MessageSquare,
  Heart,
  Pin,
  Trash2,
  Send,
  Plus,
  ArrowLeft,
  Lock,
  Globe,
  Share2,
  Megaphone,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { selectUser } from '../../features/authSlice';
import {
  useGetChaptersQuery,
  useGetChapterQuery,
  useCreateChapterMutation,
  useJoinChapterMutation,
  useLeaveChapterMutation,
  useGetChapterPostsQuery,
  useCreateChapterPostMutation,
  useLikePostMutation,
  usePinPostMutation,
  useDeletePostMutation,
  useGetCommentsQuery,
  useAddCommentMutation,
  useDeleteCommentMutation,
} from '../../services/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
} from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Field, Input, Select, Textarea } from '../../components/ui/form';

const CHAPTER_TYPE_LABELS = {
  batch: 'Graduation Batch',
  department: 'Academic Department',
  city: 'City / Regional Hub',
  interest: 'Special Interest / Industry',
};

function PostItem({ post, chapterSlug, isModerator, currentUserId }) {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');

  const [likePost] = useLikePostMutation();
  const [pinPost] = usePinPostMutation();
  const [deletePost] = useDeletePostMutation();

  const { data: commentsData, refetch: refetchComments } = useGetCommentsQuery(post._id, {
    skip: !showComments,
  });
  const comments = Array.isArray(commentsData) ? commentsData : commentsData?.items || [];
  const [addComment, { isLoading: isCommenting }] = useAddCommentMutation();
  const [deleteComment] = useDeleteCommentMutation();

  const hasLiked = post.likes?.some((id) => (id?._id || id) === currentUserId);
  const isAuthor = (post.author?._id || post.author) === currentUserId;
  const canManage = isAuthor || isModerator;

  const handleLike = async () => {
    try {
      await likePost(post._id).unwrap();
    } catch (err) {
      toast.error('Failed to like post');
    }
  };

  const handlePin = async () => {
    try {
      await pinPost(post._id).unwrap();
      toast.success(post.isPinned ? 'Post unpinned' : 'Post pinned to top');
    } catch (err) {
      toast.error('Failed to pin post');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this post?')) return;
    try {
      await deletePost(post._id).unwrap();
      toast.success('Post deleted');
    } catch (err) {
      toast.error('Failed to delete post');
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    try {
      await addComment({ postId: post._id, body: commentText.trim() }).unwrap();
      setCommentText('');
      refetchComments();
    } catch (err) {
      toast.error('Failed to add comment');
    }
  };

  return (
    <Card className={`p-4 sm:p-5 transition-all ${post.isPinned ? 'border-primary-500/40 bg-primary-50/20 dark:bg-primary-500/5' : ''}`}>
      {/* Top Author Row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Avatar user={post.author} size="sm" />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-xs sm:text-sm text-ink">{post.author?.name}</span>
              {post.kind === 'announcement' && (
                <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                  <Megaphone className="h-3 w-3" /> Announcement
                </span>
              )}
              {post.isPinned && (
                <span className="flex items-center gap-0.5 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-bold text-primary-800 dark:bg-primary-500/20 dark:text-primary-300">
                  <Pin className="h-3 w-3" /> Pinned
                </span>
              )}
            </div>
            <p className="text-[11px] muted">
              {post.author?.designation || post.author?.department} •{' '}
              {new Date(post.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-1">
            {isModerator && (
              <button
                onClick={handlePin}
                title={post.isPinned ? 'Unpin' : 'Pin to top'}
                className="btn-icon btn-ghost h-7 w-7 text-slate-400 hover:text-primary-600"
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={handleDelete}
              title="Delete post"
              className="btn-icon btn-ghost h-7 w-7 text-slate-400 hover:text-rose-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <p className="mt-3 whitespace-pre-line text-sm text-slate-800 leading-relaxed dark:text-slate-200">
        {post.body}
      </p>

      {/* Action Footer: Like & Comment */}
      <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-3 text-xs dark:border-white/5">
        <button
          onClick={handleLike}
          className={`flex items-center gap-1.5 font-semibold transition-colors ${
            hasLiked ? 'text-rose-600' : 'text-slate-500 hover:text-rose-600'
          }`}
        >
          <Heart className={`h-4 w-4 ${hasLiked ? 'fill-rose-500 text-rose-500' : ''}`} />
          <span>{post.likeCount || 0} Likes</span>
        </button>

        <button
          onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-1.5 font-semibold text-slate-500 hover:text-primary-600"
        >
          <MessageSquare className="h-4 w-4" />
          <span>{post.commentCount || comments.length || 0} Comments</span>
        </button>
      </div>

      {/* Comments Drawer / Thread */}
      {showComments && (
        <div className="mt-3 space-y-3 rounded-2xl bg-slate-50/70 p-3 dark:bg-white/5">
          {comments.map((c) => (
            <div key={c._id} className="flex items-start justify-between gap-2 text-xs">
              <div className="flex items-start gap-2">
                <Avatar user={c.author} size="xs" />
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{c.author?.name}</span>
                  <span className="muted text-[10px] ml-1.5">
                    {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <p className="text-slate-700 dark:text-slate-300 mt-0.5">{c.body}</p>
                </div>
              </div>

              {(c.author?._id === currentUserId || isModerator) && (
                <button
                  onClick={async () => {
                    await deleteComment(c._id);
                    refetchComments();
                  }}
                  className="text-slate-400 hover:text-rose-500"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}

          <form onSubmit={handleAddComment} className="flex gap-2 pt-1">
            <input
              type="text"
              placeholder="Write a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="input text-xs py-1.5 flex-1"
            />
            <Button variant="primary" size="sm" type="submit" loading={isCommenting}>
              <Send className="h-3 w-3" />
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
}

export default function AlumniChaptersTab() {
  const currentUser = useSelector(selectUser);
  const isStaff = ['admin', 'hod'].includes(currentUser?.role);
  const canJoin = currentUser?.role !== 'student'; // Students have read-only access to keep spaces alumni-led

  const [activeChapterSlug, setActiveChapterSlug] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // New Chapter Form
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('city');
  const [newDescription, setNewDescription] = useState('');
  const [newIsPrivate, setNewIsPrivate] = useState(false);

  // Post composer
  const [postBody, setPostBody] = useState('');
  const [isAnnouncement, setIsAnnouncement] = useState(false);

  // Queries
  const { data: chaptersData, isLoading } = useGetChaptersQuery({});
  const chapters = Array.isArray(chaptersData) ? chaptersData : chaptersData?.items || [];

  const { data: currentChapter, isLoading: isLoadingChapter } = useGetChapterQuery(activeChapterSlug, {
    skip: !activeChapterSlug,
  });
  const { data: postsData, isLoading: isLoadingPosts } = useGetChapterPostsQuery(
    { slug: activeChapterSlug },
    { skip: !activeChapterSlug }
  );
  const posts = Array.isArray(postsData) ? postsData : postsData?.items || [];

  const [createChapter, { isLoading: isCreatingChapter }] = useCreateChapterMutation();
  const [joinChapter, { isLoading: isJoining }] = useJoinChapterMutation();
  const [leaveChapter, { isLoading: isLeaving }] = useLeaveChapterMutation();
  const [createPost, { isLoading: isPosting }] = useCreateChapterPostMutation();

  const handleCreateChapter = async (e) => {
    e.preventDefault();
    try {
      await createChapter({
        name: newName.trim(),
        type: newType,
        description: newDescription.trim(),
        isPrivate: newIsPrivate,
      }).unwrap();
      toast.success('Chapter created successfully!');
      setCreateModalOpen(false);
      setNewName('');
      setNewDescription('');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to create chapter');
    }
  };

  const handleJoin = async (slug) => {
    try {
      await joinChapter(slug).unwrap();
      toast.success('Joined chapter!');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to join chapter');
    }
  };

  const handleLeave = async (slug) => {
    if (!window.confirm('Are you sure you want to leave this chapter?')) return;
    try {
      await leaveChapter(slug).unwrap();
      toast.success('Left chapter');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to leave chapter');
    }
  };

  const handleCreatePost = async (e) => {
    e.preventDefault();
    if (!postBody.trim()) return;
    try {
      await createPost({
        slug: activeChapterSlug,
        body: postBody.trim(),
        kind: isAnnouncement ? 'announcement' : 'post',
      }).unwrap();
      toast.success('Post published!');
      setPostBody('');
      setIsAnnouncement(false);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to publish post');
    }
  };

  // If a chapter wall is open:
  if (activeChapterSlug) {
    const isMember = currentChapter?.isMember;
    const isModerator = currentChapter?.membershipRole === 'moderator' || isStaff;

    return (
      <div className="space-y-6">
        {/* Wall Header */}
        <Card className="p-5 sm:p-6 bg-gradient-to-r from-primary-500/10 via-fuchsia-500/10 to-transparent">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveChapterSlug(null)}
                className="btn-icon"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-extrabold">{currentChapter?.name}</h2>
                  <Badge color="primary">{CHAPTER_TYPE_LABELS[currentChapter?.type]}</Badge>
                </div>
                <p className="mt-1 text-xs muted max-w-xl">{currentChapter?.description}</p>
                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-500">
                  <Users className="h-3.5 w-3.5" /> {currentChapter?.memberCount || 0} Members
                </p>
              </div>
            </div>

            {canJoin && (
              <div>
                {isMember ? (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={isLeaving}
                    onClick={() => handleLeave(activeChapterSlug)}
                    className="text-xs text-rose-600"
                  >
                    Leave Chapter
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={isJoining}
                    onClick={() => handleJoin(activeChapterSlug)}
                  >
                    Join Chapter
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Post Composer (for members) */}
        {isMember ? (
          <Card className="p-4 sm:p-5">
            <form onSubmit={handleCreatePost} className="space-y-3">
              <Textarea
                rows={3}
                placeholder={`Share an update, job opening, or milestone with ${currentChapter?.name}...`}
                value={postBody}
                onChange={(e) => setPostBody(e.target.value.slice(0, 2000))}
                required
              />

              <div className="flex items-center justify-between">
                {isModerator && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300 select-none">
                    <input
                      type="checkbox"
                      checked={isAnnouncement}
                      onChange={(e) => setIsAnnouncement(e.target.checked)}
                      className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    />
                    <Megaphone className="h-3.5 w-3.5" /> Post as Chapter Announcement
                  </label>
                )}

                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  loading={isPosting}
                  className="ml-auto"
                >
                  <Send className="mr-1 h-3.5 w-3.5" /> Publish Post
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          <Card className="p-4 text-center text-xs muted">
            {canJoin
              ? 'Join this chapter to participate in discussions and post updates.'
              : 'Students have read-only access to alumni chapters.'}
          </Card>
        )}

        {/* Posts Feed */}
        {isLoadingPosts ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-5 space-y-3">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-16 w-full" />
              </Card>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No Posts Yet"
            text="Be the first to start a conversation in this chapter!"
          />
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostItem
                key={post._id}
                post={post}
                chapterSlug={activeChapterSlug}
                isModerator={isModerator}
                currentUserId={currentUser?._id}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Chapter Directory Grid
  return (
    <div className="space-y-6">
      {/* Directory Top Bar */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold">Alumni Chapters & Regional Hubs</h3>
            <p className="text-xs muted">
              Connect with alumni from your graduating batch, department, or local city chapter.
            </p>
          </div>

          {isStaff && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreateModalOpen(true)}
              className="shrink-0 font-bold"
            >
              <Plus className="mr-1 h-4 w-4" /> Create Chapter
            </Button>
          )}
        </div>
      </Card>

      {/* Chapters Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-16 w-full" />
            </Card>
          ))}
        </div>
      ) : chapters.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No Chapters Established"
          text="Chapters help alumni stay in touch by batch, department, or city."
          action={
            isStaff && (
              <Button variant="primary" size="sm" onClick={() => setCreateModalOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Create First Chapter
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {chapters.map((chap) => (
            <Card
              key={chap._id}
              hover
              onClick={() => setActiveChapterSlug(chap.slug)}
              className="flex flex-col justify-between border border-slate-200/70 p-5 transition-all duration-300 hover:shadow-lg dark:border-white/10"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Badge color="primary">{CHAPTER_TYPE_LABELS[chap.type] || chap.type}</Badge>
                  <span className="flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <Users className="h-3.5 w-3.5" /> {chap.memberCount || 0}
                  </span>
                </div>

                <h3 className="mt-3 line-clamp-1 text-base font-bold text-ink dark:text-white hover:text-primary-600 dark:hover:text-primary-400">
                  {chap.name}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600 leading-relaxed dark:text-slate-300">
                  {chap.description}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs dark:border-white/5">
                <span className="font-semibold text-primary-600 dark:text-primary-400">
                  View Community Wall →
                </span>

                {chap.isMember && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                    Member
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create Chapter Modal */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create Alumni Chapter"
        subtitle="Establish a new batch, department, or regional community"
        size="md"
      >
        <form onSubmit={handleCreateChapter} className="space-y-4">
          <Field label="Chapter Name" required>
            <Input
              placeholder="e.g. Batch of 2025 / Bay Area Alumni"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
          </Field>

          <Field label="Chapter Classification">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="input text-sm"
            >
              {Object.entries(CHAPTER_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Description & Purpose" required>
            <Textarea
              rows={3}
              placeholder="Describe the goals and community guidelines for this chapter..."
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              required
            />
          </Field>

          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold select-none">
            <input
              type="checkbox"
              checked={newIsPrivate}
              onChange={(e) => setNewIsPrivate(e.target.checked)}
              className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <span>Private Chapter (Requires moderator approval to join)</span>
          </label>

          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" type="button" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={isCreatingChapter}>
              Establish Chapter
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
