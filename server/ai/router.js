import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import mongoose from 'mongoose';
import { protect, authorize } from '../src/middleware/auth.js';
import { body } from 'express-validator';
import { STUDY_MATERIAL_VIEW_ROLES, SUPER_ADMIN_ROLE } from '../src/constants.js';
import { requireRecentReauth } from '../src/middleware/platform.js';
import { superAdminWriteLimiter } from '../src/middleware/rateLimit.js';
import { validate } from '../src/middleware/validate.js';
import { logAudit } from '../src/utils/auditLog.js';
import User from '../src/models/User.js';
import { localAi } from './config.js';
import * as assistant from './localStudyAssistant.js';
import * as credits from './credits.js';
import { listAttachable } from './materials.js';
import { listBlocked, unblock } from './strikes.js';
import { LocalAIUserState } from './models.js';
import { activity } from './localModelClient.js';
import { emergencyStop, stopState } from './killSwitch.js';

/**
 * Self-hosted Study Doubts assistant (AI Doubts tab) — separate from the Groq
 * Study Assistant (/ai/study-assistant/*), which is unchanged.
 *
 *   POST   /ai/study-doubts/chat     { message, conversationId?, mode?, materialId?, stream? }
 *   GET    /ai/study-doubts/me       credits balance + limits
 *   GET    /ai/study-doubts/materials?q=   materials the student may attach
 *   GET    /ai/study-doubts/conversations
 *   GET    /ai/study-doubts/conversations/:id
 *   PATCH  /ai/study-doubts/conversations/:id  { title }
 *   DELETE /ai/study-doubts/conversations/:id
 *
 * IT support only (Console → Troubleshooting → AI Doubts):
 *   GET    /console/ai-doubts/status
 *   POST   /console/ai-doubts/emergency-stop       { reason }               (password re-entry)
 *   GET    /console/ai-doubts/blocked
 *   POST   /console/ai-doubts/unblock              { userId }               (password re-entry)
 *   GET    /console/ai-doubts/credits?account=     email or roll number
 *   POST   /console/ai-doubts/credits/grant        { account, amount, reason } (password re-entry)
 * There is deliberately NO "resume" endpoint — see killSwitch.js.
 *
 * Who the student is (and so which materials can be searched or attached,
 * and which chats can be opened) always comes from the login token.
 */

const limiter = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `local-ai:${req.user?._id || ipKeyGenerator(req.ip)}`,
    message: { success: false, message },
  });

const ALLOWED_KEYS = new Set(['message', 'conversationId', 'stream', 'mode', 'materialId']);
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const optionalId = (v) => v === undefined || v === null || (typeof v === 'string' && OBJECT_ID.test(v));

function badBody(b) {
  if (typeof b.message !== 'string') return true;
  if (Object.keys(b).some((k) => !ALLOWED_KEYS.has(k))) return true;
  if (b.stream !== undefined && typeof b.stream !== 'boolean') return true;
  if (b.mode !== undefined && b.mode !== 'short' && b.mode !== 'detailed') return true;
  return !optionalId(b.conversationId) || !optionalId(b.materialId);
}

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => sendError(res, err));

const limits = () => ({
  maxConversations: localAi.maxConversations,
  retentionHours: localAi.retentionHours,
  maxQuestionsPerConversation: localAi.maxQuestionsPerConversation,
  memoryMinutes: localAi.memoryMinutes,
  maxMessageLength: localAi.maxMessageLength,
});

async function findAccount(account) {
  const a = String(account || '').trim();
  if (!a || a.length > 120) return null;
  const or = [{ email: a.toLowerCase() }, { rollNo: a.toUpperCase() }];
  if (mongoose.isValidObjectId(a)) or.push({ _id: a });
  return User.findOne({ $or: or }).select('name email role rollNo department semester').lean();
}

