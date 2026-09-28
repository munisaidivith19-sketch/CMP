import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AlertTriangle, Bot, ExternalLink, Globe, Loader2, RotateCcw, Send, Trash2 } from 'lucide-react';
import { api, useDeleteAssistantConversationMutation, useLazyGetAssistantConversationQuery } from '../services/api';
import { streamAssistantChat } from '../services/studyAssistant';
import { selectUser } from '../features/authSlice';
import { cn } from './ui/primitives';
import Markdown from './Markdown';

/**
 * JNN Study Assistant — a medium-sized chat card that lives inside the
 * Study Materials dashboard. Talks only to our backend; which sources the
 * student may use is decided (and enforced) there.
 */

const MAX_LEN = 4000; // mirrors the backend default; the server is the real limit
const SUGGESTIONS = ['Explain a difficult topic', 'Summarize a concept', 'Analyze my study material', 'Find additional resources', 'Research a technical topic'];
const SOURCE_GROUPS = [
  { type: 'study_material', label: '📚 JNN Study Materials' },
  { type: 'web', label: '🌐 Web Research' },
  { type: 'dataset', label: '📊 Datasets' },
];

const storageKey = (userId) => `jnn-assistant:conversation:${userId}`;
const readStored = (userId) => {
  try {
    return localStorage.getItem(storageKey(userId)) || null;
  } catch {
    return null;
  }
};
const writeStored = (userId, id) => {
  try {
    if (id) localStorage.setItem(storageKey(userId), id);
    else localStorage.removeItem(storageKey(userId));
  } catch {
    /* storage unavailable — conversation just won't be restored */
  }
};

