import crypto from 'node:crypto';
import mongoose from 'mongoose';
import OutpassOtp from '../../models/OutpassOtp.js';
import User from '../../models/User.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/http.js';
import { testOtpProvider } from './providers/testOtpProvider.js';
import { collegeSmsProvider } from './providers/collegeSmsProvider.js';

const PROVIDERS = { test: testOtpProvider, college_sms: collegeSmsProvider };

/**
 * Read at call time so configuration alone switches it. While SMS is disabled
 * (OTP_SMS_ENABLED is not "true") nothing is ever sent: the stand-in provider
 * only holds the code for the admin views. With SMS enabled, OTP_PROVIDER
 * picks the real sender.
 */
export function getOtpProvider() {
  if (!env.otp.smsEnabled) return testOtpProvider;
  const provider = PROVIDERS[env.otp.provider];
  if (!provider) throw new ApiError(500, 'OTP service is misconfigured');
  return provider;
}

export function maskMobile(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 4 ? `******${digits.slice(-4)}` : '******';
}

// Keyed hash: a leaked database alone is not enough to brute-force the 10^6 codes offline.
const hashKey = () => crypto.createHmac('sha256', env.accessSecret).update('vexon:outpass-otp:v1').digest();
const hashOtp = (otpId, otp) => crypto.createHmac('sha256', hashKey()).update(`${otpId}:${otp}`).digest('hex');

/**
 * AES-256-GCM copy of the code, readable only by the server, so the
 * admin-only Security & Logs → OTP dashboard can show it. Verification never
 * uses it — that stays on the keyed hash. Separate key from chat encryption.
 */
