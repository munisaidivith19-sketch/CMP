import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Eye, Lock, MessageSquare, MessagesSquare, Pin, Plus, Search, ThumbsUp, EyeOff } from 'lucide-react';
import { useCreateDiscussionMutation, useGetDiscussionsQuery } from '../../services/api';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select, TagInput, Textarea } from '../../components/ui/form';
import { DISCUSSION_CATEGORIES } from '../../utils/constants';
import { errMsg, timeAgo } from '../../utils/format';

function NewDiscussion({ open, onClose }) {
  const navigate = useNavigate();
  const [create, { isLoading }] = useCreateDiscussionMutation();
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm({ defaultValues: { title: '', body: '', category: 'general', tags: [] } });

  const onSubmit = async (v) => {
    try {
      const d = await create(v).unwrap();
      toast.success('Discussion posted');
      reset();
      onClose();
      navigate(`/discussions/${d._id}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Start a discussion"
      subtitle="Be kind and specific — good questions get great answers."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={handleSubmit(onSubmit)}>
            Post
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
        <Input
          className="sm:col-span-2"
          label="Title"
          placeholder="What would you like to ask or share?"
          error={errors.title}
          {...register('title', { required: 'Title is required', minLength: { value: 5, message: 'At least 5 characters' } })}
        />
        <Textarea
          className="sm:col-span-2"
          label="Details"
          rows={6}
          error={errors.body}
          {...register('body', { required: 'Please add some details', minLength: { value: 10, message: 'At least 10 characters' } })}
        />
        <Select label="Category" options={DISCUSSION_CATEGORIES} {...register('category')} />
        <Controller name="tags" control={control} render={({ field }) => <TagInput label="Tags" value={field.value} onChange={field.onChange} />} />
      </form>
    </Modal>
  );
}

export default function Discussions() {
  const [params, setParams] = useSearchParams();
  const [sort, setSort] = useState('latest');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (params.get('new')) {
      setCreating(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const { data, isFetching, error, refetch } = useGetDiscussionsQuery({ sort, category: category || undefined, q: q || undefined, page });

  return (
    <div>
      <PageHeader
        icon={MessagesSquare}
        title="Discussions"
        subtitle="Ask questions, share knowledge and help each other out."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            New discussion
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <Card className="flex flex-col gap-3 md:flex-row md:items-center">
            <Tabs
              value={sort}
              onChange={(v) => {
                setSort(v);
                setPage(1);
              }}
              tabs={[
                { value: 'latest', label: 'Latest' },
                { value: 'top', label: 'Top' },
                { value: 'unanswered', label: 'Unanswered' },
              ]}
            />
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Search discussions…"
                className="input pl-11"
              />
            </div>
          </Card>

          {error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : isFetching && !data ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-[28px]" />)
          ) : data?.items?.length ? (
            <div className={cn('space-y-3', isFetching && 'opacity-60')}>
              {data.items.map((d, i) => (
                <Link key={d._id} to={`/discussions/${d._id}`} className="block animate-fade-up" style={{ animationDelay: `${i * 30}ms` }}>
                  <Card hover className="flex gap-4">
                    <div className="hidden shrink-0 flex-col items-center gap-3 sm:flex">
                      <div className={cn('flex w-14 flex-col items-center rounded-2xl py-2', d.hasUpvoted ? 'bg-primary-500 text-white shadow-glow' : 'bg-primary-500/10 text-primary-600 dark:text-primary-300')}>
                        <ThumbsUp className="h-4 w-4" />
                        <span className="mt-0.5 text-sm font-extrabold">{d.upvoteCount}</span>
                      </div>
                      <div className="flex w-14 flex-col items-center rounded-2xl bg-white/50 py-2 dark:bg-white/5">
                        <MessageSquare className="h-4 w-4 muted" />
                        <span className="mt-0.5 text-sm font-bold">{d.replyCount}</span>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {d.isPinned && <Pin className="h-3.5 w-3.5 fill-primary-500 text-primary-500" />}
                        {d.isLocked && <Lock className="h-3.5 w-3.5 text-amber-500" />}
                        {d.isHidden && <Badge color="danger" icon={EyeOff}>hidden</Badge>}
                        <Badge color="neutral">{d.category}</Badge>
                        {d.tags?.slice(0, 3).map((t) => (
                          <span key={t} className="text-[11px] font-semibold text-primary-500">
                            #{t}
                          </span>
                        ))}
                      </div>
                      <h3 className="mt-2 font-bold leading-snug">{d.title}</h3>
                      <p className="mt-1 line-clamp-2 text-sm muted">{d.excerpt}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs muted">
                        <span className="flex items-center gap-2 font-semibold text-ink dark:text-slate-200">
                          <Avatar user={d.author} size="xs" /> {d.author?.name}
                        </span>
                        <span>{timeAgo(d.lastActivityAt)}</span>
                        <span className="flex items-center gap-1">
                          <Eye className="h-3.5 w-3.5" /> {d.views}
                        </span>
                        <span className="flex items-center gap-1 sm:hidden">
                          <ThumbsUp className="h-3.5 w-3.5" /> {d.upvoteCount} · <MessageSquare className="h-3.5 w-3.5" /> {d.replyCount}
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
              <Pagination page={data.page} pages={data.pages} onChange={setPage} />
            </div>
          ) : (
            <Card>
              <EmptyState
                icon={MessagesSquare}
                title="No discussions yet"
                text="Be the first to start a conversation."
                action={
                  <Button icon={Plus} onClick={() => setCreating(true)}>
                    Start one
                  </Button>
                }
              />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <p className="section-title mb-3">Categories</p>
            <div className="space-y-1">
              {['', ...DISCUSSION_CATEGORIES].map((c) => (
                <button
                  key={c || 'all'}
                  onClick={() => {
                    setCategory(c);
                    setPage(1);
                  }}
                  className={cn('nav-link w-full capitalize', category === c && 'nav-link-active')}
                >
                  {c || 'All topics'}
                </button>
              ))}
            </div>
          </Card>
          <Card className="text-sm">
            <p className="section-title mb-2">Community guidelines</p>
            <ul className="list-inside list-disc space-y-1 muted">
              <li>Be respectful and inclusive.</li>
              <li>No spam or self-promotion.</li>
              <li>Search before posting duplicates.</li>
              <li>Report content that breaks the rules.</li>
            </ul>
          </Card>
        </div>
      </div>

      <NewDiscussion open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