// Our own uploads open in-app; everything else must be a real http(s) URL.
const safeHref = (url) => (typeof url === 'string' && (/^https?:\/\//i.test(url) || url.startsWith('/uploads/')) ? url : null);

function Sources({ sources }) {
  if (!sources?.length) return null;
  return (
    <div className="mt-3 rounded-2xl border border-white/70 bg-white/40 p-3 dark:border-white/10 dark:bg-white/5">
      <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-wider muted">Sources</p>
      <div className="space-y-2.5">
        {SOURCE_GROUPS.map(({ type, label }) => {
          const items = sources.filter((s) => s.type === type);
          if (!items.length) return null;
          return (
            <div key={type}>
              <p className="text-xs font-bold">{label}</p>
              <ul className="mt-1 space-y-1">
                {items.map((s, i) => {
                  const href = safeHref(s.url);
                  const title = `${s.title}${s.page ? ` — Page ${s.page}` : ''}`;
                  const sub = s.publisher && s.publisher !== s.title ? s.publisher : null;
                  const body = (
                    <>
                      <span className="block truncate font-semibold">{title}</span>
                      {sub && <span className="block truncate text-[0.7rem] muted">{sub}</span>}
                    </>
                  );
                  return (
                    <li key={`${type}-${i}`} className="text-xs">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="group flex items-start gap-1.5 rounded-xl px-2 py-1 transition hover:bg-primary-500/10">
                          <span className="min-w-0 flex-1">{body}</span>
                          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-ink-muted group-hover:text-primary-500" />
                        </a>
                      ) : (
                        <div className="px-2 py-1">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold muted" role="status">
      <span className="flex gap-1">
        {[0, 150, 300].map((d) => (
          <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-400" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      Thinking…
    </div>
  );
}

function Message({ msg, onRetry }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-gradient-to-br from-primary-400 to-primary-600 px-4 py-2.5 text-sm text-white shadow-glow">
          {msg.content}
        </div>
      </div>
    );
  }
  if (msg.error) {
    return (
      <div className="flex items-start gap-2 rounded-2xl border border-rose-300/60 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-600 dark:text-rose-300" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="flex-1">{msg.error}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-bold hover:underline">
            <RotateCcw className="h-3 w-3" /> Retry
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-400 to-fuchsia-500 text-white">
        <Bot className="h-4 w-4" />
      </span>
      <div className="min-w-0 max-w-[92%] flex-1 rounded-3xl rounded-tl-lg bg-white/80 px-4 py-3 text-ink shadow-sm dark:bg-white/10 dark:text-primary-50">
        {msg.pending && !msg.content ? (
          <Thinking />
        ) : (
          <>
            <Markdown text={msg.content} />
            {msg.pending && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary-400 align-middle" />}
          </>
        )}
        {msg.notices?.map((n) => (
          <p key={n} className="mt-2 rounded-xl bg-amber-500/10 px-2.5 py-1.5 text-[0.7rem] font-medium text-amber-700 dark:text-amber-300">
            {n}
          </p>
        ))}
        {!msg.pending && <Sources sources={msg.sources} />}
      </div>
    </div>
  );
}

export default function StudyAssistant({ className }) {
  const me = useSelector(selectUser);
  const dispatch = useDispatch();
  const [conversationId, setConversationId] = useState(() => readStored(me._id));
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const [loadConversation, { isFetching: restoring }] = useLazyGetAssistantConversationQuery();
  const [deleteConversation] = useDeleteAssistantConversationMutation();
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // Restore the last conversation (ids only are kept in the browser).
  useEffect(() => {
    const id = readStored(me._id);
    if (!id) return;
    loadConversation(id)
      .unwrap()
      .then((c) => setMessages(c.messages || []))
      .catch(() => {
        writeStored(me._id, null);
        setConversationId(null);
      });
  }, [me._id, loadConversation]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest content in view while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    async (text) => {
      const question = text.trim();
      if (!question || busy) return;
      setBusy(true);
      setInput('');
      const pendingId = `pending-${Date.now()}`;
      setMessages((m) => [
        ...m.filter((x) => !x.error),
        { _id: `u-${pendingId}`, role: 'user', content: question },
        { _id: pendingId, role: 'assistant', content: '', pending: true },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await streamAssistantChat(
          { conversationId: conversationId || undefined, message: question, useStudyMaterials: true, useWebSearch: webSearch },
          {
            signal: controller.signal,
            onDelta: (delta) => setMessages((m) => m.map((x) => (x._id === pendingId ? { ...x, content: x.content + delta } : x))),
          }
        );
        // Swap the streamed draft for the saved message (final text + verified sources).
        setMessages((m) => m.map((x) => (x._id === pendingId ? result.message : x)));
        setConversationId(result.conversationId);
        writeStored(me._id, result.conversationId);
        dispatch(api.util.invalidateTags(['AssistantConversation']));
      } catch (err) {
        if (controller.signal.aborted) return;
        // Drop the half-written draft and the unsent question; offer a retry instead.
        setMessages((m) => [...m.filter((x) => x._id !== pendingId && x._id !== `u-${pendingId}`), { _id: `err-${pendingId}`, role: 'assistant', error: err.message, retry: question }]);
        if (err.status === 404) {
          setConversationId(null);
          writeStored(me._id, null);
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [busy, conversationId, webSearch, me._id, dispatch]
  );

  const clear = async () => {
    abortRef.current?.abort();
    const id = conversationId;
    setMessages([]);
    setConversationId(null);
    writeStored(me._id, null);
    if (id) await deleteConversation(id).catch(() => {});
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const tooLong = input.length > MAX_LEN;

  return (
    <section className={cn('card flex h-[560px] flex-col !p-0 sm:h-[620px]', className)} aria-label="JNN Study Assistant">
      {/* Header */}
      <header className="flex items-start gap-3 border-b border-white/70 px-4 py-3.5 dark:border-white/10 sm:px-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-fuchsia-500 text-lg text-white shadow-glow" aria-hidden>
          🤖
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-extrabold tracking-tight sm:text-base">JNN Study Assistant</h2>
          <p className="text-[0.7rem] leading-snug muted sm:text-xs">Ask questions, explore study resources, and learn with AI.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setWebSearch((v) => !v)}
            aria-pressed={webSearch}
            title={webSearch ? 'Web research on — the assistant may search the web when useful' : 'Web research off — answers use JNN materials and general knowledge'}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.65rem] font-bold transition',
              webSearch
                ? 'border-transparent bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-glow'
                : 'border-white/70 bg-white/50 text-ink-soft hover:bg-white/80 dark:border-white/15 dark:bg-white/5 dark:text-ink-muted'
            )}
          >
            <Globe className="h-3 w-3" /> Web
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={!messages.length && !conversationId}
            className="rounded-xl p-2 text-ink-soft transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40 dark:text-ink-muted"
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5" aria-live="polite">
        {restoring && !messages.length ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
          </div>
        ) : !messages.length ? (
          <div className="flex h-full flex-col justify-center gap-3 text-sm">
            <p className="text-base font-extrabold">👋 Hi! I'm JNN Study Assistant.</p>
            <p className="muted">Ask me to:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => { setInput(`${s}: `); inputRef.current?.focus(); }}>
                  • {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Message key={m._id} msg={m} onRetry={m.retry && !busy ? () => send(m.retry) : null} />)
        )}
      </div>

      {/* Composer */}
      <form
        className="border-t border-white/70 p-3 dark:border-white/10 sm:p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tooLong) send(input);
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask JNN Study Assistant..."
            aria-label="Ask JNN Study Assistant"
            className={cn('input max-h-32 min-h-[44px] resize-none', tooLong && 'input-error')}
            style={{ height: `${Math.min(128, 44 + Math.max(0, input.split('\n').length - 1) * 20)}px` }}
          />
          <button type="submit" disabled={busy || !input.trim() || tooLong} className="btn btn-primary h-11 w-11 shrink-0 !rounded-2xl !p-0 disabled:opacity-50" aria-label="Send">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <div className="mt-1.5 flex justify-between gap-2 px-1 text-[0.65rem] muted">
          <span>AI can make mistakes — check important facts with your sources.</span>
          {input.length > MAX_LEN * 0.8 && <span className={cn(tooLong && 'font-bold text-rose-500')}>{input.length}/{MAX_LEN}</span>}
        </div>
      </form>
    </section>
  );
}
