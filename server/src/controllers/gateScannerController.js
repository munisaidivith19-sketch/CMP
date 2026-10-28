/**
 * Windows Gate Scanner (gate-scanner/) — Security role only.
 *
 * A scan never invents a gate event. The QR prefix decides which existing flow
 * runs: CCGP: (exit code) → the same commit as the web OUT screen
 * (confirmExit), CCRT: (return token) → the same commit as the web Return
 * screen (confirmReturn). Approval, expiry, single use and the return
 * location check stay exactly where they were; this controller only resolves
 * the credential, calls that commit and records the attempt (GateScanEvent)
 * so retries are idempotent and rejected attempts stay visible.
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import GatePass, { normalizeGateCode } from '../models/GatePass.js';
import GateScanEvent from '../models/GateScanEvent.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { ApiError, asyncHandler, escapeRegex, paginate, pageMeta, pick } from '../utils/http.js';
import { addDays, dayKey, timestampFilter, toDay, today } from '../utils/dates.js';
import { logSecurity } from '../utils/securityLog.js';
import { RETURN_QR_PREFIX } from '../services/gatePassReturn.js';
import { QR_PREFIX, confirmExit, confirmReturn, expireGatePasses, passSecurity, problemsFor } from './gatePassController.js';

const STUDENT_ROLES = ['student', 'club_admin'];
const STUDENT_VIEW_FIELDS = 'name rollNo avatar department year section';
const pickStudent = (s) => (s && typeof s === 'object' && s.name !== undefined ? pick(s, ['_id', 'name', 'rollNo', 'avatar', 'department', 'year', 'section']) : null);
const passRef = (id) => (id ? `GP-${String(id).slice(-6).toUpperCase()}` : null);
// Same "due back" rule as the existing gate dashboard: end of the return day + 2 h.
const OVERDUE_AFTER_MS = 24 * 3600000 + 2 * 3600000;
// A repeated read of a credential that was just used is answered "already recorded".
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
// A scan still "processing" this long after it began did not reach the commit.
const STALE_SCAN_MS = 30 * 1000;
const MAX_HISTORY_DAYS = 366;

/** Guard-facing messages, keyed by the stable code the client acts on. */
export const SCAN_MESSAGES = {
  EXIT_RECORDED: 'Exit recorded.',
  RETURN_RECORDED: 'Return recorded — student is inside.',
  INVALID_PAYLOAD: 'The QR code was incomplete or unreadable. Scan it again.',
  NOT_A_GATE_PASS: 'This is not a J.N.N gate pass QR code.',
  CODE_NEEDS_DIRECTION: 'Choose Exit code or Return code before entering a code by hand.',
  UNKNOWN_CREDENTIAL: 'Invalid, expired or already-used gate pass code.',
  UNKNOWN_RETURN: 'Invalid or already-used return code.',
  NOT_OUTSIDE: 'This pass is not waiting for a return.',
  RETURN_EXPIRED: 'This return code has expired — ask the student to verify their location again.',
  NOT_RECORDED: 'This scan was not recorded. Scan the QR again.',
};

const cleanLabel = (v) => String(v || '').replace(/[^\w .#\-()]/g, '').trim().slice(0, 60) || undefined;
const campusTime = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: env.timezone, hour: '2-digit', minute: '2-digit' });

/** Keyed digest of a credential: lets a repeat be recognised without storing the QR itself. */
const digestOf = (key) => crypto.createHmac('sha256', env.accessSecret).update(`gate-scan:${key}`).digest('hex');

/**
 * Read a scanned or typed value. A QR carries its own direction (CCGP: exit,
 * CCRT: return); a bare 4-character code is only accepted from manual entry
 * with the direction chosen, because exit and return codes share a format.
 */
export function parseScanPayload(raw, { kind, source } = {}) {
  const value = String(raw ?? '').trim();
  const fail = (code) => ({ error: { code, message: SCAN_MESSAGES[code] } });
  // eslint-disable-next-line no-control-regex
  if (!value || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) return fail('INVALID_PAYLOAD');
  const upper = value.toUpperCase();
  if (upper.startsWith(QR_PREFIX)) {
    const code = normalizeGateCode(value, QR_PREFIX);
    return code ? { direction: 'out', code, digestKey: `X:${code}` } : fail('INVALID_PAYLOAD');
  }
  if (upper.startsWith(RETURN_QR_PREFIX)) {
    const token = value.slice(RETURN_QR_PREFIX.length);
    return /^[A-Za-z0-9_-]{20,64}$/.test(token) ? { direction: 'in', credential: { returnToken: token }, digestKey: `RT:${token}` } : fail('INVALID_PAYLOAD');
  }
  if (source !== 'manual') return fail('NOT_A_GATE_PASS');
  if (!kind) return fail('CODE_NEEDS_DIRECTION');
  const code = normalizeGateCode(value);
  if (!code) return fail('INVALID_PAYLOAD');
  return kind === 'out' ? { direction: 'out', code, digestKey: `X:${code}` } : { direction: 'in', credential: { returnCode: code }, digestKey: `RC:${code}` };
}

