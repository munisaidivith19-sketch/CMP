import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const isProd = process.env.NODE_ENV === 'production';

/**
 * Two MongoDB targets can be configured side by side. DB_TARGET chooses which
 * one the server connects to; "local" is the default so the local database is
 * used unless you explicitly switch to "atlas". Both connection strings live in
 * .env at once, so switching back and forth needs no code change.
 */
function resolveMongoUri() {
  const target = (process.env.DB_TARGET || 'local').trim().toLowerCase();
  const local = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campusconnect';
  const atlas = (process.env.MONGO_URI_ATLAS || '').trim();
  if (target === 'atlas') {
    if (!atlas) throw new Error('DB_TARGET=atlas but MONGO_URI_ATLAS is not set in .env');
    return { uri: atlas, target };
  }
  return { uri: local, target };
}

const mongo = resolveMongoUri();

/**
 * Secrets must be set in production. In development we fall back to a
 * clearly-labelled default so the project runs out of the box.
 */
function secret(name, devDefault) {
  const value = process.env[name];
  if (value && !value.startsWith('replace_with')) return value;
  if (isProd) throw new Error(`Missing required environment variable: ${name}`);
  console.warn(`[env] ${name} not set — using an insecure development default`);
  return devDefault;
}

export const env = {
  isProd,
  port: Number(process.env.PORT) || 5000,
  timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  mongoUri: mongo.uri,
  dbTarget: mongo.target,
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  accessSecret: secret('JWT_ACCESS_SECRET', 'dev_access_secret_do_not_use_in_production'),
  refreshSecret: secret('JWT_REFRESH_SECRET', 'dev_refresh_secret_do_not_use_in_production'),
  // Encrypts chat message bodies at rest. Changing it makes older messages unreadable.
  chatKey: secret('CHAT_ENCRYPTION_KEY', 'dev_chat_key_do_not_use_in_production'),
  accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
  refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 5,
  // Public URL of the web app — used to build password-reset links.
  appUrl: (process.env.APP_URL || process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim(),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'CampusConnect <no-reply@campus.local>',
  },
  // Optional: Expo push access token (only needed if "enhanced push security" is on).
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN || '',
  passwordResetMinutes: Number(process.env.PASSWORD_RESET_MINUTES) || 15,
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
};

const num = (name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/**
 * JNN Study Assistant (Groq). The key is read ONLY here, from the backend
 * environment — replacing it in .env and restarting the server is all it
 * takes to rotate it; no code references a literal key anywhere.
 */
env.ai = {
  groqApiKey: (process.env.GROQ_API_KEY || '').trim(),
  // openai/gpt-oss-20b is a current Groq production model with built-in browser_search.
  model: (process.env.GROQ_MODEL || '').trim() || 'openai/gpt-oss-20b',
  webSearchEnabled: process.env.AI_WEB_SEARCH_ENABLED !== 'false',
  maxMessageLength: num('AI_MAX_MESSAGE_LENGTH', 4000, { max: 20000 }),
  maxOutputTokens: num('AI_MAX_OUTPUT_TOKENS', 1500, { max: 16000 }),
  requestTimeoutMs: num('AI_REQUEST_TIMEOUT_MS', 30000, { min: 1000, max: 300000 }),
  maxRetries: num('AI_MAX_RETRIES', 2, { min: 0, max: 5 }),
  rateLimitPerMinute: num('AI_RATE_LIMIT_PER_MINUTE', 10),
  rateLimitPerHour: num('AI_RATE_LIMIT_PER_HOUR', 60),
  // Stored messages per conversation (oldest are trimmed beyond this).
  maxConversationMessages: num('AI_MAX_CONVERSATION_MESSAGES', 30, { min: 2, max: 500 }),
  // Recent messages actually sent to the model as context.
  historyMessages: num('AI_HISTORY_MESSAGES', 10, { min: 0, max: 50 }),
  maxConcurrent: num('AI_MAX_CONCURRENT', 20, { max: 1000 }),
  maxQueue: num('AI_MAX_QUEUE', 100, { min: 0, max: 10000 }),
  ragChunks: num('AI_RAG_CHUNKS', 6, { max: 20 }),
};

env.cloudinary.enabled = Boolean(
  env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret
);
