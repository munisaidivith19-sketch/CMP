import { useSyncExternalStore } from 'react';
import { store } from '../app/store';
import { loggedOut, setCredentials } from '../features/authSlice';
import { getCsrfCookie, refreshSession } from './api';

/**
 * AI Doubts tab — client for the self-hosted Study Doubts model (server/ai).
 * Separate from the JNN Study Assistant in studyAssistant.js.
 *
 * Chat state lives in a small module-level store (not in the component), so
 * switching tabs never loses the chat — an answer that is still streaming
 * keeps arriving, and is there when the student comes back. Saved chats,
 * limits and credits always come from the server.
 */

const BASE = '/api/ai/study-doubts';

// ── HTTP with session refresh ────────────────────────────────────────

async function authedFetch(path, init = {}) {
  const send = () =>
    fetch(`${BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init.headers || {}),
        ...(store.getState().auth.accessToken ? { authorization: `Bearer ${store.getState().auth.accessToken}` } : {}),
        ...(getCsrfCookie() ? { 'x-csrf-token': getCsrfCookie() } : {}),
      },
    });
  let res = await send();
  if (res.status === 401) {
    const session = await refreshSession();
    if (!session?.accessToken) {
      store.dispatch(loggedOut());
      throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
    }
    store.dispatch(setCredentials(session));
    res = await send();
  }
  return res;
}

async function json(path, init) {
  const res = await authedFetch(path, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.message || 'Something went wrong. Please try again.'), { status: res.status, code: data?.code });
  return data;
}

export const fetchChats = () => json('/conversations');
export const fetchChat = (id) => json(`/conversations/${id}`);
export const fetchMe = () => json('/me');
export const fetchMaterials = (q = '') => json(`/materials${q ? `?q=${encodeURIComponent(q)}` : ''}`);
export const deleteChat = (id) => json(`/conversations/${id}`, { method: 'DELETE' });
export const patchChat = (id, title) => json(`/conversations/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });

/**
 * Streamed answer. Resolves with { conversationId, title, expiresAt, questionsLeft, credits, message }.
 * onEvent receives 'queue' ({ position }) and 'cached'.
 */
export async function streamStudyDoubt({ message, conversationId, mode, materialId }, { onDelta, onEvent } = {}) {
  const res = await authedFetch('/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}), ...(mode ? { mode } : {}), ...(materialId ? { materialId } : {}), stream: true }),
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('text/event-stream')) {
    const data = await res.json().catch(() => null);
    throw Object.assign(new Error(data?.message || 'The AI doubts assistant is unavailable right now. Please try again.'), { status: res.status, code: data?.code });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const raw = /^data: (.+)$/m.exec(block)?.[1];
      if (!event || !raw) continue;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      if (event === 'delta' && typeof data.text === 'string') onDelta?.(data.text);
      else if (event === 'queue' || event === 'cached' || event === 'restart') onEvent?.(event, data);
      else if (event === 'done') final = data;
      else if (event === 'error') throw Object.assign(new Error(data.message || 'Something went wrong.'), { status: data.status, code: data.code });
    }
  }
  if (!final) throw Object.assign(new Error('The connection was interrupted. Your answer may still be saved — open the chat again in a moment.'), { status: 0 });
  return final;
}

// ── Chat store (survives tab switches) ───────────────────────────────

const initial = () => ({
  userId: null,
  loaded: false,
  loadingList: false,
  chats: [], // [{ _id, title, updatedAt, expiresAt, questionCount }]
  maxChats: 3,
  retentionHours: 48,
  maxQuestions: 50,
  memoryMinutes: 30,
  credits: null, // { enabled, unlimited, remaining, dayRemaining, low, costs … }
  blockedUntil: null,
  activeId: null, // null = new chat
  messages: [],
  questionsLeft: null,
  opening: false,
  busy: false,
  slow: false,
  queuePosition: 0,
  attached: null, // { id, title } study material attached to the next question
});

let state = initial();
const listeners = new Set();
const set = (patch) => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
};
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useStudyDoubts() {
  return useSyncExternalStore(subscribe, () => state);
}

const applyLimits = (d) => ({
  maxChats: d.maxConversations ?? state.maxChats,
  retentionHours: d.retentionHours ?? state.retentionHours,
  maxQuestions: d.maxQuestionsPerConversation ?? state.maxQuestions,
  memoryMinutes: d.memoryMinutes ?? state.memoryMinutes,
});

export async function refreshMe() {
  try {
    const me = await fetchMe();
    set({ credits: me.credits || null, blockedUntil: me.blockedUntil || null, ...applyLimits(me.limits || {}) });
  } catch {
    /* keep what we have */
  }
}

/** Load the chat list once per signed-in user (a different user starts fresh). */
export async function initChats(userId) {
  if (state.userId !== userId) state = { ...initial(), userId };
  if (state.loaded || state.loadingList) return;
  set({ loadingList: true });
  try {
    const [data] = await Promise.all([fetchChats(), refreshMe()]);
    set({ chats: data.items || [], ...applyLimits(data), loaded: true });
  } catch {
    set({ loaded: true });
  } finally {
    set({ loadingList: false });
  }
}