// Approved-pass problems (problemsFor) → stable codes.
const STATUS_CODES = { completed: 'ALREADY_USED', active: 'ALREADY_USED', expired: 'EXPIRED', revoked: 'REVOKED', rejected: 'NOT_VALID', cancelled: 'NOT_VALID' };
function exitProblemCode(pass, problem) {
  if (pass.status !== 'approved') return STATUS_CODES[pass.status] || 'NOT_APPROVED';
  return /window has closed/i.test(problem) ? 'EXPIRED' : /allowed from/i.test(problem) ? 'NOT_YET_OPEN' : 'NOT_VALID';
}

/** A committed pass → the scan result. */
const committed = (pass, direction) => ({
  outcome: 'success',
  code: direction === 'out' ? 'EXIT_RECORDED' : 'RETURN_RECORDED',
  message: direction === 'out' && pass.dayScholarOuting ? 'Exit recorded — day scholar outing complete.' : SCAN_MESSAGES[direction === 'out' ? 'EXIT_RECORDED' : 'RETURN_RECORDED'],
  gatePass: pass._id,
  student: pass.student?._id || pass.student,
  recordedAt: direction === 'out' ? pass.actualExit : pass.actualReturn,
});
const rejected = (code, message, pass) => ({ outcome: 'rejected', code, message: message || SCAN_MESSAGES[code], gatePass: pass?._id, student: pass?.student?._id || pass?.student });

/** The credential matches no usable pass: a repeat of a scan that just succeeded, or simply invalid. */
async function notFound(req, event, unknownCode) {
  const prior = await GateScanEvent.findOne({
    payloadDigest: event.payloadDigest,
    outcome: 'success',
    _id: { $ne: event._id },
    createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
  })
    .populate('guard', 'name')
    .lean();
  if (prior) {
    return {
      outcome: 'duplicate',
      code: 'ALREADY_RECORDED',
      message: `Already recorded at ${campusTime(prior.recordedAt || prior.createdAt)}${prior.guard?.name ? ` by ${prior.guard.name}` : ''}. Nothing was changed.`,
      gatePass: prior.gatePass,
      student: prior.student,
      recordedAt: prior.recordedAt,
    };
  }
  logSecurity(req, 'GATE_PASS_VERIFICATION_FAILED', { success: false, reason: event.direction === 'out' ? 'unknown_code' : 'unknown_return_credential', entityType: 'gate_pass', details: { via: 'gate_scanner' } });
  return rejected(unknownCode);
}

/** Resolve the credential and run the existing commit. Business refusals come back as results; only real failures throw. */
async function processScan(req, event, parsed) {
  if (parsed.direction === 'out') {
    await expireGatePasses();
    const pass = await GatePass.findOne({ verificationCode: parsed.code }).select('student status actualExit verificationExpiry leaveAt fromDate dayScholarOuting passType');
    if (!pass) return notFound(req, event, 'UNKNOWN_CREDENTIAL');
    await GateScanEvent.updateOne({ _id: event._id }, { $set: { gatePass: pass._id, student: pass.student } });
    const problems = problemsFor(pass);
    if (problems.length) {
      passSecurity(req, 'GATE_PASS_VERIFICATION_FAILED', pass, { success: false, reason: problems[0], details: { via: 'gate_scanner' } });
      return rejected(exitProblemCode(pass, problems[0]), problems[0], pass);
    }
    try {
      return committed(await confirmExit(req, pass._id, parsed.code), 'out');
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) return rejected(err.status === 409 ? 'ALREADY_USED' : 'NOT_VALID', err.message, pass);
      throw err;
    }
  }

  const pass = await GatePass.findOne(parsed.credential).select('student status actualExit returnCredentialExpiresAt');
  if (!pass) return notFound(req, event, 'UNKNOWN_RETURN');
  await GateScanEvent.updateOne({ _id: event._id }, { $set: { gatePass: pass._id, student: pass.student } });
  if (pass.status !== 'active' || !pass.actualExit) return rejected('NOT_OUTSIDE', null, pass);
  if (pass.returnCredentialExpiresAt <= new Date()) {
    passSecurity(req, 'GATE_PASS_VERIFICATION_FAILED', pass, { success: false, reason: 'expired_return_credential', details: { via: 'gate_scanner' } });
    return rejected('RETURN_EXPIRED', null, pass);
  }
  try {
    return committed(await confirmReturn(req, pass._id, parsed.credential), 'in');
  } catch (err) {
    if (err instanceof ApiError && err.status < 500) return rejected(err.status === 409 ? 'ALREADY_USED' : 'NOT_VALID', err.message, pass);
    throw err;
  }
}

