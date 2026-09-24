import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { isSameDay, isToday, isYesterday, format } from 'date-fns';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CornerUpLeft,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  useCreateConversationMutation,
  useDeleteMessageMutation,
  useGetConversationQuery,
  useGetConversationsQuery,
  useGetMessagesQuery,
  useGetUsersQuery,
  useLazyGetMessagesQuery,
  useSendMessageMutation,
} from '../../services/api';
import { emit, emitWithAck, useSocketEvent, useSocketRoom } from '../../services/socket';
import { selectUser } from '../../features/authSlice';
import { Avatar, Button, Card, EmptyState, ErrorState, IconButton, Skeleton, cn } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/form';
import { ROLE_LABELS } from '../../utils/constants';
import { errMsg, fmtTime, timeAgo } from '../../utils/format';

const sameId = (a, b) => String(a?._id || a) === String(b?._id || b);

/** Title, avatar and "other person" for a conversation from the viewer's side. */
function describe(conv, me) {
  if (!conv) return {};
  if (conv.type === 'private') {
    const other = conv.participants.find((p) => !sameId(p, me)) || conv.participants[0];
    return { title: other?.name, other, subtitle: other ? `${ROLE_LABELS[other.role] || ''}${other.department ? ` · ${other.department}` : ''}` : '' };
  }
  return { title: conv.name, subtitle: `${conv.participants.length} members`, group: true };
}

function listTime(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isToday(date)) return format(date, 'h:mm a');
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'dd MMM');
}

function dayDivider(d) {
  const date = new Date(d);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, dd MMM yyyy');
}

