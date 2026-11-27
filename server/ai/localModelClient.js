import { localAi } from './config.js';

const SAFE = {
  config: 'The study doubts assistant is not set up yet. Please try again later.',
  unavailable: 'The study doubts assistant is temporarily unavailable. Please try again later.',
  upstream: 'The study doubts assistant is temporarily unavailable. Please try again later.',
  malformed: 'The study doubts assistant is temporarily unavailable. Please try again later.',
  overloaded: 'The assistant is answering other students right now. Please try again in a minute.',
  timeout: 'The assistant took too long to respond. Please try again.',
  aborted: 'The request was cancelled.',
  stopped: 'AI Doubts has been switched off by IT support. Please try again later.',
};
const STATUS = { config: 503, unavailable: 503, overloaded: 503, upstream: 502, malformed: 502, timeout: 504, aborted: 499, stopped: 503 };

/** Errors whose message is safe to show a student; details stay in the log. */
export class LocalAIError extends Error {
  constructor(category) {
    super(SAFE[category] || SAFE.unavailable);
    this.name = 'LocalAIError';
    this.category = category;
    this.status = STATUS[category] || 503;
    this.expose = true;
  }
}

/**
 * Client for the self-hosted model (see README.md in this folder).
 *
 * Talks to an Ollama server bound to 127.0.0.1 on the same machine — the
 * model is never reachable from the internet, has no tools, no web access and
 * no database access.
 */

// A CPU-only box can only run a few generations well at a time; the rest
// wait in a FAIR queue: students take turns (round-robin), so one student's
// questions can never push everybody else back. Each waiting request is told
// its place in line. Several Ollama instances (LOCAL_AI_URLS, e.g. one per CPU
// socket) are used together: each answer goes to the least busy one.
const instances = localAi.urls.map((url, index) => ({ index, url, active: 0 }));
const lanes = new Map(); // key → [job waiting]
let turnOrder = []; // keys, in the order they get their next turn
const inFlight = new Set(); // { controller, stopped }

const queuedCount = () => turnOrder.reduce((n, k) => n + (lanes.get(k)?.length || 0), 0);
const freeInstance = () => instances.filter((i) => i.active < localAi.maxConcurrent).sort((a, b) => a.active - b.active)[0];

/** Order in which waiting jobs will be served (round-robin across students). */
function serveOrder() {
  const copies = turnOrder.map((k) => [...(lanes.get(k) || [])]);
  const out = [];
  for (let round = 0; copies.some((q) => q.length); round += 1) for (const q of copies) if (q.length) out.push(q.shift());
  return out;
}

function announcePositions() {
  serveOrder().forEach((job, i) => {
    if (job.position !== i + 1) {
      job.position = i + 1;
      try {
        job.onQueue?.(i + 1);
      } catch {
        /* listener errors never break the queue */
      }
    }
  });
}

function removeWaiting(job) {
  const lane = lanes.get(job.key);
  if (!lane) return false;
  const i = lane.indexOf(job);
  if (i < 0) return false;
  lane.splice(i, 1);
  if (!lane.length) {
    lanes.delete(job.key);
    turnOrder = turnOrder.filter((k) => k !== job.key);
  }
  return true;
}

function dispatch() {
  let inst;
  while (turnOrder.length && (inst = freeInstance())) {
    const key = turnOrder.shift();
    const lane = lanes.get(key);
    const job = lane.shift();
    if (lane.length) turnOrder.push(key); // this student's next question waits for everyone else's turn
    else lanes.delete(key);
    inst.active += 1;
    job.resolve(inst);
  }
  announcePositions();
}

async function acquire({ key = 'anon', onQueue, signal } = {}) {
  const inst = !queuedCount() && freeInstance();
  if (inst) {
    inst.active += 1;
    return inst;
  }
  if (queuedCount() >= localAi.maxQueue) throw new LocalAIError('overloaded');
  return new Promise((resolve, reject) => {
    const job = { key, onQueue, position: 0, resolve, reject };
    if (!lanes.has(key)) {
      lanes.set(key, []);
      turnOrder.push(key);
    }
    lanes.get(key).push(job);
    signal?.addEventListener(
      'abort',
      () => {
        if (removeWaiting(job)) {
          reject(new LocalAIError('aborted'));
          announcePositions();
        }
      },
      { once: true }
    );
    announcePositions();
  });
}

function release(inst) {
  inst.active -= 1;
  dispatch();
}