/**
 * Store the result. Conditional on still "processing", so a late duplicate
 * can never overwrite an earlier answer — except a committed success, which
 * is the truth whatever was written meanwhile.
 */
async function finish(event, result) {
  const set = { state: 'done', completedAt: new Date(), ...pick(result, ['outcome', 'code', 'message', 'gatePass', 'student', 'recordedAt']) };
  if (result.direction) set.direction = result.direction;
  const filter = result.outcome === 'success' ? { _id: event._id } : { _id: event._id, state: 'processing' };
  const saved = await GateScanEvent.findOneAndUpdate(filter, { $set: set }, { new: true });
  return saved || GateScanEvent.findById(event._id);
}

/** What the client sees of a scan. No QR payload, no digest, no internal ids beyond the scan's own. */
async function scanView(event, extra = {}) {
  const doc = await GateScanEvent.findById(event._id).populate('student', STUDENT_VIEW_FIELDS).populate('guard', 'name').lean();
  return {
    scanId: doc.scanId,
    state: doc.state,
    outcome: doc.outcome || null,
    code: doc.code || null,
    message: doc.message || null,
    direction: doc.direction || null,
    source: doc.source,
    gate: doc.gate || null,
    passRef: passRef(doc.gatePass),
    student: pickStudent(doc.student),
    guard: doc.guard?.name ? { name: doc.guard.name } : null,
    recordedAt: doc.recordedAt || null,
    receivedAt: doc.createdAt,
    ...extra,
  };
}

/**
 * A scan seen before (a retry with the same scanId). Done → the stored answer.
 * Still processing → if the pass shows this guard's commit, it succeeded; if
 * it has been stale long enough that the original request cannot still be
 * running, it was never recorded; otherwise it is still in progress.
 */
async function settle(event) {
  if (event.state === 'done') return scanView(event, { replayed: true });
  if (event.gatePass && event.direction) {
    const pass = await GatePass.findById(event.gatePass).select('student actualExit actualReturn exitVerifiedBy returnVerifiedBy dayScholarOuting').lean();
    const at = event.direction === 'out' ? pass?.actualExit : pass?.actualReturn;
    const by = event.direction === 'out' ? pass?.exitVerifiedBy : pass?.returnVerifiedBy;
    if (at && by && String(by) === String(event.guard) && new Date(at) >= new Date(event.createdAt)) {
      await finish(event, committed(pass, event.direction));
      return scanView(event, { replayed: true });
    }
  }
  if (Date.now() - new Date(event.createdAt).getTime() > STALE_SCAN_MS) {
    await finish(event, rejected('NOT_RECORDED'));
    return scanView(event, { replayed: true });
  }
  return scanView(event, { pending: true });
}

// ── Endpoints ─────────────────────────────────────────────────────────

/** GET /gate-scanner/session — who is signed in on this gate PC (re-validated on every app start). */
export const session = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    guard: { name: req.user.name, role: req.user.role, employeeId: req.user.employeeId || null },
    client: req.sessionClient,
    serverTime: new Date(),
    timezone: env.timezone,
    collegeName: env.collegeName,
  });
});

