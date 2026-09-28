import { store } from '../app/store';
import { loggedOut, setCredentials } from '../features/authSlice';
import { refreshSession } from './api';

/**
 * Streamed chat with the JNN Study Assistant (Server-Sent Events over a
 * POST fetch — RTK Query can't consume a stream). Only our own backend is
 * called; the AI provider and its key live entirely on the server.
 *
 * Resolves with the final, persisted { conversationId, title, message }.
 * Rejects with an Error carrying `.status` and a user-safe `.message`.
 */
export async function streamAssistantChat(body, { onDelta, signal } = {}) {
  const send = () =>
    fetch('/api/ai/study-assistant/chat', {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(store.getState().auth.accessToken ? { authorization: `Bearer ${store.getState().auth.accessToken}` } : {}),
      },
      body: JSON.stringify({ ...body, stream: true }),
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

  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('text/event-stream')) {
    const data = await res.json().catch(() => null);
    throw Object.assign(new Error(data?.message || 'The Study Assistant is unavailable right now. Please try again.'), { status: res.status });
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
      else if (event === 'done') final = data;
      else if (event === 'error') throw Object.assign(new Error(data.message || 'Something went wrong.'), { status: data.status });
    }
  }

  // Connection dropped before the server confirmed the saved answer.
  if (!final) throw Object.assign(new Error('The connection was interrupted. Please try again.'), { status: 0, interrupted: true });
  return final;
}
