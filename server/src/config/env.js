import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const isProd = process.env.NODE_ENV === 'production';

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
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campusconnect',
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

env.cloudinary.enabled = Boolean(
  env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret
);