async function refreshList() {
  try {
    const data = await fetchChats();
    set({ chats: data.items || [] });
  } catch {
    /* keep the current list */
  }
}

export function newChat() {
  if (state.busy) return;
  set({ activeId: null, messages: [], questionsLeft: null });
}

export async function openChat(id) {
  if (state.busy || state.activeId === id) return;
  set({ activeId: id, messages: [], opening: true, questionsLeft: null });
  try {
    const convo = await fetchChat(id);
    if (state.activeId === id) set({ messages: convo.messages || [], questionsLeft: convo.questionsLeft ?? null });
  } catch (err) {
    set({ activeId: null, messages: [{ _id: `err-${Date.now()}`, role: 'assistant', error: err.message }] });
    refreshList();
  } finally {
    set({ opening: false });
  }
}

/** Rename a saved chat. Updates the list right away; reverts if the server refuses. */
export async function renameChat(id, title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const before = state.chats.find((c) => c._id === id);
  if (!clean || !before || clean === before.title) return;
  set((s) => ({ chats: s.chats.map((c) => (c._id === id ? { ...c, title: clean } : c)) }));
  try {
    const { conversation } = await patchChat(id, clean);
    set((s) => ({ chats: s.chats.map((c) => (c._id === id ? { ...c, title: conversation.title } : c)) }));
  } catch (err) {
    set((s) => ({ chats: s.chats.map((c) => (c._id === id ? { ...c, title: before.title } : c)) }));
    throw err;
  }
}

export async function removeChat(id) {
  if (state.busy) return;
  set((s) => ({ chats: s.chats.filter((c) => c._id !== id), ...(s.activeId === id ? { activeId: null, messages: [], questionsLeft: null } : {}) }));
  await deleteChat(id).catch(() => {});
  refreshList();
}

export const attachMaterial = (m) => set({ attached: m ? { id: m.id, title: m.title } : null });

/**
 * Ask a question. Answers are short by default; mode 'detailed' asks for the
 * full explanation. The attached material (if any) is sent with it.
 */
export async function sendDoubt(text, { mode = 'short', material } = {}) {
  const question = text.trim();
  if (!question || state.busy) return;
  const pendingId = `p-${Date.now()}`;
  const conversationId = state.activeId;
  const attached = material === undefined ? state.attached : material;
  set((s) => ({
    busy: true,
    slow: false,
    queuePosition: 0,
    messages: [
      ...s.messages.filter((m) => !m.error),
      { _id: `u-${pendingId}`, role: 'user', content: question, mode: mode === 'detailed' ? 'detailed' : undefined, material: attached ? { id: attached.id, title: attached.title } : undefined },
      { _id: pendingId, role: 'assistant', content: '', pending: true },
    ],
  }));
  const slowTimer = setTimeout(() => set({ slow: true }), 8000);
  try {
    const result = await streamStudyDoubt(
      { message: question, conversationId, mode, materialId: attached?.id },
      {
        onDelta: (delta) => set((s) => ({ queuePosition: 0, messages: s.messages.map((m) => (m._id === pendingId ? { ...m, content: m.content + delta } : m)) })),
        onEvent: (event, data) => {
          if (event === 'queue') set({ queuePosition: data.position || 0 });
          // The server threw away a garbled start and is writing the answer again.
          if (event === 'restart') set((s) => ({ messages: s.messages.map((m) => (m._id === pendingId ? { ...m, content: '' } : m)) }));
        },
      }
    );
    set((s) => ({
      messages: s.messages.map((m) => (m._id === pendingId ? result.message : m)),
      activeId: result.conversationId || s.activeId,
      ...(result.questionsLeft !== undefined && result.conversationId ? { questionsLeft: result.questionsLeft } : {}),
      ...(result.credits ? { credits: result.credits } : {}),
    }));
    if (result.conversationId) refreshList();
  } catch (err) {
    const chatFull = err.code === 'AI_CHAT_FULL';
    set((s) => ({
      messages: [
        ...s.messages.filter((m) => m._id !== pendingId && m._id !== `u-${pendingId}`),
        { _id: `err-${pendingId}`, role: 'assistant', error: err.message, code: err.code, retry: chatFull || err.status === 402 || err.code === 'AI_BLOCKED' ? null : { question, mode, material: attached || null } },
      ],
      ...(err.status === 404 ? { activeId: null } : {}),
      ...(chatFull ? { questionsLeft: 0 } : {}),
    }));
    if (err.status === 404) refreshList();
    if (err.status === 402 || err.code === 'AI_BLOCKED') refreshMe();
  } finally {
    clearTimeout(slowTimer);
    set({ busy: false, slow: false, queuePosition: 0 });
  }
}

/** "Explain in detail" under a short answer: ask the same question again in detailed mode. */
export function explainInDetail(answerId) {
  const i = state.messages.findIndex((m) => m._id === answerId);
  const question = i > 0 ? state.messages[i - 1] : null;
  if (!question || question.role !== 'user') return;
  sendDoubt(question.content, { mode: 'detailed', material: question.material?.id ? { id: String(question.material.id), title: question.material.title } : null });
}