const sealKey = () => crypto.createHmac('sha256', env.accessSecret).update('vexon:outpass-otp-display:v1').digest();
function sealOtp(otpId, otp) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  cipher.setAAD(Buffer.from(String(otpId)));
  const body = Buffer.concat([cipher.update(String(otp), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
function unsealOtp(otpId, sealed) {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(String(otpId)));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function sameHash(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Always exactly OTP_LENGTH numeric digits, zero-padded (e.g. "0427"). */
export const generateOtp = () => String(crypto.randomInt(0, 10 ** env.otp.length)).padStart(env.otp.length, '0');
const cooldownMs = () => env.otp.resendCooldownSeconds * 1000;

/** Errors carry the audit event the controller should record. */
function otpError(status, message, event, reason) {
  const err = new ApiError(status, message);
  err.otpEvent = event;
  if (reason) err.otpReason = reason;
  return err;
}

/**
 * The parent mobile an OTP goes to: the student's registered number on their
 * account, falling back to the number captured from that same account when
 * the pass was created. Never anything from the OTP request itself.
 *
 * Exception, by the college's decision: a day scholar's Outing uses the parent
 * number the student typed on that request (stored on the pass when it was
 * created). Reviewers see a warning when it differs from the registered one.
 */
async function registeredParentMobile(pass) {
  if (pass.dayScholarOuting) {
    const typed = String(pass.parentPhone || '').trim();
    return typed.replace(/\D/g, '').length >= 6 ? typed : null;
  }
  const student = await User.findById(pass.student?._id || pass.student).select('parentPhone').lean();
  const phone = String(student?.parentPhone || pass.parentPhone || '').trim();
  return phone.replace(/\D/g, '').length >= 6 ? phone : null;
}

function publicState(record) {
  const provider = getOtpProvider();
  const base = { otpLength: env.otp.length, devMode: Boolean(provider.devPortal) };
  if (!record) return { ...base, status: 'none', resendAvailableAt: null };
  const expired = record.status === 'active' && record.expiresAt <= new Date();
  return {
    ...base,
    status: expired ? 'expired' : record.status,
    maskedMobile: record.parentMobileMasked,
    sentAt: record.lastSentAt,
    expiresAt: record.expiresAt,
    attemptsLeft: Math.max(0, record.maxAttempts - record.attempts),
    resendAvailableAt: new Date(record.lastSentAt.getTime() + cooldownMs()),
  };
}

const latestFor = (gatePassId) => OutpassOtp.findOne({ gatePass: gatePassId }).sort({ createdAt: -1 });

/** Current OTP state for a gate pass — never includes the code. */
export async function getOtpState(gatePassId) {
  return publicState(await latestFor(gatePassId));
}

/**
 * Issue a new OTP for a gate pass and deliver it through the configured
 * provider. Any earlier OTP for the pass stops working.
 */
export async function requestOtp({ pass, studentName, faculty }) {
  const provider = getOtpProvider();
  const now = new Date();
  const latest = await latestFor(pass._id);
  if (latest && now - latest.lastSentAt < cooldownMs()) {
    const wait = Math.ceil((latest.lastSentAt.getTime() + cooldownMs() - now) / 1000);
    throw new ApiError(429, `Please wait ${wait} second${wait === 1 ? '' : 's'} before requesting another OTP`);
  }

  const to = await registeredParentMobile(pass);
  if (!to) {
    throw otpError(422, 'This student has no registered parent mobile number. Ask an administrator to add it.', 'failed', 'no_parent_mobile');
  }

  const otp = generateOtp();
  const _id = new mongoose.Types.ObjectId();
  const maskedMobile = maskMobile(to);
  await OutpassOtp.updateMany({ gatePass: pass._id, status: 'active' }, { $set: { status: 'superseded' } });
  const record = await OutpassOtp.create({
    _id,
    gatePass: pass._id,
    student: pass.student?._id || pass.student,
    faculty: faculty._id,
    parentMobileMasked: maskedMobile,
    otpHash: hashOtp(_id, otp),
    otpSealed: sealOtp(_id, otp),
    expiresAt: new Date(now.getTime() + env.otp.expiryMinutes * 60000),
    maxAttempts: env.otp.maxAttempts,
    lastSentAt: now,
    provider: provider.name,
  });

  try {
    await provider.sendOtp({ otpId: _id, to, maskedMobile, studentName, otp, expiresAt: record.expiresAt });
  } catch (err) {
    await OutpassOtp.updateOne({ _id }, { $set: { status: 'failed' } });
    const failure = err instanceof ApiError ? err : new ApiError(502, 'Could not send the OTP. Please try again.');
    failure.otpEvent = 'failed';
    failure.otpReason = 'send_failed';
    failure.otpId = _id;
    throw failure;
  }
  return { otpId: _id, resent: Boolean(latest), smsSent: Boolean(provider.delivers), ...publicState(record) };
}

/**
 * Check an OTP for a gate pass. Each check consumes an attempt before the
 * comparison, so concurrent guesses cannot exceed the limit. Resolves with the
 * consumed record; rejects with an ApiError carrying `otpEvent`.
 */
export async function verifyOtp({ gatePassId, otp }) {
  const record = await OutpassOtp.findOne({ gatePass: gatePassId, status: 'active' }).sort({ createdAt: -1 }).select('+otpHash');
  if (!record) throw otpError(422, 'There is no active OTP for this request. Send a new OTP.', 'failed', 'no_active_otp');

  if (record.expiresAt <= new Date()) {
    await OutpassOtp.updateOne({ _id: record._id, status: 'active' }, { $set: { status: 'expired' } });
    throw otpError(410, 'This OTP has expired. Send a new OTP.', 'expired');
  }

  const claimed = await OutpassOtp.findOneAndUpdate(
    { _id: record._id, status: 'active', attempts: { $lt: record.maxAttempts } },
    { $inc: { attempts: 1 } },
    { new: true }
  );
  if (!claimed) {
    await OutpassOtp.updateOne({ _id: record._id, status: 'active' }, { $set: { status: 'locked' } });
    throw otpError(429, 'Too many incorrect attempts. Send a new OTP.', 'locked');
  }

  if (!sameHash(hashOtp(record._id, String(otp)), record.otpHash)) {
    const left = claimed.maxAttempts - claimed.attempts;
    if (left <= 0) {
      await OutpassOtp.updateOne({ _id: record._id, status: 'active' }, { $set: { status: 'locked' } });
      throw otpError(429, 'Incorrect OTP. Too many incorrect attempts — send a new OTP.', 'locked');
    }
    throw otpError(422, `Incorrect OTP. ${left} attempt${left === 1 ? '' : 's'} left.`, 'failed', 'incorrect_otp');
  }

  const used = await OutpassOtp.findOneAndUpdate(
    { _id: record._id, status: 'active' },
    { $set: { status: 'used', usedAt: new Date() } },
    { new: true }
  );
  if (!used) throw otpError(409, 'This OTP has already been used.', 'failed', 'already_used');
  testOtpProvider.forget(record._id);
  return used;
}

/**
 * Send a plain (non-OTP) SMS to a parent through the configured provider.
 * Never throws: a failed parent message must not undo the event it reports.
 */
export async function sendParentMessage({ to, message, kind }) {
  try {
    await getOtpProvider().sendMessage({ to, maskedMobile: maskMobile(to), message, kind });
    return true;
  } catch (err) {
    console.error(`[sms] ${kind} message to ${maskMobile(to)} failed: ${err.message}`);
    return false;
  }
}

/** Recent OTPs with their test codes — for the development OTP portal only. */
export async function listDevOtps({ limit = 50 } = {}) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const records = await OutpassOtp.find({ createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('student', 'name rollNo department year section')
    .populate('faculty', 'name')
    .lean();
  const now = new Date();
  return records.map((r) => {
    const status = r.status === 'active' && r.expiresAt <= now ? 'expired' : r.status;
    return {
      id: r._id,
      gatePassId: r.gatePass,
      passRef: `GP-${String(r.gatePass).slice(-6).toUpperCase()}`,
      student: r.student,
      faculty: r.faculty,
      parentMobile: r.parentMobileMasked,
      otp: status === 'active' && r.provider === testOtpProvider.name ? testOtpProvider.peek(r._id) : null,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      status,
      attempts: r.attempts,
      maxAttempts: r.maxAttempts,
      provider: r.provider,
    };
  });
}

// ── Admin → Security & Logs → OTP ──────────────────────────────────

/** Lifecycle status as the OTP dashboard shows it (expiry is computed, never client-set). */
export function displayStatus(record, now = new Date()) {
  return record.status === 'active' && record.expiresAt <= now ? 'expired' : record.status;
}

/**
 * Every OTP record as a card for the admin-only OTP dashboard, newest first,
 * with the code itself unsealed on the server. Filters arrive pre-validated
 * from the route; student filters resolve to ids first, so no user text
 * becomes a query operator.
 */
export async function listAdminOtps({ studentIds, status, from, to, page = 1, limit = 24 } = {}) {
  const now = new Date();
  const filter = {};
  if (studentIds) filter.student = { $in: studentIds };
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  if (status === 'expired') {
    filter.$or = [{ status: 'expired' }, { status: 'active', expiresAt: { $lte: now } }];
  } else if (status === 'active') {
    Object.assign(filter, { status: 'active', expiresAt: { $gt: now } });
  } else if (status) {
    filter.status = status;
  }

  const [records, total] = await Promise.all([
    OutpassOtp.find(filter)
      .select('+otpSealed')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('student', 'name rollNo department year section semester')
      .populate('faculty', 'name')
      .lean(),
    OutpassOtp.countDocuments(filter),
  ]);
  const items = records.map((r) => ({
    id: r._id,
    otp: unsealOtp(r._id, r.otpSealed),
    status: displayStatus(r, now),
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    usedAt: r.usedAt || null,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    parentMobile: r.parentMobileMasked,
    smsSent: r.provider !== testOtpProvider.name && r.status !== 'failed',
    gatePassId: r.gatePass,
    passRef: `GP-${String(r.gatePass).slice(-6).toUpperCase()}`,
    student: r.student
      ? { name: r.student.name, rollNo: r.student.rollNo, department: r.student.department, year: r.student.year, section: r.student.section }
      : null,
    requestedBy: r.faculty?.name || null,
  }));
  return { items, total };
}
