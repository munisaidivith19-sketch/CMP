import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Clock,
  Coins,
  Copy,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Lock,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { attachMaterial, explainInDetail, fetchMaterials, initChats, newChat, openChat, removeChat, renameChat, sendDoubt, useStudyDoubts } from '../services/studyDoubts';
import { selectUser } from '../features/authSlice';
import { cn } from './ui/primitives';
import Markdown from './Markdown';

/**
 * "AI Doubts" tab on Study Materials — chat with the self-hosted, strictly
 * restricted Study Doubts model. Separate from the JNN Study Assistant
 * card on the Study Materials tab.
 *
 * All chat state lives in services/studyDoubts.js, so switching tabs keeps
 * the conversation (and any answer still being written).
 */

const MAX_LEN = 1500; // mirrors LOCAL_AI_MAX_MESSAGE_LENGTH; the server is the real limit
const EXAMPLES = ['Explain normalization in DBMS with an example', 'What is the difference between TCP and UDP?', 'Solve: 3x + 5 = 20, show the steps', 'Summarize the key points of my latest notes'];

const safeHref = (url) => (typeof url === 'string' && (/^https?:\/\//i.test(url) || url.startsWith('/uploads/')) ? url : null);

function timeLeft(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'expiring';
  const h = Math.floor(ms / 3600000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.floor(ms / 60000))}m left`;
}

const untilText = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const charged = (credits) => Boolean(credits?.enabled && !credits.unlimited);

function Sources({ sources }) {
  if (!sources?.length) return null;
  return (
    <div className="mt-3 rounded-2xl border border-white/70 bg-white/40 p-3 dark:border-white/10 dark:bg-white/5">
      <p className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-wider muted">📚 From your study materials</p>
      <ul className="space-y-1">
        {sources.map((s, i) => {
          const href = safeHref(s.url);
          const title = `${s.title}${s.page ? ` — Page ${s.page}` : ''}`;
          const body = (
            <>
              <span className="block truncate font-semibold">{title}</span>
              {s.publisher && s.publisher !== s.title && <span className="block truncate text-[0.7rem] muted">{s.publisher}</span>}
            </>
          );
          return (
            <li key={i} className="text-xs">
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
}

function Thinking({ slow, position }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold muted" role="status">
      <span className="flex gap-1">
        {[0, 150, 300].map((d) => (
          <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      {position > 0 ? (
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" /> Many students are asking right now — you're #{position} in line…
        </span>
      ) : slow ? (
        'Still working — answers from the college server can take up to a minute…'
      ) : (
        'Thinking…'
      )}
    </div>
  );
}

function Message({ msg, s, isLast, onRetry }) {
  if (msg.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        {(msg.material?.title || msg.mode === 'detailed') && (
          <span className="flex flex-wrap justify-end gap-1">
            {msg.mode === 'detailed' && <span className="chip !py-0.5 text-[0.65rem]">Explain in detail</span>}
            {msg.mode === 'exam' && <span className="chip !py-0.5 text-[0.65rem]">Exam answer</span>}
            {msg.material?.title && (
              <span className="chip inline-flex max-w-[16rem] items-center gap-1 !py-0.5 text-[0.65rem]">
                <FileText className="h-3 w-3 shrink-0" /> <span className="truncate">{msg.material.title}</span>
              </span>
            )}
          </span>
        )}
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-gradient-to-br from-emerald-500 to-teal-600 px-4 py-2.5 text-sm text-white shadow-glow">{msg.content}</div>
      </div>
    );
  }
  if (msg.error) {
    return (
      <div className="flex items-start gap-2 rounded-2xl border border-rose-300/60 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-600 dark:text-rose-300" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="flex-1">{msg.error}</span>
        {msg.code === 'AI_CHAT_FULL' && (
          <button type="button" onClick={newChat} className="inline-flex items-center gap-1 font-bold hover:underline">
            <Plus className="h-3 w-3" /> New chat
          </button>
        )}
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-bold hover:underline">
            <RotateCcw className="h-3 w-3" /> Retry
          </button>
        )}
      </div>
    );
  }
  const canExpand = isLast && !msg.pending && !msg.refused && msg.mode !== 'detailed' && msg.mode !== 'exam' && !s.busy && s.questionsLeft !== 0;
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white">
        <Sparkles className="h-4 w-4" />
      </span>
      <div
        className={cn(
          'min-w-0 max-w-[92%] flex-1 rounded-3xl rounded-tl-lg px-4 py-3 text-ink shadow-xs dark:text-primary-50',
          msg.refused ? 'border border-amber-300/60 bg-amber-500/10' : 'bg-white/80 dark:bg-white/10'
        )}
      >
        {msg.pending && !msg.content ? (
          <Thinking slow={s.slow} position={s.queuePosition} />
        ) : (
          <>
            {msg.refused && (
              <p className="mb-1 flex items-center gap-1 text-[0.65rem] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                <Lock className="h-3 w-3" /> Outside study topics
              </p>
            )}
            <Markdown text={msg.content} />
            {msg.pending && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-xs bg-emerald-400 align-middle" />}
          </>
        )}
        {!msg.pending && <Sources sources={msg.sources} />}
        {!msg.pending && !msg.refused && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[0.65rem] muted">
            <CopyButton text={msg.content} />
            {canExpand && (
              <button type="button" onClick={() => explainInDetail(msg._id)} className="btn btn-ghost h-7 gap-1 !rounded-xl !px-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                <Layers className="h-3.5 w-3.5" /> Explain in detail
                {charged(s.credits) && <span className="font-normal muted">· up to {s.credits.costs?.long ?? 15} credits</span>}
              </button>
            )}
            {msg.mode === 'exam' && (
              <span className="inline-flex items-center gap-1 font-semibold" title="Written like an exam answer, with the length the marks need.">
                <Layers className="h-3 w-3" /> Exam answer{msg.marks ? ` · ${msg.marks} marks` : ''}
              </span>
            )}
            {msg.cached && (
              <span className="inline-flex items-center gap-1" title="Another student asked the same question about the same materials, so this answer was reused instantly.">
                <Zap className="h-3 w-3" /> Instant answer
              </span>
            )}
            {charged(s.credits) && msg.cost > 0 && (
              <span className="inline-flex items-center gap-1">
                <Coins className="h-3 w-3" /> {msg.cost} credits
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(text || '').replace(/ ?\[S\d+\]/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Copy answer" title="Copy">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Inline rename: Enter or ✓ saves, Esc or ✕ cancels. */
function TitleEditor({ chat, onDone, className }) {
  const [value, setValue] = useState(chat.title);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const save = async () => {
    const title = value.replace(/\s+/g, ' ').trim();
    onDone();
    if (!title || title === chat.title) return;
    try {
      await renameChat(chat._id, title);
    } catch (err) {
      toast.error(err.message || "Couldn't rename the chat");
    }
  };
  return (
    <form
      className={cn('flex min-w-0 flex-1 items-center gap-1', className)}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        ref={inputRef}
        value={value}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onDone();
          }
        }}
        aria-label="Chat name"
        className="input h-8 min-w-0 flex-1 !rounded-xl !px-2.5 !py-1 text-xs font-bold"
      />
      <button type="submit" disabled={!value.trim()} className="rounded-lg p-1 text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-40 dark:text-emerald-300" aria-label="Save name" title="Save">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onDone} className="rounded-lg p-1 text-ink-soft hover:bg-white/60 dark:text-ink-muted dark:hover:bg-white/10" aria-label="Cancel rename" title="Cancel">
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}

const percent = (used, total) => (total > 0 ? Math.max(0, Math.min(100, Math.round((used / total) * 100))) : 0);

/** One usage line: label, bar, "used / total (x%)" and remaining. */
function UsageLine({ label, used, total, remaining, warn }) {
  const pct = percent(used, total);
  const color = pct >= 90 ? 'bg-rose-500' : warn || pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.65rem] font-bold uppercase tracking-wider muted">{label}</span>
        <span className="text-[0.7rem] font-bold tabular-nums">{pct}% used</span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/10"
        role="progressbar"
        aria-label={`${label}: ${pct}% used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between gap-2 text-[0.7rem] tabular-nums">
        <span>
          <b>{used}</b> <span className="muted">of {total} used</span>
        </span>
        <span>
          <b>{remaining}</b> <span className="muted">remaining</span>
        </span>
      </div>
    </div>
  );
}

