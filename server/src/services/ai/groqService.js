import Groq, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from 'groq-sdk';
import { env } from '../../config/env.js';

/**
 * The single place the backend talks to Groq. The API key is read from
 * env.ai (i.e. process.env.GROQ_API_KEY at start-up) — never hardcoded,
 * never returned to a client, never logged. Rotating the key = edit .env and
 * restart the server.
 *
 * Every failure is turned into an AIServiceError whose `message` is safe to
 * show a student; the real upstream error is only ever reduced to a category
 * + status code in the server log.
 */

export const AI_UNAVAILABLE = 'The AI service is temporarily unavailable. Please try again later.';

const SAFE_MESSAGES = {
  config: AI_UNAVAILABLE,
  auth: AI_UNAVAILABLE,
  unavailable: AI_UNAVAILABLE,
  upstream: AI_UNAVAILABLE,
  bad_request: AI_UNAVAILABLE,
  malformed: AI_UNAVAILABLE,
  rate_limit: 'The AI service is busy right now. Please try again in a minute.',
  overloaded: 'The AI assistant is handling a lot of requests right now. Please try again shortly.',
  timeout: 'The AI took too long to respond. Please try again.',
  aborted: 'The request was cancelled.',
};

const STATUS = {
  config: 503,
  auth: 503,
  unavailable: 503,
  overloaded: 503,
  upstream: 502,
  bad_request: 502,
  malformed: 502,
  rate_limit: 429,
  timeout: 504,
  aborted: 499,
};

export class AIServiceError extends Error {
  constructor(category, { cause } = {}) {
    super(SAFE_MESSAGES[category] || AI_UNAVAILABLE);
    this.name = 'AIServiceError';
    this.category = category;
    this.status = STATUS[category] || 503;
    // Kept off the enumerable props so it never ends up in a JSON response.
    Object.defineProperty(this, 'upstreamStatus', { value: cause?.status, enumerable: false });
  }
}

// ── Client ───────────────────────────────────────────────────────────

let clientFactory = (apiKey) => new Groq({ apiKey, maxRetries: env.ai.maxRetries, timeout: env.ai.requestTimeoutMs });
let cached = { key: null, client: null };
let warnedMissingKey = false;

/** Test hook: swap the SDK for a fake. Pass null to restore the real one. */
export function setGroqClientFactory(factory) {
  clientFactory = factory || ((apiKey) => new Groq({ apiKey, maxRetries: env.ai.maxRetries, timeout: env.ai.requestTimeoutMs }));
  cached = { key: null, client: null };
}

export const isConfigured = () => Boolean(env.ai.groqApiKey);

function getClient() {
  const key = env.ai.groqApiKey;
  if (!key) {
    if (!warnedMissingKey) {
      console.error('[ai] GROQ_API_KEY is not set in the backend environment — the Study Assistant is disabled.');
      warnedMissingKey = true;
    }
    throw new AIServiceError('config');
  }
  if (cached.key !== key) cached = { key, client: clientFactory(key) };
  return cached.client;
}

// ── Controlled concurrency ───────────────────────────────────────────
// A small semaphore so a burst of students can't open unlimited upstream
// connections; excess requests queue briefly, and beyond the queue we shed load.

let active = 0;
const waiting = [];

async function acquire() {
  if (active < env.ai.maxConcurrent) {
    active += 1;
    return;
  }
  if (waiting.length >= env.ai.maxQueue) throw new AIServiceError('overloaded');
  await new Promise((resolve) => waiting.push(resolve));
  active += 1;
}

function release() {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
}

// ── Error mapping ────────────────────────────────────────────────────

function categorize(err, { timedOut }) {
  if (err instanceof AIServiceError) return err;
  let category = 'unavailable';
  if (timedOut || err instanceof APIConnectionTimeoutError) category = 'timeout';
  else if (err instanceof APIUserAbortError || err?.name === 'AbortError') category = 'aborted';
  else if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) category = 'auth';
  else if (err instanceof RateLimitError) category = 'rate_limit';
  else if (err instanceof BadRequestError) category = 'bad_request';
  else if (err instanceof InternalServerError) category = 'upstream';
  else if (err instanceof APIConnectionError) category = 'unavailable';

  // Log the category and HTTP status only — never the message body, headers or key.
  if (category === 'auth') console.error(`[ai] Groq rejected the API key (${err.status}). Check GROQ_API_KEY in the backend .env.`);
  else if (category !== 'aborted') console.warn(`[ai] Groq request failed: ${category}${err?.status ? ` (${err.status})` : ''}`);
  return new AIServiceError(category, { cause: err });
}

