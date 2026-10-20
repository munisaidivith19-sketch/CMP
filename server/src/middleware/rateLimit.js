import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const json = (message) => ({ message });

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // The signed vehicle-tracker webhook reports for every bus from one address
  // and has its own limiter (trackerLimiter) below.
  skip: (req) => req.path.startsWith('/transport/tracker/'),
  message: json('Too many requests, please slow down'),
});

// Bus location from a trip phone: per signed-in user (not per IP — many phones
// share a campus NAT). One fix every 2 s for an hour fits comfortably.
export const locationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.LOCATION_RATE_LIMIT) || 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?._id ? `user:${req.user._id}` : req.ip),
  message: json('Location updates are arriving too fast'),
});

// Road-route previews call an outside routing server (the public OSRM demo by
// default, fair use only): a few per manager per minute is plenty.
export const routingLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.ROUTING_RATE_LIMIT) || 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `routing:${req.user?._id || req.ip}`,
  message: json('Too many route generations. Wait a minute and try again.'),
});

// Vehicle-tracker webhook: one gateway reporting for the whole fleet.
export const trackerLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.TRACKER_RATE_LIMIT) || 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many tracker requests'),
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
// Super Admin password re-entry: per account, so a stolen session cannot be
// used to brute-force the password through /super-admin/reauth.
export const reauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?._id ? `reauth:${req.user._id}` : req.ip),
  message: json('Too many password confirmations. Try again in a few minutes.'),
});

// Sensitive Super Admin writes (admin accounts, policies, resets, emergency).
export const superAdminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?._id ? `sa:${req.user._id}` : req.ip),
  message: json('Too many administrative changes. Please wait a few minutes.'),
});

// SOC: diagnostic runs, verification and forced health checks, per Super Admin.
export const socRunLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.SOC_RUN_RATE_LIMIT) || 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `soc:${req.user?._id || req.ip}`,
  message: json('Too many diagnostic runs. Wait a few minutes and try again.'),
});

// Client error reports, per signed-in user (the web app also deduplicates and caps them).
export const clientErrorLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `client-err:${req.user?._id || req.ip}`,
  message: json('Too many error reports.'),
});

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

// ── Skill Wallet ─────────────────────────────────────────────────────
// Per signed-in user (a hostel shares one IP), configurable from .env.
const perUser = (prefix, windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${prefix}:${req.user?._id || req.ip}`,
    message: json(message),
  });
export const skillWalletWriteLimiter = perUser('sw-write', 60 * 1000, Number(process.env.SKILL_WALLET_WRITE_LIMIT) || 60, 'You are making changes too fast. Please wait a moment.');
export const skillWalletUploadLimiter = perUser('sw-upload', 10 * 60 * 1000, Number(process.env.SKILL_WALLET_UPLOAD_LIMIT) || 20, 'Upload limit reached. Try again in a few minutes.');
export const skillWalletInviteLimiter = perUser('sw-invite', 10 * 60 * 1000, Number(process.env.SKILL_WALLET_INVITE_LIMIT) || 20, 'Too many invitations. Try again in a few minutes.');
export const skillWalletCommentLimiter = perUser('sw-comment', 5 * 60 * 1000, Number(process.env.SKILL_WALLET_COMMENT_LIMIT) || 20, 'You are commenting too fast. Please wait a moment.');
export const skillWalletContactLimiter = perUser('sw-contact', 60 * 60 * 1000, Number(process.env.SKILL_WALLET_CONTACT_LIMIT) || 10, 'Too many contact requests. Try again later.');
// Public gallery and signed file downloads (no session: per IP).
export const skillWalletPublicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.SKILL_WALLET_PUBLIC_LIMIT) || 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many requests, please slow down'),
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