/** Compact monthly usage line for the chat header (top-left, under the title). */
function HeaderUsage({ credits }) {
  if (!charged(credits)) return null;
  const total = credits.monthly + (credits.bonus || 0);
  const pct = percent(credits.used, total);
  const color = pct >= 90 ? 'bg-rose-500' : credits.low || pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] tabular-nums">
      <Coins className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
      <div
        className="h-1.5 w-28 overflow-hidden rounded-full bg-black/10 dark:bg-white/10 sm:w-40"
        role="progressbar"
        aria-label={`Credits this month: ${pct}% used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-bold">{pct}%</span>
      <span className="muted">
        <b className="text-ink dark:text-primary-50">{credits.used}</b> / {total} used · <b className={cn(credits.low ? 'text-amber-600 dark:text-amber-300' : 'text-ink dark:text-primary-50')}>{credits.remaining}</b> left
      </span>
    </div>
  );
}

function CreditsCard({ credits, compact = false }) {
  if (!charged(credits)) return null;
  const monthTotal = credits.monthly + (credits.bonus || 0);
  return (
    <div className={cn('space-y-2.5 rounded-2xl border px-3 py-2.5 text-xs', credits.low ? 'border-amber-300/70 bg-amber-500/10' : 'border-white/70 bg-white/40 dark:border-white/10 dark:bg-white/5')}>
      <p className="flex items-center gap-1.5 font-bold">
        <Coins className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" /> AI Doubts credits
        {credits.bonus > 0 && <span className="font-normal muted">(incl. {credits.bonus} bonus)</span>}
      </p>
      <UsageLine label="This month" used={credits.used} total={monthTotal} remaining={credits.remaining} warn={credits.low} />
      <UsageLine label="Today" used={credits.dayUsed} total={credits.daily} remaining={credits.dayRemaining} />
      {!compact && (
        <p className="text-[0.65rem] leading-snug muted">
          Short answer {credits.costs?.short}, normal {credits.costs?.normal}, detailed up to {credits.costs?.long}, instant {credits.costs?.cached}. Refusals and errors are free.
        </p>
      )}
      {credits.low && <p className="text-[0.65rem] font-bold text-amber-700 dark:text-amber-300">Running low — credits reset on the 1st of next month.</p>}
    </div>
  );
}

function ChatList({ s }) {
  const [editingId, setEditingId] = useState(null);
  return (
    <aside className="card flex flex-col gap-3 !p-3 lg:h-full" aria-label="Your AI Doubts chats">
      <button type="button" onClick={newChat} disabled={s.busy} className="btn btn-primary w-full justify-center gap-2 disabled:opacity-50">
        <Plus className="h-4 w-4" /> New chat
      </button>

      <div className="flex gap-2 overflow-x-auto scrollbar-none lg:flex-1 lg:flex-col lg:overflow-y-auto">
        {s.loadingList && !s.chats.length ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
          </div>
        ) : !s.chats.length ? (
          <p className="px-1 py-2 text-xs muted">No saved chats yet. Ask a study doubt to start one.</p>
        ) : (
          s.chats.map((c) => {
            const active = s.activeId === c._id;
            return (
              <div
                key={c._id}
                className={cn(
                  'group flex min-w-[200px] items-start gap-2 rounded-2xl border px-3 py-2.5 transition lg:min-w-0',
                  active ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-white/70 bg-white/40 hover:bg-white/70 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10'
                )}
              >
                {editingId === c._id ? (
                  <TitleEditor chat={c} onDone={() => setEditingId(null)} />
                ) : (
                  <>
                    <button type="button" onClick={() => openChat(c._id)} disabled={s.busy} className="min-w-0 flex-1 text-left disabled:cursor-not-allowed" aria-current={active ? 'true' : undefined}>
                      <span className="flex items-center gap-1.5 text-xs font-bold">
                        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
                        <span className="truncate">{c.title}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[0.65rem] muted">
                        <Clock className="h-3 w-3" /> {timeLeft(c.expiresAt)}
                        {c.questionCount != null && <span>· {c.questionCount}/{s.maxQuestions}</span>}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(c._id)}
                      className="rounded-lg p-1 text-ink-soft opacity-70 transition hover:bg-emerald-500/10 hover:text-emerald-600 group-hover:opacity-100 dark:text-ink-muted"
                      aria-label={`Rename chat: ${c.title}`}
                      title="Rename chat"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeChat(c._id)}
                      disabled={s.busy}
                      className="rounded-lg p-1 text-ink-soft opacity-70 transition hover:bg-rose-500/10 hover:text-rose-500 group-hover:opacity-100 disabled:opacity-30 dark:text-ink-muted"
                      aria-label={`Delete chat: ${c.title}`}
                      title="Delete chat"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="hidden lg:block">
        <CreditsCard credits={s.credits} />
      </div>

      <p className="hidden rounded-xl bg-white/40 px-2.5 py-2 text-[0.65rem] leading-snug muted dark:bg-white/5 lg:block">
        You can keep {s.maxChats} chats of up to {s.maxQuestions} questions. Starting a new one removes the oldest. Each chat is deleted {Math.round(s.retentionHours / 24)} days after it starts.
      </p>
    </aside>
  );
}

/** Pick one of your own study materials for the assistant to read. */
function MaterialPicker({ onClose }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetchMaterials(q.trim())
        .then((d) => alive && (setItems(d.items || []), setError('')))
        .catch((err) => alive && setError(err.message));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="mb-2 rounded-2xl border border-white/70 bg-white/80 p-2.5 shadow-lg backdrop-blur dark:border-white/10 dark:bg-ink/90" role="dialog" aria-label="Attach a study material">
      <div className="mb-2 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder="Search your study materials…"
            className="input h-9 w-full !rounded-xl !pl-8 text-xs"
            aria-label="Search study materials"
          />
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-soft hover:bg-white/60 dark:hover:bg-white/10" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {error ? (
          <p className="px-2 py-3 text-xs text-rose-500">{error}</p>
        ) : !items ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
          </div>
        ) : !items.length ? (
          <p className="px-2 py-3 text-xs muted">No study materials found.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={!m.readable}
                  onClick={() => {
                    attachMaterial(m);
                    onClose();
                  }}
                  className="flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  title={m.readable ? 'Ask questions about this material' : 'Only PDF and text files can be read by the assistant'}
                >
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{m.title}</span>
                    <span className="block truncate text-[0.65rem] muted">
                      {[m.subject, m.semester ? `Sem ${m.semester}` : null, m.readable ? null : 'not readable'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function StudyDoubtsChat({ className }) {
  const me = useSelector(selectUser);
  const s = useStudyDoubts();
  const [input, setInput] = useState('');
  const [picking, setPicking] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (me?._id) initChats(me._id);
  }, [me?._id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.messages]);

  const blocked = s.blockedUntil && new Date(s.blockedUntil) > new Date();
  const chatFull = s.activeId && s.questionsLeft === 0;
  const outOfCredits = charged(s.credits) && s.credits.available < (s.credits.costs?.short ?? 5);
  const locked = blocked || chatFull || outOfCredits;

  const send = (text, opts) => {
    if (!text.trim() || s.busy || locked || text.trim().length > MAX_LEN) return;
    setInput('');
    sendDoubt(text, opts).finally(() => inputRef.current?.focus());
  };

  const [renaming, setRenaming] = useState(false);
  const tooLong = input.length > MAX_LEN;
  const active = s.chats.find((c) => c._id === s.activeId);
  useEffect(() => setRenaming(false), [s.activeId]);
  const lastAnswerId = [...s.messages].reverse().find((m) => m.role === 'assistant' && !m.error)?._id;

  return (
    <div className={cn('grid gap-4 lg:h-[calc(100dvh-15rem)] lg:min-h-[540px] lg:grid-cols-[260px_minmax(0,1fr)]', className)}>
      <ChatList s={s} />

      <section className="card flex h-[calc(100dvh-14rem)] min-h-[480px] flex-col !p-0 lg:h-auto" aria-label="AI Doubts">
        <header className="flex items-start gap-3 border-b border-white/70 px-4 py-3.5 dark:border-white/10 sm:px-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-glow" aria-hidden>
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            {active && renaming ? (
              <TitleEditor chat={active} onDone={() => setRenaming(false)} className="max-w-md" />
            ) : (
              <div className="flex min-w-0 items-center gap-1">
                <h2 className="truncate text-sm font-extrabold tracking-tight sm:text-base">{active ? active.title : 'AI Doubts'}</h2>
                {active && (
                  <button
                    type="button"
                    onClick={() => setRenaming(true)}
                    className="shrink-0 rounded-lg p-1 text-ink-soft transition hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-ink-muted"
                    aria-label="Rename chat"
                    title="Rename chat"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            <p className="text-[0.7rem] leading-snug muted sm:text-xs">
              {active
                ? `Saved chat · ${timeLeft(active.expiresAt)}${s.questionsLeft != null ? ` · ${s.questionsLeft} questions left` : ''}`
                : 'Clear doubts about your study materials, concepts and subjects.'}
            </p>
            <HeaderUsage credits={s.credits} />
          </div>
          {charged(s.credits) && (
            <button
              type="button"
              onClick={() => setShowCredits((v) => !v)}
              aria-expanded={showCredits}
              className={cn('chip shrink-0 gap-1 !py-1 text-[0.7rem] font-bold lg:hidden', s.credits.low && '!bg-amber-500/15 text-amber-700 dark:text-amber-300')}
              title="Show credit usage"
            >
              <Coins className="h-3.5 w-3.5" /> Today {s.credits.dayRemaining}
            </button>
          )}
        </header>
        {showCredits && charged(s.credits) && (
          <div className="border-b border-white/70 px-4 py-3 dark:border-white/10 lg:hidden">
            <CreditsCard credits={s.credits} compact />
          </div>
        )}

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" aria-live="polite">
          {s.opening ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
            </div>
          ) : !s.messages.length ? (
            <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-4 text-sm">
              <div>
                <p className="text-base font-extrabold">👋 Ask me any study doubt</p>
                <p className="mt-1 muted">
                  I give a short answer first — press <b>Explain in detail</b> if you want more. Attach one of your study materials with <Paperclip className="inline h-3.5 w-3.5" /> to ask about it.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((q) => (
                  <button key={q} type="button" className="chip" disabled={locked} onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
              <ul className="space-y-1.5 rounded-2xl bg-white/40 p-3 text-xs muted dark:bg-white/5">
                <li className="flex gap-2"><BookOpen className="h-3.5 w-3.5 shrink-0" /> Uses only the study materials you can already see.</li>
                <li className="flex gap-2"><Lock className="h-3.5 w-3.5 shrink-0" /> No access to attendance, marks, accounts or anyone's personal details.</li>
                <li className="flex gap-2"><Clock className="h-3.5 w-3.5 shrink-0" /> Up to {s.maxChats} saved chats of {s.maxQuestions} questions, each deleted {Math.round(s.retentionHours / 24)} days after it starts. The assistant remembers the last {s.memoryMinutes} minutes of a chat.</li>
              </ul>
              <div className="lg:hidden">
                <CreditsCard credits={s.credits} />
              </div>
            </div>
          ) : (
            s.messages.map((m) => (
              <Message
                key={m._id}
                msg={m}
                s={s}
                isLast={m._id === lastAnswerId}
                onRetry={m.retry && !s.busy && !locked ? () => send(m.retry.question, { mode: m.retry.mode, material: m.retry.material }) : null}
              />
            ))
          )}
        </div>

        <form
          className="relative border-t border-white/70 p-3 dark:border-white/10 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          {blocked ? (
            <p className="mb-2 flex items-start gap-2 rounded-2xl bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300" role="alert">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> AI Doubts is paused for your account until {untilText(s.blockedUntil)} because of repeated requests that break the rules.
            </p>
          ) : chatFull ? (
            <p className="mb-2 flex items-center gap-2 rounded-2xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" /> This chat has reached {s.maxQuestions} questions.
              <button type="button" onClick={newChat} className="ml-auto font-bold hover:underline">
                Start a new chat
              </button>
            </p>
          ) : outOfCredits ? (
            <p className="mb-2 flex items-start gap-2 rounded-2xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <Coins className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {s.credits.remaining < (s.credits.costs?.short ?? 5) ? "You've used this month's credits. They reset on the 1st." : "You've reached today's limit. Please continue tomorrow."}
            </p>
          ) : null}

          {picking && <MaterialPicker onClose={() => setPicking(false)} />}
          {s.attached && (
            <div className="mb-2 flex">
              <span className="chip inline-flex max-w-full items-center gap-1.5 !py-1 text-xs">
                <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
                <span className="truncate">Asking about: {s.attached.title}</span>
                <button type="button" onClick={() => attachMaterial(null)} className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Remove attached material">
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          )}

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setPicking((v) => !v)}
              disabled={s.busy || locked}
              className={cn('btn btn-ghost h-11 w-11 shrink-0 !rounded-2xl !p-0 disabled:opacity-50', (picking || s.attached) && 'text-emerald-600 dark:text-emerald-300')}
              aria-label="Attach a study material"
              title="Ask about one of your study materials"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              disabled={locked}
              placeholder={s.attached ? 'Ask about this material…' : active ? 'Ask a follow-up…' : 'Type your study doubt…'}
              aria-label="Type your study doubt"
              className={cn('input max-h-32 min-h-[44px] resize-none disabled:opacity-60', tooLong && 'input-error')}
              style={{ height: `${Math.min(128, 44 + Math.max(0, input.split('\n').length - 1) * 20)}px` }}
            />
            <button type="submit" disabled={s.busy || locked || !input.trim() || tooLong} className="btn btn-primary h-11 w-11 shrink-0 !rounded-2xl !p-0 disabled:opacity-50" aria-label="Send">
              {s.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-1.5 flex justify-between gap-2 px-1 text-[0.65rem] muted">
            <span>AI can make mistakes — check important facts with your notes.</span>
            {input.length > MAX_LEN * 0.8 && <span className={cn(tooLong && 'font-bold text-rose-500')}>{input.length}/{MAX_LEN}</span>}
          </div>
        </form>
      </section>
    </div>
  );
}