// ── Sources ──────────────────────────────────────────────────────────

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/**
 * Normalize the web results Groq's browser_search actually returned into our
 * source shape. Only real http(s) URLs from the tool output are kept — nothing
 * the model merely wrote in its answer is ever turned into a citation.
 */
export function extractWebSources(executedTools = [], limit = 8) {
  const seen = new Map();
  const add = (r) => {
    const url = typeof r?.url === 'string' ? r.url.trim() : '';
    if (!/^https?:\/\//i.test(url) || url.length > 2000 || seen.has(url)) return;
    const publisher = hostOf(url);
    if (!publisher) return;
    seen.set(url, {
      type: 'web',
      title: String(r.title || publisher).trim().slice(0, 200),
      url,
      publisher,
      retrievedAt: new Date(),
    });
  };
  for (const tool of Array.isArray(executedTools) ? executedTools : []) {
    (tool?.search_results?.results || []).forEach(add);
    (tool?.browser_results || []).forEach(add);
  }
  return [...seen.values()].slice(0, limit);
}

// ── Chat ─────────────────────────────────────────────────────────────

/**
 * Run one chat completion.
 * @param {object}   o
 * @param {Array}    o.messages   OpenAI-style messages (system first)
 * @param {boolean}  o.webSearch  allow Groq's built-in browser_search tool
 * @param {Function} [o.onDelta]  if given, the answer is streamed through it
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<{content, webSources, usage, model, webSearchUsed, webSearchFailed}>}
 */
export async function chat({ messages, webSearch = false, onDelta, signal }) {
  const client = getClient();
  await acquire();
  try {
    try {
      return await runOnce(client, { messages, webSearch, onDelta, signal });
    } catch (err) {
      // If the web-search tool itself failed (not auth / rate limit / timeout)
      // and nothing was streamed yet, answer from the other sources instead.
      if (webSearch && ['bad_request', 'upstream'].includes(err.category) && !err.streamed) {
        console.warn('[ai] browser_search failed — retrying without web search');
        const result = await runOnce(client, { messages, webSearch: false, onDelta, signal });
        return { ...result, webSearchFailed: true };
      }
      throw err;
    }
  } finally {
    release();
  }
}

async function runOnce(client, { messages, webSearch, onDelta, signal }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, env.ai.requestTimeoutMs);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  const params = {
    model: env.ai.model,
    messages,
    max_completion_tokens: env.ai.maxOutputTokens,
    temperature: 0.4,
    reasoning_effort: 'low',
    ...(webSearch ? { tools: [{ type: 'browser_search' }], tool_choice: 'auto' } : {}),
  };
  const options = { signal: controller.signal, timeout: env.ai.requestTimeoutMs, maxRetries: env.ai.maxRetries };

  let streamed = false;
  try {
    let content = '';
    let executed = [];
    let usage = null;

    if (onDelta) {
      const stream = await client.chat.completions.create({ ...params, stream: true }, options);
      for await (const chunk of stream) {
        const choice = chunk?.choices?.[0];
        const delta = choice?.delta || {};
        if (Array.isArray(delta.executed_tools)) executed = executed.concat(delta.executed_tools);
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          streamed = true;
          onDelta(delta.content);
        }
        usage = chunk?.x_groq?.usage || chunk?.usage || usage;
      }
    } else {
      const completion = await client.chat.completions.create(params, options);
      const message = completion?.choices?.[0]?.message;
      content = typeof message?.content === 'string' ? message.content : '';
      executed = Array.isArray(message?.executed_tools) ? message.executed_tools : [];
      usage = completion?.usage || null;
    }

    content = content.trim();
    if (!content) throw new AIServiceError('malformed');

    const webSources = extractWebSources(executed);
    return {
      content,
      webSources,
      usage: usage
        ? { promptTokens: usage.prompt_tokens ?? null, completionTokens: usage.completion_tokens ?? null, totalTokens: usage.total_tokens ?? null }
        : null,
      model: env.ai.model,
      webSearchUsed: executed.length > 0,
      webSearchFailed: false,
    };
  } catch (err) {
    const mapped = categorize(err, { timedOut });
    mapped.streamed = streamed;
    throw mapped;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}