function PresenceAvatar({ user, online, size = 'md' }) {
  return (
    <span className="relative inline-flex">
      <Avatar user={user} size={size} />
      {online && <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#fffdf9]" aria-label="online" />}
    </span>
  );
}

/* ── New conversation ───────────────────────────────────────────── */
function NewChatModal({ open, onClose, me }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState(false);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const { data, isFetching } = useGetUsersQuery({ q: q || undefined, limit: 20 }, { skip: !open });
  const [create, { isLoading }] = useCreateConversationMutation();
  const people = (data?.items || []).filter((u) => !sameId(u, me));

  useEffect(() => {
    if (!open) {
      setQ('');
      setGroup(false);
      setName('');
      setPicked([]);
    }
  }, [open]);

  const start = async (ids) => {
    try {
      const conv = await create(
        group ? { type: 'group', name: name.trim(), participantIds: ids } : { type: 'private', participantIds: ids }
      ).unwrap();
      onClose();
      navigate(`/chat/${conv._id}`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not start the conversation'));
    }
  };

  const toggle = (u) => setPicked((p) => (p.some((x) => sameId(x, u)) ? p.filter((x) => !sameId(x, u)) : [...p, u]));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={group ? 'New group' : 'New message'}
      subtitle={group ? 'Pick members and give the group a name.' : 'Start a private conversation with anyone on campus.'}
      footer={
        group && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={isLoading} disabled={!picked.length || name.trim().length < 2} onClick={() => start(picked.map((p) => p._id))}>
              Create group
            </Button>
          </>
        )
      }
    >
      <div className="mb-3 flex gap-2">
        <button className={cn('chip', !group && 'chip-active')} onClick={() => setGroup(false)}>
          Private
        </button>
        <button className={cn('chip', group && 'chip-active')} onClick={() => setGroup(true)}>
          <Users className="h-3.5 w-3.5" /> Group
        </button>
      </div>
      {group && (
        <Input label="Group name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Mini-project team" className="mb-3" />
      )}
      {group && picked.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {picked.map((u) => (
            <span key={u._id} className="chip">
              {u.name}
              <button aria-label={`Remove ${u.name}`} onClick={() => toggle(u)}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people by name, department or skill" autoFocus />
      <div className="mt-3 max-h-[46vh] space-y-1 overflow-y-auto">
        {isFetching && !people.length && <Skeleton className="h-14" />}
        {!isFetching && !people.length && <p className="py-8 text-center text-sm muted">No people match “{q}”.</p>}
        {people.map((u) => {
          const on = picked.some((x) => sameId(x, u));
          return (
            <button
              key={u._id}
              disabled={isLoading}
              onClick={() => (group ? toggle(u) : start([u._id]))}
              className={cn('flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors hover:bg-white/70 dark:hover:bg-white/5', on && 'bg-primary-500/10')}
            >
              <Avatar user={u} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{u.name}</p>
                <p className="truncate text-xs muted">
                  {ROLE_LABELS[u.role]}
                  {u.department ? ` · ${u.department}` : ''}
                </p>
              </div>
              {group && on && <Check className="h-4 w-4 text-primary-500" />}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/* ── Conversation list ──────────────────────────────────────────── */
function ConversationList({ activeId, me, presence, typing, onNew }) {
  const [search, setSearch] = useState('');
  const { data, isLoading, error, refetch } = useGetConversationsQuery(search ? { search } : undefined);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-4 pb-3">
        <h2 className="flex-1 text-lg font-extrabold tracking-tight">Messages</h2>
        <IconButton icon={Plus} label="New conversation" variant="primary" onClick={onNew} />
      </div>
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="input rounded-full py-2 pl-11" />
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mx-2 h-16" />)}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {data && !data.length && (
          <EmptyState
            icon={MessageCircle}
            title={search ? 'No chats found' : 'No conversations yet'}
            text={search ? undefined : 'Message a classmate, faculty member or club admin.'}
            action={!search && <Button size="sm" icon={Plus} onClick={onNew}>New message</Button>}
          />
        )}
        {data?.map((c) => {
          const d = describe(c, me);
          const online = d.other ? presence[d.other._id] ?? d.other.online : false;
          const isTyping = typing[c._id]?.length > 0;
          return (
            <Link
              key={c._id}
              to={`/chat/${c._id}`}
              className={cn(
                'flex items-center gap-3 rounded-2xl p-2.5 transition-all duration-300 ease-smooth',
                c._id === activeId ? 'bg-white/80 shadow-soft dark:bg-[#fff9f0]/80' : 'hover:bg-white/60 dark:hover:bg-white/5'
              )}
            >
              {d.group ? (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-fuchsia-500 text-white">
                  <Users className="h-5 w-5" />
                </span>
              ) : (
                <PresenceAvatar user={d.other} online={online} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={cn('truncate text-sm', c.unreadCount ? 'font-extrabold' : 'font-bold')}>{d.title}</p>
                  <span className="shrink-0 text-[11px] muted">{listTime(c.lastMessage?.sentAt || c.updatedAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={cn('truncate text-xs', isTyping ? 'font-semibold text-primary-600' : 'muted')}>
                    {isTyping
                      ? 'typing…'
                      : c.lastMessage?.body
                        ? `${sameId(c.lastMessage.sender, me) ? 'You: ' : ''}${c.lastMessage.body}`
                        : 'No messages yet'}
                  </p>
                  {c.unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 px-1.5 text-[10px] font-bold text-white">
                      {c.unreadCount > 99 ? '99+' : c.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ── Thread ─────────────────────────────────────────────────────── */
function MessageBubble({ m, mine, showAuthor, readState, onReply, onDelete, group }) {
  const deleted = Boolean(m.deletedAt);
  return (
    <div id={`msg-${m._id}`} className={cn('group flex gap-2', mine ? 'justify-end' : 'justify-start')}>
      {!mine && group && (showAuthor ? <Avatar user={m.sender} size="xs" className="mt-auto" /> : <span className="w-7 shrink-0" />)}
      <div className={cn('flex max-w-[78%] flex-col', mine ? 'items-end' : 'items-start')}>
        {showAuthor && !mine && group && <span className="mb-0.5 px-2 text-[11px] font-bold text-primary-600">{m.sender?.name}</span>}
        <div
          className={cn(
            'relative rounded-3xl px-4 py-2.5 text-sm leading-relaxed shadow-sm',
            mine ? 'rounded-br-lg bg-gradient-to-br from-primary-400 to-primary-600 text-white' : 'rounded-bl-lg bg-white/85 text-ink dark:bg-white',
            deleted && 'italic opacity-70'
          )}
        >
          {m.replyTo && !deleted && (
            <div className={cn('mb-1.5 rounded-xl border-l-4 px-2.5 py-1 text-xs', mine ? 'border-white/60 bg-white/15' : 'border-primary-400 bg-primary-500/10')}>
              <p className="font-bold">{m.replyTo.sender?.name || 'Message'}</p>
              <p className="line-clamp-2 opacity-80">{m.replyTo.deletedAt ? 'This message was deleted' : m.replyTo.body}</p>
            </div>
          )}
          <p className="whitespace-pre-wrap break-words">{m.body}</p>
          <span className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px]', mine ? 'text-white/75' : 'text-ink-muted')}>
            {fmtTime(m.createdAt)}
            {mine && !deleted && (readState === 'read' ? <CheckCheck className="h-3.5 w-3.5" aria-label="Read" /> : <Check className="h-3.5 w-3.5" aria-label="Sent" />)}
          </span>
        </div>
      </div>
      {!deleted && (
        <div className={cn('flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100', mine ? 'order-first' : '')}>
          <button onClick={() => onReply(m)} className="rounded-lg p-1.5 text-ink-muted hover:bg-white/70 hover:text-ink" aria-label="Reply">
            <CornerUpLeft className="h-3.5 w-3.5" />
          </button>
          {mine && (
            <button onClick={() => onDelete(m)} className="rounded-lg p-1.5 text-ink-muted hover:bg-rose-500/10 hover:text-rose-500" aria-label="Delete message">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Thread({ id, me, presence, typingUsers }) {
  const navigate = useNavigate();
  const { data: conv, isLoading: convLoading, error: convError, refetch } = useGetConversationQuery(id);
  const { data: first, isLoading, error } = useGetMessagesQuery({ id, limit: 40 }, { refetchOnMountOrArgChange: true });
  const [loadOlder, { isFetching: loadingOlder }] = useLazyGetMessagesQuery();
  const [send, { isLoading: sending }] = useSendMessageMutation();
  const [remove] = useDeleteMessageMutation();
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const typingTimer = useRef(null);
  const typingSent = useRef(false);

  useSocketRoom('chat:join', 'chat:leave', id);

  useEffect(() => {
    if (first) {
      setMessages(first.messages);
      setHasMore(first.pagination.total > first.messages.length);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView());
    }
  }, [first]);

  // Opening the thread marks it read (and tells the sender via read receipts).
  const markRead = useCallback(() => emitWithAck('chat:read', { conversationId: id }), [id]);
  useEffect(() => {
    markRead();
  }, [markRead, first]);

  useSocketEvent('chat:message', ({ conversationId, message }) => {
    if (conversationId !== id) return;
    setMessages((prev) => (prev.some((x) => x._id === message._id) ? prev : [...prev, message]));
    const nearBottom = scrollRef.current && scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight < 200;
    if (nearBottom || sameId(message.sender, me)) requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    if (!sameId(message.sender, me) && document.visibilityState === 'visible') markRead();
  });
  useSocketEvent('chat:messageDeleted', ({ conversationId, messageId }) => {
    if (conversationId !== id) return;
    setMessages((prev) => prev.map((m) => (m._id === messageId ? { ...m, body: 'This message was deleted', deletedAt: new Date().toISOString(), replyTo: null } : m)));
  });
  useSocketEvent('chat:read', ({ conversationId, userId }) => {
    if (conversationId !== id || sameId(userId, me)) return;
    setMessages((prev) => prev.map((m) => (sameId(m.sender, me) && !m.readBy?.some((r) => sameId(r, userId)) ? { ...m, readBy: [...(m.readBy || []), userId] } : m)));
  });

  const stopTyping = () => {
    clearTimeout(typingTimer.current);
    if (typingSent.current) emit('chat:typing', { conversationId: id, isTyping: false });
    typingSent.current = false;
  };
  useEffect(() => stopTyping, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onType = (v) => {
    setText(v);
    if (!typingSent.current && v.trim()) {
      emit('chat:typing', { conversationId: id, isTyping: true });
      typingSent.current = true;
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 2500);
  };

  const submit = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    stopTyping();
    try {
      const msg = await send({ id, body, replyTo: replyTo?._id }).unwrap();
      setMessages((prev) => (prev.some((x) => x._id === msg._id) ? prev : [...prev, msg]));
      setText('');
      setReplyTo(null);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (err) {
      toast.error(errMsg(err, 'Message not sent'));
    }
  };

  const older = async () => {
    const oldest = messages[0];
    if (!oldest) return;
    const prevHeight = scrollRef.current?.scrollHeight || 0;
    const res = await loadOlder({ id, before: oldest.createdAt, limit: 40 }).unwrap().catch(() => null);
    if (!res) return;
    setMessages((prev) => [...res.messages.filter((m) => !prev.some((p) => p._id === m._id)), ...prev]);
    setHasMore(res.pagination.total > res.messages.length);
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight;
    });
  };

  const del = async (m) => {
    try {
      await remove({ id, msgId: m._id }).unwrap();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const d = describe(conv, me);
  const others = conv?.participants.filter((p) => !sameId(p, me)) || [];
  const otherOnline = d.other ? presence[d.other._id] ?? d.other.online : false;
  const typingNames = (typingUsers || []).map((uid) => conv?.participants.find((p) => sameId(p, uid))?.name?.split(' ')[0]).filter(Boolean);

  const readStateOf = (m) => {
    if (!others.length) return 'sent';
    return others.every((o) => m.readBy?.some((r) => sameId(r, o))) ? 'read' : 'sent';
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? messages.filter((m) => !m.deletedAt && m.body.toLowerCase().includes(needle)) : messages;
  }, [messages, q]);

  if (convError) return <ErrorState error={convError} onRetry={refetch} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-white/60 p-3 dark:border-[#d8c9a8]/40 sm:p-4">
        <button className="btn-icon btn-ghost lg:hidden" onClick={() => navigate('/chat')} aria-label="Back to conversations">
          <ArrowLeft className="h-5 w-5" />
        </button>
        {convLoading ? (
          <Skeleton className="h-10 w-48" />
        ) : (
          <>
            {d.group ? (
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-fuchsia-500 text-white">
                <Users className="h-5 w-5" />
              </span>
            ) : (
              <Link to={`/people/${d.other?._id}`}>
                <PresenceAvatar user={d.other} online={otherOnline} />
              </Link>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-extrabold">{d.title}</p>
              <p className="truncate text-xs muted" aria-live="polite">
                {typingNames.length
                  ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…`
                  : d.group
                    ? others.map((o) => o.name.split(' ')[0]).join(', ')
                    : otherOnline
                      ? 'Online'
                      : d.other?.lastSeenAt
                        ? `Last seen ${timeAgo(d.other.lastSeenAt)}`
                        : d.subtitle}
              </p>
            </div>
            <IconButton icon={searchOpen ? X : Search} label={searchOpen ? 'Close search' : 'Search messages'} onClick={() => { setSearchOpen((o) => !o); setQ(''); }} />
          </>
        )}
      </header>
      {searchOpen && (
        <div className="border-b border-white/60 p-3 dark:border-[#d8c9a8]/40">
          <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in this conversation" autoFocus />
          {q && <p className="mt-1.5 text-xs muted">{shown.length} match{shown.length === 1 ? '' : 'es'} in loaded messages</p>}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-4 sm:px-5">
        {hasMore && !q && (
          <div className="flex justify-center pb-2">
            <Button size="sm" variant="soft" loading={loadingOlder} onClick={older}>
              Load earlier messages
            </Button>
          </div>
        )}
        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
          </div>
        )}
        {error && <ErrorState error={error} />}
        {!isLoading && !messages.length && !error && (
          <EmptyState icon={MessageCircle} title="Say hello 👋" text="Messages are delivered instantly on the web and the Android app." />
        )}
        {shown.map((m, i) => {
          const prev = shown[i - 1];
          const newDay = !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));
          const mine = sameId(m.sender, me);
          const showAuthor = newDay || !prev || !sameId(prev.sender, m.sender);
          return (
            <div key={m._id}>
              {newDay && (
                <div className="my-3 flex justify-center">
                  <span className="glass rounded-full px-3 py-1 text-[11px] font-bold muted">{dayDivider(m.createdAt)}</span>
                </div>
              )}
              <MessageBubble m={m} mine={mine} group={d.group} showAuthor={showAuthor} readState={mine ? readStateOf(m) : null} onReply={setReplyTo} onDelete={del} />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="border-t border-white/60 p-3 dark:border-[#d8c9a8]/40">
        {replyTo && (
          <div className="mb-2 flex items-start gap-2 rounded-2xl bg-primary-500/10 px-3 py-2 text-xs">
            <CornerUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-500" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">Replying to {sameId(replyTo.sender, me) ? 'yourself' : replyTo.sender?.name}</p>
              <p className="truncate muted">{replyTo.body}</p>
            </div>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) submit(e);
            }}
            rows={1}
            maxLength={5000}
            placeholder="Type a message…"
            aria-label="Message"
            className="input max-h-40 min-h-[46px] flex-1 resize-none rounded-3xl"
          />
          <Button type="submit" loading={sending} disabled={!text.trim()} className="h-[46px] w-[46px] rounded-full p-0" aria-label="Send">
            {!sending && <Send className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────── */
export default function Chat() {
  const { id } = useParams();
  const me = useSelector(selectUser);
  const [newOpen, setNewOpen] = useState(false);
  const [presence, setPresence] = useState({});
  const [typing, setTyping] = useState({}); // conversationId -> [userId]
  const timers = useRef({});

  useSocketEvent('presence:update', ({ userId, online }) => setPresence((p) => ({ ...p, [userId]: online })));
  useSocketEvent('chat:typing', ({ conversationId, userId, isTyping }) => {
    const key = `${conversationId}:${userId}`;
    clearTimeout(timers.current[key]);
    setTyping((t) => {
      const list = (t[conversationId] || []).filter((u) => u !== userId);
      return { ...t, [conversationId]: isTyping ? [...list, userId] : list };
    });
    // Safety net: clear a stale indicator if the "stopped" event never arrives.
    if (isTyping) {
      timers.current[key] = setTimeout(() => setTyping((t) => ({ ...t, [conversationId]: (t[conversationId] || []).filter((u) => u !== userId) })), 6000);
    }
  });
  useSocketEvent('chat:message', ({ conversationId, message }) => {
    setTyping((t) => ({ ...t, [conversationId]: (t[conversationId] || []).filter((u) => !sameId(u, message?.sender)) }));
  });
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  return (
    <div>
      <Card className="grid h-[calc(100vh-8.5rem)] min-h-[520px] overflow-hidden p-0 lg:grid-cols-[340px_1fr]">
        <aside className={cn('min-h-0 border-white/60 dark:border-[#d8c9a8]/40 lg:border-r', id && 'hidden lg:block')}>
          <ConversationList activeId={id} me={me} presence={presence} typing={typing} onNew={() => setNewOpen(true)} />
        </aside>
        <section className={cn('min-h-0', !id && 'hidden lg:block')}>
          {id ? (
            <Thread key={id} id={id} me={me} presence={presence} typingUsers={typing[id]} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={MessageCircle}
                title="Your messages"
                text="Pick a conversation or start a new one. Messages sync live between the web and the Android app."
                action={<Button icon={Plus} onClick={() => setNewOpen(true)}>New message</Button>}
              />
            </div>
          )}
        </section>
      </Card>
      <NewChatModal open={newOpen} onClose={() => setNewOpen(false)} me={me} />
    </div>
  );
}