/** Emergency stop: cancel every answer being generated and empty the queue. */
export function abortAll() {
  const jobs = serveOrder();
  lanes.clear();
  turnOrder = [];
  jobs.forEach((j) => j.reject(new LocalAIError('stopped')));
  const aborted = inFlight.size;
  inFlight.forEach((job) => {
    job.stopped = true;
    job.controller.abort();
  });
  return { aborted, queued: jobs.length };
}

/** Load right now (for IT support and for choosing the busy-time model). */
export const activity = () => ({
  active: instances.reduce((n, i) => n + i.active, 0),
  queued: queuedCount(),
  waitingStudents: turnOrder.length,
  capacity: instances.length * localAi.maxConcurrent,
  instances: instances.map((i) => ({ instance: i.index + 1, active: i.active })),
});

let fetchImpl = (...args) => fetch(...args);
/** Test hook: swap fetch for a fake. Pass null to restore the real one. */
export function setLocalFetch(fn) {
  fetchImpl = fn || ((...args) => fetch(...args));
}

export function isLoopbackUrl(url) {
  try {
    const { hostname } = new URL(url);
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * @param {object} o
 * @param {Array}  o.messages   OpenAI-style messages (system first)
 * @param {Function} [o.onDelta]
 * @param {AbortSignal} [o.signal]
 * @param {string} [o.queueKey]   who is asking (fair queue: one lane per student)
 * @param {Function} [o.onQueue]  called with the place in line while waiting
 * @param {string} [o.model]      defaults to LOCAL_AI_MODEL
 * @param {number} [o.maxTokens]  answer length cap
 */
export async function chat({ messages, onDelta, signal, queueKey, onQueue, model = localAi.model, maxTokens = localAi.maxOutputTokens }) {
  if (!localAi.urls.length || !localAi.urls.every(isLoopbackUrl)) {
    console.error('[ai] LOCAL_AI_URL(S) must point to 127.0.0.1 / localhost — refusing to send student questions elsewhere.');
    throw new LocalAIError('config');
  }
  const inst = await acquire({ key: queueKey, onQueue, signal });
  const controller = new AbortController();
  const job = { controller, stopped: false };
  inFlight.add(job);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, localAi.requestTimeoutMs);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  let streamed = false;
  try {
    const res = await fetchImpl(`${inst.url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: messages.map(({ role, content }) => ({ role, content })),
        stream: Boolean(onDelta),
        keep_alive: localAi.keepAlive,
        options: {
          temperature: 0.2,
          top_p: 0.9,
          repeat_penalty: 1.1,
          num_predict: maxTokens,
          num_ctx: localAi.contextTokens,
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[ai] local model request failed (${res.status})`);
      throw new LocalAIError(res.status === 404 ? 'config' : 'upstream');
    }

    let content = '';
    let final = {};
    if (onDelta) {
      // Ollama streams newline-delimited JSON objects.
      const decoder = new TextDecoder();
      let buffer = '';
      const handle = (line) => {
        if (!line.trim()) return;
        const obj = JSON.parse(line);
        if (obj.error) throw new LocalAIError('upstream');
        const piece = obj.message?.content || '';
        if (piece) {
          content += piece;
          streamed = true;
          onDelta(piece);
        }
        if (obj.done) final = obj;
      };
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          handle(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      handle(buffer);
    } else {
      final = await res.json();
      content = final.message?.content || '';
    }

    content = content.trim();
    if (!content) throw new LocalAIError('malformed');
    const promptTokens = final.prompt_eval_count ?? null;
    const completionTokens = final.eval_count ?? null;
    return {
      content,
      webSources: [],
      usage: { promptTokens, completionTokens, totalTokens: promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null },
      model,
      // true when the answer stopped because it reached the token limit (not finished).
      truncated: final.done_reason === 'length',
      webSearchUsed: false,
      webSearchFailed: false,
    };
  } catch (err) {
    let mapped = err;
    if (job.stopped) mapped = new LocalAIError('stopped');
    else if (!(err instanceof LocalAIError)) {
      if (timedOut) mapped = new LocalAIError('timeout');
      else if (err?.name === 'AbortError') mapped = new LocalAIError('aborted');
      else if (err instanceof SyntaxError) mapped = new LocalAIError('malformed');
      else {
        // ECONNREFUSED etc. — Ollama not running. Log the category only.
        console.warn('[ai] local model unreachable — is Ollama running? (see server/ai/README.md)');
        mapped = new LocalAIError('unavailable');
      }
    }
    mapped.streamed = streamed;
    throw mapped;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
    inFlight.delete(job);
    release(inst);
  }
}