export function createStudyDoubtsRouter() {
  const router = Router();
  const gate = (req, res, next) => {
    if (stopState()) return res.status(503).json({ success: false, code: 'AI_STOPPED', message: 'AI Doubts has been switched off by IT support. Please try again later.' });
    if (!localAi.enabled) return res.status(503).json({ success: false, code: 'AI_DISABLED', message: 'The AI doubts assistant is not enabled.' });
    return next();
  };
  const base = [gate, protect, authorize(...STUDY_MATERIAL_VIEW_ROLES)];

  router.post(
    '/ai/study-doubts/chat',
    ...base,
    limiter(60 * 1000, localAi.ratePerMinute, 'You are asking questions too quickly. Please wait a moment.'),
    limiter(60 * 60 * 1000, localAi.ratePerHour, 'You have reached the hourly limit. Please try again later.'),
    async (req, res) => {
      const b = req.body || {};
      if (badBody(b)) return res.status(422).json({ success: false, message: 'Send only { message, conversationId, mode, materialId, stream }.' });
      const args = { user: req.user, req, message: b.message, conversationId: b.conversationId || undefined, mode: b.mode || 'short', materialId: b.materialId || undefined };
      const withCredits = async (r) => ({ ...r, credits: await credits.balance(req.user).catch(() => undefined) });

      if (b.stream !== true) {
        try {
          return res.json({ success: true, ...(await withCredits(await assistant.askLocal(args))) });
        } catch (err) {
          return sendError(res, err);
        }
      }

      // Server-Sent Events: `queue` (place in line), `cached`, `delta` events, then
      // `done` (the saved message) or `error`. If the student switches tab or closes
      // the page mid-answer, generation still completes and is saved.
      let open = false;
      let gone = false;
      res.on('close', () => {
        gone = true;
      });
      const send = (event, data) => {
        if (gone) return;
        if (!open) {
          res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.flushHeaders();
          open = true;
        }
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        res.flush?.();
      };
      try {
        const result = await assistant.askLocal({ ...args, onDelta: (text) => send('delta', { text }), onEvent: (name, data) => send(name, data) });
        send('done', { success: true, ...(await withCredits(result)) });
      } catch (err) {
        if (!open) return sendError(res, err);
        const { status, message, code } = safe(err);
        send('error', { success: false, status, code, message });
      }
      if (!gone) res.end();
    }
  );

  router.get(
    '/ai/study-doubts/me',
    ...base,
    wrap(async (req, res) => {
      const state = await LocalAIUserState.findOne({ user: req.user._id }).select('blockedUntil').lean();
      const blockedUntil = state?.blockedUntil && state.blockedUntil > new Date() ? state.blockedUntil : null;
      res.json({ credits: await credits.balance(req.user), limits: limits(), blockedUntil });
    })
  );

  router.get(
    '/ai/study-doubts/materials',
    ...base,
    wrap(async (req, res) => {
      res.json({ items: await listAttachable(req.user, { q: typeof req.query.q === 'string' ? req.query.q : '' }) });
    })
  );

  router.get(
    '/ai/study-doubts/conversations',
    ...base,
    wrap(async (req, res) => {
      res.json({ items: await assistant.listConversations(req.user), ...limits() });
    })
  );

  router.get(
    '/ai/study-doubts/conversations/:id',
    ...base,
    wrap(async (req, res) => {
      res.json(await assistant.getConversation(req.user, req.params.id));
    })
  );

  router.patch(
    '/ai/study-doubts/conversations/:id',
    ...base,
    wrap(async (req, res) => {
      const b = req.body || {};
      if (typeof b.title !== 'string' || Object.keys(b).some((k) => k !== 'title')) {
        return res.status(422).json({ success: false, message: 'Send only { title }.' });
      }
      res.json({ success: true, conversation: await assistant.renameConversation(req.user, req.params.id, b.title) });
    })
  );

  router.delete(
    '/ai/study-doubts/conversations/:id',
    ...base,
    wrap(async (req, res) => {
      await assistant.deleteConversation(req.user, req.params.id);
      res.json({ success: true });
    })
  );

  // ── IT support (not behind the gate, so it works while AI is stopped) ──
  const itSupport = [protect, authorize(SUPER_ADMIN_ROLE)];
  const itWrite = [...itSupport, superAdminWriteLimiter, requireRecentReauth];

  router.get(
    '/console/ai-doubts/status',
    ...itSupport,
    wrap(async (_req, res) => {
      const stop = stopState();
      const blocked = await LocalAIUserState.countDocuments({ blockedUntil: { $gt: new Date() } });
      res.json({
        enabledInEnv: localAi.enabled,
        stopped: Boolean(stop),
        stop,
        running: localAi.enabled && !stop,
        model: localAi.model,
        fallbackModel: localAi.fallbackModel || null,
        ...activity(),
        maxQueue: localAi.maxQueue,
        busyAt: localAi.fallbackQueueThreshold,
        blockedStudents: blocked,
        creditsEnabled: localAi.credits.enabled,
        credits: localAi.credits.enabled ? { monthly: localAi.credits.monthly, daily: localAi.credits.daily, roles: localAi.credits.chargedRoles } : null,
        limits: limits(),
        resumeCommand: 'cd server && npm run ai:resume',
      });
    })
  );

  router.post(
    '/console/ai-doubts/emergency-stop',
    ...itWrite,
    body('reason').isString().trim().isLength({ min: 5, max: 500 }).withMessage('Give a reason (5–500 characters)'),
    validate,
    wrap(async (req, res) => {
      const by = { id: String(req.user._id), role: req.user.role, name: req.user.name, email: req.user.email };
      const result = await emergencyStop({ by, reason: req.body.reason, source: 'console' });
      console.warn(`[local-ai] EMERGENCY STOP by ${req.user.role} ${req.user._id}: aborted ${result.aborted}, queued ${result.queued}, model unloaded: ${result.unloaded}`);
      await logAudit(req, 'AI_EMERGENCY_STOP', {
        reason: req.body.reason,
        details: { aborted: result.aborted, queued: result.queued, modelUnloaded: result.unloaded, alreadyStopped: result.alreadyStopped },
      });
      res.json({ success: true, stopped: true, stop: result.record, aborted: result.aborted, queued: result.queued, modelUnloaded: result.unloaded, resumeCommand: 'cd server && npm run ai:resume' });
    })
  );

  router.get(
    '/console/ai-doubts/blocked',
    ...itSupport,
    wrap(async (_req, res) => {
      res.json({ items: await listBlocked() });
    })
  );

  router.post(
    '/console/ai-doubts/unblock',
    ...itWrite,
    body('userId').isMongoId().withMessage('Invalid user'),
    body('reason').optional().isString().trim().isLength({ max: 300 }),
    validate,
    wrap(async (req, res) => {
      const target = await User.findById(req.body.userId).select('name email role').lean();
      await unblock(req.body.userId);
      await logAudit(req, 'AI_DOUBTS_UNBLOCKED', { target: target || { _id: req.body.userId }, reason: req.body.reason || 'Unblocked by IT support' });
      res.json({ success: true });
    })
  );

  router.get(
    '/console/ai-doubts/credits',
    ...itSupport,
    wrap(async (req, res) => {
      if (!localAi.credits.enabled) return res.json({ enabled: false });
      const target = await findAccount(req.query.account);
      if (!target) return res.status(404).json({ success: false, message: 'No account with that email or roll number.' });
      res.json({ account: { id: target._id, name: target.name, email: target.email, role: target.role, rollNo: target.rollNo, department: target.department }, credits: await credits.balance(target) });
    })
  );

  router.post(
    '/console/ai-doubts/credits/grant',
    ...itWrite,
    body('account').isString().trim().isLength({ min: 3, max: 120 }).withMessage('Enter the student’s email or roll number'),
    body('amount').isInt({ min: 1, max: 10000 }).withMessage('Bonus credits must be 1–10000').toInt(),
    body('reason').isString().trim().isLength({ min: 5, max: 300 }).withMessage('Give a reason (5–300 characters)'),
    validate,
    wrap(async (req, res) => {
      if (!localAi.credits.enabled) return res.status(409).json({ success: false, message: 'Credits are switched off (LOCAL_AI_CREDITS_ENABLED).' });
      const target = await findAccount(req.body.account);
      if (!target) return res.status(404).json({ success: false, message: 'No account with that email or roll number.' });
      if (!credits.isCharged(target)) return res.status(409).json({ success: false, message: 'This account does not use credits (unlimited).' });
      const balance = await credits.grant(target, req.body.amount, { by: req.user._id, reason: req.body.reason });
      await logAudit(req, 'AI_CREDITS_GRANTED', { target, reason: req.body.reason, details: { amount: req.body.amount, remaining: balance.remaining } });
      res.json({ success: true, credits: balance });
    })
  );

  return router;
}

function safe(err) {
  const status = Number.isInteger(err?.status) && err.status < 600 ? err.status : 500;
  if (status >= 500 && !err?.expose) console.error('[local-ai] request failed:', err?.name || 'error');
  return { status, code: err?.expose ? err.code : undefined, message: err?.expose ? err.message : 'Something went wrong. Please try again.' };
}

function sendError(res, err) {
  const { status, message, code } = safe(err);
  if (status === 503 && err?.category === 'overloaded') res.set('Retry-After', '30');
  return res.status(status).json({ success: false, code, message });
}
