import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const json = (message) => ({ message });

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many requests, please slow down'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: json('Too many failed sign-in attempts from this network. Try again later.'),
});

// Session-refresh (token rotation) endpoint. The refresh token's signature and
// one-time rotation already make guessing infeasible, so this is an edge cap
// against a flood of garbage/expired tokens (DoS + enumeration). Successful
// rotations are skipped, so a legitimate multi-device user — or a whole hostel
// behind one NAT IP — is never penalised; only *failed* refreshes count.
// Configurable via REFRESH_RATE_LIMIT for different deployment sizes.
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.REFRESH_RATE_LIMIT) || 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: json('Too many session-refresh attempts. Please sign in again.'),
});

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('You are posting too fast. Please wait a moment.'),
});

export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Upload limit reached. Try again later.'),
});

// Password-reset requests: generous enough for typos, tight enough to stop mail bombing.
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many password reset requests. Try again in a few minutes.'),
});

// Gate-pass code checks: stops guessing codes at the gate console.
export const verifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many verification attempts. Please wait a moment.'),
});

// Parent OTP send/verify, per signed-in user. The per-OTP attempt limit and
// resend cooldown are enforced separately by the OTP service.
export const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `otp:${req.user?._id || req.ip}`,
  message: json('Too many OTP requests. Please wait a few minutes.'),
});

// Return-to-campus location checks, per student. Each check is one explicit tap.
export const returnLocationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `return:${req.user?._id || req.ip}`,
  message: json('Too many location checks. Please wait a few minutes and try again.'),
});

// Submitting a new password with a reset token.
export const passwordResetSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many attempts. Request a new reset link and try again later.'),
});

// ── JNN Study Assistant ──────────────────────────────────────────────
// Per authenticated user (not per IP — a whole hostel can share one IP), and
// configurable from the backend .env (AI_RATE_LIMIT_PER_MINUTE / _PER_HOUR).
const aiLimiter = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `ai:${req.user?._id || req.ip}`,
    message: json(message),
  });

export const aiMinuteLimiter = aiLimiter(60 * 1000, env.ai.rateLimitPerMinute, 'You are asking questions too quickly. Please wait a moment and try again.');
export const aiHourLimiter = aiLimiter(60 * 60 * 1000, env.ai.rateLimitPerHour, 'You have reached the hourly limit for the Study Assistant. Please try again later.');
