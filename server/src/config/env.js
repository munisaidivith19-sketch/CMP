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

/**
 * Parent OTP for gate passes. "test" keeps OTPs in server memory for the
 * development OTP portal; "college_sms" is the future college SMS vendor.
 */
env.otp = {
  provider: (process.env.OTP_PROVIDER || 'test').trim().toLowerCase(),
  expiryMinutes: num('OTP_EXPIRY_MINUTES', 10, { max: 60 }),
  length: num('OTP_LENGTH', 4, { min: 4, max: 8 }),
  maxAttempts: num('OTP_MAX_ATTEMPTS', 5, { max: 10 }),
  resendCooldownSeconds: num('OTP_RESEND_COOLDOWN_SECONDS', 60, { min: 0, max: 600 }),
  // The admin-only development OTP portal is always on outside production. In
  // production it stays off unless DEV_OTP_PORTAL=true — a deliberate, temporary
  // opt-in for deployments that have no SMS provider yet.
  devPortalInProduction: process.env.DEV_OTP_PORTAL === 'true',
};
if (isProd && env.otp.provider === 'test') {
  console.warn(
    env.otp.devPortalInProduction
      ? '[env] OTP_PROVIDER=test + DEV_OTP_PORTAL=true in production: parent OTPs are shown to admins at /dev/otp instead of being sent by SMS. Turn this off once the college SMS provider is connected.'
      : '[env] OTP_PROVIDER=test in production: parent OTPs are not delivered and the development OTP portal is disabled (set DEV_OTP_PORTAL=true to enable it for admins)'
  );
}
env.sms = {
  apiKey: (process.env.SMS_API_KEY || '').trim(),
  senderId: (process.env.SMS_SENDER_ID || '').trim(),
  otpTemplateId: (process.env.SMS_OTP_TEMPLATE_ID || '').trim(),
};

const decimal = (name, fallback, min, max) => {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** Heading printed on generated reports (PDF). */
env.collegeName = (process.env.COLLEGE_NAME || 'VEXON').trim().slice(0, 90);

/** Gate pass return-to-campus check. The backend alone decides; these never come from the client. */
env.location = {
  collegeLatitude: decimal('COLLEGE_LATITUDE', 13.263803, -90, 90),
  collegeLongitude: decimal('COLLEGE_LONGITUDE', 80.108414, -180, 180),
  radiusMeters: num('LOCATION_GEOFENCE_RADIUS_METERS', 300, { max: 5000 }),
  maxAccuracyMeters: num('LOCATION_MAX_ACCURACY_METERS', 50, { max: 1000 }),
  maxAgeSeconds: num('LOCATION_MAX_AGE_SECONDS', 30, { max: 600 }),
  returnCredentialMinutes: num('RETURN_CREDENTIAL_MINUTES', 15, { max: 120 }),
};

env.cloudinary.enabled = Boolean(
  env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret
);
