import { localAi } from './config.js';
import { LocalAICreditLedger, LocalAIUserState } from './models.js';

/**
 * AI Doubts credits (switch on with LOCAL_AI_CREDITS_ENABLED=true).
 *
 *  - Each charged student (default roles: student, club_admin) gets
 *    `monthly` credits per calendar month (college time zone), no rollover,
 *    and can spend at most `daily` credits per day. Staff are unlimited.
 *  - Before an answer is generated the most it could cost is RESERVED, so
 *    two tabs can never overspend. After the answer it is SETTLED by its
 *    real size: short ≤100 words, normal ≤300 words, long >300 words;
 *    an answer served from the cache is cheap, refusals and errors are free.
 *  - IT support can add bonus credits for the current month (audited).
 */

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code, expose: true });
const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const LEDGER_DAYS = 400;

export function periodOf(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return { period: `${parts.year}-${parts.month}`, day: `${parts.year}-${parts.month}-${parts.day}` };
}

const c = () => localAi.credits;
export const isCharged = (user) => Boolean(c().enabled && user && c().chargedRoles.includes(user.role));

export function sizeOf(content) {
  const words = String(content || '').trim().split(/\s+/).filter(Boolean).length;
  if (words <= 100) return 'short';
  if (words <= 300) return 'normal';
  return 'long';
}

export function costOf(size) {
  return { short: c().costShort, normal: c().costNormal, long: c().costLong, cached: c().costCached }[size] ?? 0;
}

/** Make sure the student's row exists and the month / day counters are current. */
async function current(userId) {
  const { period, day } = periodOf();
  try {
    await LocalAIUserState.updateOne({ user: userId }, { $setOnInsert: { user: userId, credits: { period, day, used: 0, bonus: 0, dayUsed: 0 } } }, { upsert: true });
  } catch (err) {
    if (err?.code !== 11000) throw err; // created by a parallel request — fine
  }
  await LocalAIUserState.updateOne({ user: userId, 'credits.period': { $ne: period } }, { $set: { 'credits.period': period, 'credits.used': 0, 'credits.bonus': 0, 'credits.day': day, 'credits.dayUsed': 0 } });
  await LocalAIUserState.updateOne({ user: userId, 'credits.day': { $ne: day } }, { $set: { 'credits.day': day, 'credits.dayUsed': 0 } });
  const state = await LocalAIUserState.findOne({ user: userId }).select('credits').lean();
  return { period, day, credits: state?.credits || { used: 0, bonus: 0, dayUsed: 0 } };
}

function summary(credits) {
  const monthlyTotal = c().monthly + (credits.bonus || 0);
  const remaining = Math.max(0, monthlyTotal - (credits.used || 0));
  const dayRemaining = Math.max(0, c().daily - (credits.dayUsed || 0));
  return {
    enabled: true,
    unlimited: false,
    monthly: c().monthly,
    bonus: credits.bonus || 0,
    used: credits.used || 0,
    remaining,
    daily: c().daily,
    dayUsed: credits.dayUsed || 0,
    dayRemaining,
    available: Math.min(remaining, dayRemaining),
    low: remaining <= c().lowWarning,
    lowWarning: c().lowWarning,
  };
}

const COSTS = () => ({ short: c().costShort, normal: c().costNormal, long: c().costLong, cached: c().costCached, refused: 0 });

/** What the student sees: their balance (or that credits are off / unlimited). */
export async function balance(user) {
  if (!c().enabled) return { enabled: false };
  if (!isCharged(user)) return { enabled: true, unlimited: true, costs: COSTS() };
  const { credits, period } = await current(user._id);
  return { ...summary(credits), period, costs: COSTS() };
}

/**
 * Reserve the most this answer could cost. Short answers can reach "normal"
 * size at most; detailed ones can be "long".
 * @returns {Promise<{ amount: number, charged: boolean }>}
 */
export async function reserve(user, mode = 'short') {
  if (!isCharged(user)) return { amount: 0, charged: false };
  const want = mode === 'detailed' || mode === 'exam' ? c().costLong : c().costNormal;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { period, day, credits } = await current(user._id);
    const s = summary(credits);
    if (s.remaining < c().costShort) throw httpError(402, `You have used this month's AI Doubts credits (${s.monthly + s.bonus}). They reset on the 1st of next month.`, 'AI_NO_CREDITS');
    if (s.dayRemaining < c().costShort) throw httpError(402, `You have reached today's AI Doubts limit (${c().daily} credits). Please continue tomorrow.`, 'AI_DAILY_LIMIT');
    const amount = Math.min(want, s.available);
    const r = await LocalAIUserState.updateOne(
      {
        user: user._id,
        'credits.period': period,
        'credits.day': day,
        'credits.used': credits.used || 0,
        'credits.dayUsed': credits.dayUsed || 0,
      },
      { $inc: { 'credits.used': amount, 'credits.dayUsed': amount } }
    );
    if (r.modifiedCount === 1) return { amount, charged: true, period };
    // Another request changed the balance in between — read again and retry.
  }
  throw httpError(409, 'Please wait for your previous question to finish.', 'AI_BUSY');
}

/**
 * Settle a reservation: charge the real cost (never more than reserved) and
 * give the rest back. size: short | normal | long | cached | refused | error.
 */
export async function settle(user, reservation, size, { mode, conversationId, materialId } = {}) {
  if (!reservation?.charged) return { cost: 0 };
  const cost = Math.min(reservation.amount, costOf(size));
  const refund = reservation.amount - cost;
  if (refund > 0) {
    // Same month only: a reservation made before midnight on the 1st is simply dropped.
    await LocalAIUserState.updateOne(
      { user: user._id, 'credits.period': reservation.period, 'credits.used': { $gte: refund } },
      { $inc: { 'credits.used': -refund, 'credits.dayUsed': -refund } }
    );
    await LocalAIUserState.updateOne({ user: user._id, 'credits.dayUsed': { $lt: 0 } }, { $set: { 'credits.dayUsed': 0 } });
  }
  if (cost > 0) {
    await LocalAICreditLedger.create({
      user: user._id,
      kind: 'charge',
      amount: cost,
      size,
      mode,
      conversation: conversationId || undefined,
      material: materialId || undefined,
      period: reservation.period,
      expiresAt: new Date(Date.now() + LEDGER_DAYS * 86400000),
    }).catch((err) => console.warn('[local-ai] credit ledger write failed:', err.message));
  }
  return { cost };
}

/** IT support: add bonus credits for the current month. */
export async function grant(target, amount, { by, reason }) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw httpError(422, 'Bonus credits must be a whole number from 1 to 10000.');
  const { period } = await current(target._id);
  await LocalAIUserState.updateOne({ user: target._id }, { $inc: { 'credits.bonus': n } });
  await LocalAICreditLedger.create({ user: target._id, kind: 'grant', amount: n, size: 'bonus', by, reason, period, expiresAt: new Date(Date.now() + LEDGER_DAYS * 86400000) });
  const { credits } = await current(target._id);
  return summary(credits);
}
