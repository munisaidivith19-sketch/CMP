import '../src/config/env.js'; // loads server/.env into process.env (read-only use)

/**
 * Settings for the self-hosted AI Doubts model. Kept here (not in
 * src/config/env.js) so the existing Groq Study Assistant is untouched.
 * Every value is optional and can be set in server/.env.
 */
const num = (name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const bool = (name, fallback) => (process.env[name] === undefined || process.env[name] === '' ? fallback : process.env[name] === 'true');
const urls = (process.env.LOCAL_AI_URLS || process.env.LOCAL_AI_URL || 'http://127.0.0.1:11434')
  .split(',')
  .map((u) => u.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const localAi = {
  enabled: process.env.LOCAL_AI_ENABLED === 'true',
  // Must stay on localhost — the model is never exposed to the network.
  // LOCAL_AI_URLS=a,b runs answers across several Ollama instances (e.g. one per CPU socket).
  url: urls[0],
  urls,
  model: (process.env.LOCAL_AI_MODEL || '').trim() || 'jnn-study',
  // Faster, smaller model used automatically when the queue is long (empty = never).
  fallbackModel: (process.env.LOCAL_AI_FALLBACK_MODEL || '').trim(),
  fallbackQueueThreshold: num('LOCAL_AI_FALLBACK_QUEUE', 6, { max: 1000 }),
  maxMessageLength: num('LOCAL_AI_MAX_MESSAGE_LENGTH', 1500, { max: 8000 }),
  // Answer lengths: short first; "Explain in detail" asks for the long version.
  shortOutputTokens: num('LOCAL_AI_SHORT_OUTPUT_TOKENS', 260, { min: 64, max: 2000 }),
  maxOutputTokens: num('LOCAL_AI_MAX_OUTPUT_TOKENS', 700, { max: 4000 }),
  // Exam answers ("13 marks") need room: about 900 words in English.
  examOutputTokens: num('LOCAL_AI_EXAM_OUTPUT_TOKENS', 1400, { min: 256, max: 4000 }),
  busyOutputTokens: num('LOCAL_AI_BUSY_OUTPUT_TOKENS', 400, { min: 64, max: 4000 }),
  contextTokens: num('LOCAL_AI_CONTEXT_TOKENS', 8192, { min: 1024, max: 32768 }),
  requestTimeoutMs: num('LOCAL_AI_TIMEOUT_MS', 300000, { min: 5000, max: 600000 }),
  // Answers generated at the same time PER Ollama instance.
  maxConcurrent: num('LOCAL_AI_MAX_CONCURRENT', 1, { max: 8 }),
  maxQueue: num('LOCAL_AI_MAX_QUEUE', 30, { min: 0, max: 1000 }),
  keepAlive: (process.env.LOCAL_AI_KEEP_ALIVE || '30m').trim(),
  ragChunks: num('LOCAL_AI_RAG_CHUNKS', 4, { max: 10 }),

  // Saved chats
  maxConversations: num('LOCAL_AI_MAX_CONVERSATIONS', 3, { max: 20 }),
  retentionHours: num('LOCAL_AI_RETENTION_HOURS', 48, { max: 24 * 30 }),
  maxQuestionsPerConversation: num('LOCAL_AI_MAX_QUESTIONS_PER_CHAT', 50, { min: 1, max: 500 }),
  // The model only "remembers" this chat's messages from the last N minutes.
  memoryMinutes: num('LOCAL_AI_MEMORY_MINUTES', 30, { min: 0, max: 24 * 60 }),
  historyMessages: num('LOCAL_AI_HISTORY_MESSAGES', 6, { min: 0, max: 20 }),

  // Abuse limits
  ratePerMinute: num('LOCAL_AI_RATE_PER_MINUTE', 5),
  ratePerHour: num('LOCAL_AI_RATE_PER_HOUR', 40),
  strikesToBlock: num('LOCAL_AI_STRIKES_TO_BLOCK', 3, { max: 100 }),
  strikeWindowHours: num('LOCAL_AI_STRIKE_WINDOW_HOURS', 24, { max: 24 * 30 }),
  blockHours: num('LOCAL_AI_BLOCK_HOURS', 24, { max: 24 * 365 }),
  // Model output that looks like database access / secrets → automatic emergency stop.
  tripwireEnabled: bool('LOCAL_AI_TRIPWIRE', true),

  // Caches (shared across students; access is re-checked on every hit)
  answerCacheHours: num('LOCAL_AI_ANSWER_CACHE_HOURS', 24 * 7, { min: 0, max: 24 * 90 }),

  // Credits
  credits: {
    enabled: process.env.LOCAL_AI_CREDITS_ENABLED === 'true',
    monthly: num('LOCAL_AI_CREDITS_MONTHLY', 1000, { min: 0, max: 1_000_000 }),
    daily: num('LOCAL_AI_CREDITS_DAILY', 150, { min: 0, max: 1_000_000 }),
    costShort: num('LOCAL_AI_CREDIT_COST_SHORT', 5, { min: 0, max: 10_000 }),
    costNormal: num('LOCAL_AI_CREDIT_COST_NORMAL', 10, { min: 0, max: 10_000 }),
    costLong: num('LOCAL_AI_CREDIT_COST_LONG', 15, { min: 0, max: 10_000 }),
    costCached: num('LOCAL_AI_CREDIT_COST_CACHED', 2, { min: 0, max: 10_000 }),
    lowWarning: num('LOCAL_AI_CREDITS_LOW_WARNING', 100, { min: 0, max: 1_000_000 }),
    // Roles that spend credits (comma list). Everyone else (staff) is unlimited.
    chargedRoles: (process.env.LOCAL_AI_CREDITS_ROLES || 'student,club_admin')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
  },
};

// Back-compat: older .env files used LOCAL_AI_MAX_MESSAGES_PER_CONVERSATION (messages, not questions).
if (process.env.LOCAL_AI_MAX_MESSAGES_PER_CONVERSATION && !process.env.LOCAL_AI_MAX_QUESTIONS_PER_CHAT) {
  localAi.maxQuestionsPerConversation = Math.max(1, Math.floor(num('LOCAL_AI_MAX_MESSAGES_PER_CONVERSATION', 100) / 2));
}
