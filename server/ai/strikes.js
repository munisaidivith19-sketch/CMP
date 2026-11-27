import mongoose from 'mongoose';
import { localAi } from './config.js';
import { LocalAIUserState } from './models.js';
import { logAudit } from '../src/utils/auditLog.js';

/**
 * Misuse strikes. Prompt-injection attempts, questions probing this
 * platform's servers / database / tech stack, and sexual requests each count
 * as one strike. `strikesToBlock` strikes within `strikeWindowHours` block
 * that student from AI Doubts for `blockHours` (audited + security alert).
 * Only that student is affected — AI keeps working for everyone else.
 * IT support can lift a block early (Console → Troubleshooting → AI Doubts).
 */

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code, expose: true });

const untilText = (d) =>
  new Date(d).toLocaleString('en-IN', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export async function assertNotBlocked(user) {
  const state = await LocalAIUserState.findOne({ user: user._id }).select('blockedUntil').lean();
  if (state?.blockedUntil && state.blockedUntil > new Date()) {
    throw httpError(403, `AI Doubts is paused for your account until ${untilText(state.blockedUntil)} because of repeated requests that break the rules. Contact IT support if you think this is a mistake.`, 'AI_BLOCKED');
  }
}

/**
 * Record one strike; blocks the student when the limit is reached.
 * @returns {Promise<{ strikes: number, blocked: boolean, blockedUntil?: Date }>}
 */
export async function addStrike(user, category, req) {
  const now = new Date();
  const since = new Date(now.getTime() - localAi.strikeWindowHours * 3600 * 1000);
  const state = await LocalAIUserState.findOneAndUpdate(
    { user: user._id },
    { $push: { strikes: { $each: [{ at: now, category }], $slice: -50 } }, $setOnInsert: { user: user._id } },
    { upsert: true, returnDocument: 'after' }
  ).lean();
  const recent = (state.strikes || []).filter((s) => s.at >= since);
  console.warn(`[local-ai] strike (${category}) for user ${user._id}: ${recent.length}/${localAi.strikesToBlock} in ${localAi.strikeWindowHours}h`);
  if (recent.length < localAi.strikesToBlock || (state.blockedUntil && state.blockedUntil > now)) return { strikes: recent.length, blocked: false };

  const blockedUntil = new Date(now.getTime() + localAi.blockHours * 3600 * 1000);
  const reason = `${recent.length} rule-breaking AI requests in ${localAi.strikeWindowHours}h (${[...new Set(recent.map((s) => s.category))].join(', ')})`;
  await LocalAIUserState.updateOne({ user: user._id }, { $set: { blockedUntil, blockReason: reason.slice(0, 200) } });
  await logAudit(req, 'AI_DOUBTS_BLOCKED', {
    actor: user,
    target: user,
    outcome: 'denied',
    reason,
    details: { categories: recent.map((s) => s.category), blockedUntil: blockedUntil.toISOString() },
  });
  return { strikes: recent.length, blocked: true, blockedUntil };
}

/** IT support: students currently blocked. */
export async function listBlocked() {
  const rows = await LocalAIUserState.find({ blockedUntil: { $gt: new Date() } })
    .sort({ blockedUntil: -1 })
    .limit(200)
    .populate('user', 'name email role rollNo department')
    .select('user blockedUntil blockReason strikes')
    .lean();
  return rows.map((r) => ({
    userId: r.user?._id || r.user,
    name: r.user?.name,
    email: r.user?.email,
    role: r.user?.role,
    rollNo: r.user?.rollNo,
    department: r.user?.department,
    blockedUntil: r.blockedUntil,
    reason: r.blockReason,
    strikes: (r.strikes || []).slice(-10).map((s) => ({ at: s.at, category: s.category })),
  }));
}

/** IT support: lift a block early (also clears the strikes). */
export async function unblock(userId) {
  if (!mongoose.isValidObjectId(userId)) throw httpError(400, 'Invalid user id');
  const r = await LocalAIUserState.findOneAndUpdate(
    { user: userId, blockedUntil: { $gt: new Date() } },
    { $set: { blockedUntil: null, blockReason: '', strikes: [] } },
    { returnDocument: 'after' }
  ).lean();
  if (!r) throw httpError(404, 'This student is not blocked.');
  return r;
}