/** POST /gate-scanner/scans { scanId, payload, source, kind? } — process one scan exactly once. */
export const submitScan = asyncHandler(async (req, res) => {
  const { scanId, payload, source, kind } = req.body;
  let event;
  try {
    event = await GateScanEvent.create({
      scanId,
      guard: req.user._id,
      session: mongoose.isValidObjectId(req.sessionId) ? req.sessionId : undefined,
      source,
      gate: cleanLabel(req.get('x-gate-name')),
      device: cleanLabel(req.get('x-device-name')),
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const view = await settle(await GateScanEvent.findOne({ guard: req.user._id, scanId }));
    return res.status(view.pending ? 202 : 200).json(view);
  }

  const parsed = parseScanPayload(payload, { kind, source });
  if (parsed.error) {
    await finish(event, { outcome: 'rejected', ...parsed.error });
    return res.json(await scanView(event));
  }
  event.direction = parsed.direction;
  event.payloadDigest = digestOf(parsed.digestKey);
  await event.save();

  // An unexpected failure leaves the row "processing" with the pass attached;
  // the client's retry (same scanId) settles it from the pass itself.
  const result = await processScan(req, event, parsed);
  await finish(event, result);
  res.json(await scanView(event));
});

/** GET /gate-scanner/scans/:scanId — this guard's scan, to settle a request that timed out. */
export const getScan = asyncHandler(async (req, res) => {
  const event = await GateScanEvent.findOne({ guard: req.user._id, scanId: req.params.scanId });
  if (!event) throw new ApiError(404, 'This scan never reached the server — it was not recorded.', undefined, { code: 'SCAN_NOT_FOUND' });
  const view = await settle(event);
  res.status(view.pending ? 202 : 200).json(view);
});

/**
 * GET /gate-scanner/dashboard — counts from the gate-pass records only.
 * "Outside" means on an active gate pass (exit recorded, return not yet); it
 * is not a physical head count: day scholars and anyone who left without a
 * gate pass are not tracked by these records.
 */
export const dashboard = asyncHandler(async (req, res) => {
  await expireGatePasses();
  const day = today();
  const todayTs = timestampFilter({ from: day, to: day });
  const activeOut = { status: 'active', actualExit: { $ne: null } };
  const [totalStudents, outsideIds, overdueIds, outEvents, inEvents, mine, recent] = await Promise.all([
    User.countDocuments({ role: { $in: STUDENT_ROLES }, isActive: true }),
    GatePass.distinct('student', activeOut),
    GatePass.distinct('student', { ...activeOut, toDate: { $lt: new Date(Date.now() - OVERDUE_AFTER_MS) } }),
    GatePass.countDocuments({ actualExit: todayTs }),
    GatePass.countDocuments({ actualReturn: todayTs }),
    GateScanEvent.aggregate([{ $match: { guard: req.user._id, state: 'done', createdAt: todayTs } }, { $group: { _id: '$outcome', n: { $sum: 1 } } }]),
    GateScanEvent.find({ guard: req.user._id, state: 'done' }).sort({ createdAt: -1 }).limit(10).select('_id').lean(),
  ]);
  // Only current, active student accounts count towards the population.
  const outside = outsideIds.length ? await User.countDocuments({ _id: { $in: outsideIds }, role: { $in: STUDENT_ROLES }, isActive: true }) : 0;
  const byOutcome = Object.fromEntries(mine.map((m) => [m._id, m.n]));
  res.set('Cache-Control', 'no-store');
  res.json({
    generatedAt: new Date(),
    date: dayKey(day),
    timezone: env.timezone,
    presenceBasis: 'gate_pass',
    population: { totalStudents, outsideOnPass: outside, notOnActivePass: Math.max(0, totalStudents - outside), overdue: overdueIds.length },
    today: { outEvents, inEvents },
    myScansToday: { success: byOutcome.success || 0, rejected: byOutcome.rejected || 0, duplicate: byOutcome.duplicate || 0 },
    recent: await Promise.all(recent.map((r) => scanView(r))),
  });
});

/** today / yesterday / week (Mon–today) / month (1st–today) / custom → inclusive campus days. */
export function historyRange({ range = 'today', from, to } = {}, now = today()) {
  switch (range) {
    case 'today':
      return { from: now, to: now };
    case 'yesterday':
      return { from: addDays(now, -1), to: addDays(now, -1) };
    case 'week':
      return { from: addDays(now, -((now.getUTCDay() + 6) % 7)), to: now };
    case 'month':
      return { from: toDay(`${dayKey(now).slice(0, 8)}01`), to: now };
    case 'custom': {
      if (!from || !to) throw new ApiError(422, 'Choose both a start and an end date');
      const f = toDay(from);
      const t = toDay(to);
      if (f > t) throw new ApiError(422, '"From" must be before "to"');
      if (t > now) throw new ApiError(422, 'The end date cannot be in the future');
      if ((t - f) / 86400000 + 1 > MAX_HISTORY_DAYS) throw new ApiError(422, 'Choose a range of one year or less');
      return { from: f, to: t };
    }
    default:
      throw new ApiError(422, 'Unknown range');
  }
}

/** Student ids matching a name / roll number search (bounded). */
async function searchStudents(q) {
  const rx = new RegExp(escapeRegex(q), 'i');
  return User.find({ role: { $in: STUDENT_ROLES }, $or: [{ name: rx }, { rollNo: rx }] }).limit(500).distinct('_id');
}

/**
 * GET /gate-scanner/history — recorded gate events (exits and returns) read
 * from the gate passes themselves, so every event appears once, whichever
 * screen recorded it. Paginated and filtered on the server.
 */
export const history = asyncHandler(async (req, res) => {
  const { from, to } = historyRange(req.query);
  const ts = timestampFilter({ from, to });
  const { page, limit, skip } = paginate(req, 25, 100);
  const types = req.query.type ? [req.query.type] : ['out', 'in'];
  const match = { $or: [] };
  if (types.includes('out')) match.$or.push({ actualExit: ts });
  if (types.includes('in')) match.$or.push({ actualReturn: ts });
  const q = String(req.query.q || '').trim();
  if (q) match.student = { $in: await searchStudents(q) };

  const [result] = await GatePass.aggregate([
    { $match: match },
    {
      $project: {
        student: 1,
        passType: 1,
        dayScholarOuting: 1,
        events: [
          { type: 'out', at: '$actualExit', by: '$exitVerifiedBy' },
          { type: 'in', at: '$actualReturn', by: '$returnVerifiedBy' },
        ],
      },
    },
    { $unwind: '$events' },
    { $match: { 'events.type': { $in: types }, 'events.at': ts } },
    { $sort: { 'events.at': -1, _id: -1 } },
    {
      $facet: {
        total: [{ $count: 'n' }],
        items: [
          { $skip: skip },
          { $limit: limit },
          // let + pipeline (not localField + pipeline) so this runs on MongoDB 4.x too.
          { $lookup: { from: 'users', let: { id: '$student' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$id'] } } }, { $project: { name: 1, rollNo: 1, avatar: 1, department: 1, year: 1, section: 1 } }], as: 'student' } },
          { $lookup: { from: 'users', let: { id: '$events.by' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$id'] } } }, { $project: { name: 1 } }], as: 'guard' } },
          {
            $lookup: {
              from: 'gatescanevents',
              let: { pass: '$_id', dir: '$events.type' },
              pipeline: [
                { $match: { $expr: { $and: [{ $eq: ['$gatePass', '$$pass'] }, { $eq: ['$direction', '$$dir'] }, { $eq: ['$outcome', 'success'] }] } } },
                { $project: { gate: 1, source: 1 } },
                { $limit: 1 },
              ],
              as: 'scan',
            },
          },
        ],
      },
    },
  ]);
  const total = result?.total?.[0]?.n || 0;
  res.set('Cache-Control', 'no-store');
  res.json({
    range: { from: dayKey(from), to: dayKey(to), timezone: env.timezone },
    ...pageMeta(total, page, limit),
    items: (result?.items || []).map((r) => ({
      id: `${r._id}:${r.events.type}`,
      type: r.events.type,
      at: r.events.at,
      passRef: passRef(r._id),
      passType: r.dayScholarOuting ? 'outing' : r.passType,
      student: pickStudent(r.student[0]),
      guard: r.guard[0]?.name ? { name: r.guard[0].name } : null,
      gate: r.scan[0]?.gate || null,
      via: r.scan[0] ? 'gate_scanner' : 'web_or_mobile',
    })),
  });
});

/** GET /gate-scanner/attempts — Gate Scanner attempts (successful, rejected, duplicate) for the same ranges. */
export const attempts = asyncHandler(async (req, res) => {
  const { from, to } = historyRange(req.query);
  const { page, limit, skip } = paginate(req, 25, 100);
  const filter = { state: 'done', createdAt: timestampFilter({ from, to }) };
  if (req.query.outcome) filter.outcome = req.query.outcome;
  if (req.query.type) filter.direction = req.query.type;
  const q = String(req.query.q || '').trim();
  if (q) filter.student = { $in: await searchStudents(q) };
  const [total, rows] = await Promise.all([
    GateScanEvent.countDocuments(filter),
    GateScanEvent.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).select('_id').lean(),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ range: { from: dayKey(from), to: dayKey(to), timezone: env.timezone }, ...pageMeta(total, page, limit), items: await Promise.all(rows.map((r) => scanView(r))) });
});
