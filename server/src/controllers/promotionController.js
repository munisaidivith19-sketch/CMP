import User from '../models/User.js';
import GatePass from '../models/GatePass.js';
import PromotionBatch from '../models/PromotionBatch.js';
import { yearOfSemester } from '../constants.js';
import { ApiError, asyncHandler, pageMeta, paginate } from '../utils/http.js';
import { logAudit } from '../utils/auditLog.js';
import { revokeSessions } from './authController.js';

const PROMOTABLE_ROLES = ['student', 'club_admin'];
const FINAL_SEMESTER = 8;
const RECENT_DAYS = 30;
const PREVIEW_ROWS = 2000;
const CHANGED_OUTCOMES = ['promoted', 'moved', 'graduated'];

/** The students a scope covers. Never matches a graduate: their role is no longer a student role. */
function scopeFilter({ kind, department, year, section, rollNos } = {}) {
  const filter = { role: { $in: PROMOTABLE_ROLES } };
  if (kind === 'college') return filter;
  if (kind === 'student') {
    const rolls = (rollNos || []).map((r) => String(r).trim()).filter(Boolean);
    if (!rolls.length) throw new ApiError(422, 'Enter at least one roll number');
    return { ...filter, rollNo: { $in: [...new Set([...rolls, ...rolls.map((r) => r.toUpperCase())])] } };
  }
  if (kind === 'department' || kind === 'section') {
    if (!department) throw new ApiError(422, 'Choose a department');
    filter.department = department;
  } else if (department) filter.department = department;
  if (kind === 'year' || kind === 'section') {
    if (!year) throw new ApiError(422, 'Choose a year');
    filter.year = Number(year);
  }
  if (kind === 'section') {
    if (!section) throw new ApiError(422, 'Choose a section');
    filter.section = String(section).toUpperCase();
  }
  return filter;
}

const placement = (s) => ({ role: s.role, year: s.year, section: s.section, semester: s.semester });

/** What happens to each covered student. Writes nothing. */
async function buildPlan({ scope, holdBack = [], moves = [] }) {
  const students = await User.find(scopeFilter(scope))
    .select('name rollNo role department year section semester isActive')
    .sort({ department: 1, year: 1, section: 1, rollNo: 1 })
    .lean();
  const ids = students.map((s) => s._id);
  const outside = new Set((await GatePass.find({ student: { $in: ids }, status: 'active' }).distinct('student')).map(String));
  const held = new Set(holdBack.map(String));
  const moved = new Map(moves.map((m) => [String(m.student), Number(m.semester)]));
  const counts = { promoted: 0, moved: 0, graduated: 0, heldBack: 0, skipped: 0 };

  const items = students.map((s) => {
    const id = String(s._id);
    const base = { student: s._id, name: s.name, rollNo: s.rollNo, department: s.department, from: placement(s) };
    const skip = (reason) => {
      counts.skipped += 1;
      return { ...base, outcome: 'skipped', reason };
    };
    if (!s.isActive) return skip('inactive');
    if (!s.semester) return skip('no_semester');
    if (outside.has(id)) return skip('on_gate_pass');
    const target = moved.get(id);
    if (held.has(id) || target === s.semester) {
      counts.heldBack += 1;
      return { ...base, outcome: 'held_back' };
    }
    if (target) {
      counts.moved += 1;
      return { ...base, outcome: 'moved', to: { role: s.role, year: yearOfSemester(target), section: s.section, semester: target } };
    }
    if (s.semester >= FINAL_SEMESTER) {
      counts.graduated += 1;
      return { ...base, outcome: 'graduated', to: { role: 'alumni' } };
    }
    counts.promoted += 1;
    const next = s.semester + 1;
    return { ...base, outcome: 'promoted', to: { role: s.role, year: yearOfSemester(next), section: s.section, semester: next } };
  });
  return { items, counts };
}

/** Students changed by a promotion in the last 30 days: most likely a repeat by mistake. */
async function recentlyPromoted(items) {
  const ids = items.filter((i) => CHANGED_OUTCOMES.includes(i.outcome)).map((i) => i.student);
  if (!ids.length) return 0;
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const batches = await PromotionBatch.find({ status: 'applied', createdAt: { $gte: since }, 'items.student': { $in: ids } }).select('items.student items.outcome').lean();
  const wanted = new Set(ids.map(String));
  const hit = new Set();
  for (const b of batches) {
    for (const i of b.items) if (CHANGED_OUTCOMES.includes(i.outcome) && wanted.has(String(i.student))) hit.add(String(i.student));
  }
  return hit.size;
}

/** Class In-Charges whose class is moving: their assignment is not changed for them. */
async function affectedInCharges(items) {
  const classes = new Map();
  for (const i of items) {
    if (CHANGED_OUTCOMES.includes(i.outcome) && i.from.section) {
      const key = `${i.department}|${i.from.section}|${i.from.semester}`;
      classes.set(key, { department: i.department, section: i.from.section, inChargeSemester: i.from.semester });
    }
  }
  if (!classes.size) return [];
  const faculty = await User.find({ role: 'faculty', isActive: true, $or: [...classes.values()] })
    .select('name department section inChargeYear inChargeSemester')
    .sort({ department: 1, section: 1 })
    .lean();
  return faculty.map((f) => ({ id: f._id, name: f.name, department: f.department, section: f.section, inChargeYear: f.inChargeYear, inChargeSemester: f.inChargeSemester }));
}

async function requirePassword(req) {
  const me = await User.findById(req.user._id).select('+password');
  if (!me || !(await me.comparePassword(String(req.body.password || '')))) {
    // 403, not 401: a mistyped password here must not look like an expired session.
    throw new ApiError(403, 'That password is not correct', undefined, { code: 'PASSWORD_INCORRECT' });
  }
}

const summary = (b) => ({
  id: b._id,
  scope: b.scope,
  status: b.status,
  counts: b.counts,
  createdAt: b.createdAt,
  createdBy: b.createdBy,
  undoneAt: b.undoneAt,
  undoneBy: b.undoneBy,
  undoResult: b.undoResult,
});

export const previewPromotion = asyncHandler(async (req, res) => {
  const { items, counts } = await buildPlan(req.body);
  const [recent, classInCharges] = await Promise.all([recentlyPromoted(items), affectedInCharges(items)]);
  res.json({ total: items.length, counts, recentlyPromoted: recent, classInCharges, rows: items.slice(0, PREVIEW_ROWS), truncated: items.length > PREVIEW_ROWS });
});

export const applyPromotion = asyncHandler(async (req, res) => {
  await requirePassword(req);
  const { items, counts } = await buildPlan(req.body);
  const changes = items.filter((i) => CHANGED_OUTCOMES.includes(i.outcome));
  if (!changes.length) throw new ApiError(422, 'There is no student to promote in this selection');
  const recent = await recentlyPromoted(items);
  if (recent && req.body.acknowledgeRecent !== true) {
    throw new ApiError(409, `${recent} of these students were promoted in the last ${RECENT_DAYS} days`, undefined, { code: 'RECENTLY_PROMOTED', recentlyPromoted: recent });
  }

  const { scope } = req.body;
  // Recorded first: whatever happens next, the change can be seen and undone.
  const batch = await PromotionBatch.create({
    createdBy: req.user._id,
    scope: { kind: scope.kind, department: scope.department, year: scope.year, section: scope.section, rollNos: scope.rollNos },
    counts,
    items,
  });

  const graduatedAt = new Date();
  const result = await User.bulkWrite(
    changes.map((i) => ({
      updateOne: {
        // Only if the student is still where the plan found them.
        filter: { _id: i.student, role: i.from.role, semester: i.from.semester },
        update:
          i.outcome === 'graduated'
            ? { $set: { role: 'alumni', graduatedAt }, $unset: { year: 1, section: 1, semester: 1 } }
            : { $set: { year: i.to.year, semester: i.to.semester } },
      },
    })),
    { ordered: false }
  );

  // Someone edited a student at the same moment: record what really happened.
  if (result.modifiedCount !== changes.length) {
    const now = await User.find({ _id: { $in: changes.map((i) => i.student) } }).select('role semester').lean();
    const current = new Map(now.map((u) => [String(u._id), u]));
    for (const i of batch.items) {
      if (!CHANGED_OUTCOMES.includes(i.outcome)) continue;
      const u = current.get(String(i.student));
      const applied = u && u.role === i.to.role && (i.outcome === 'graduated' ? u.semester == null : u.semester === i.to.semester);
      if (applied) continue;
      batch.counts[i.outcome] -= 1;
      batch.counts.skipped += 1;
      i.outcome = 'skipped';
      i.reason = 'changed_meanwhile';
      i.to = undefined;
    }
    await batch.save();
  }

  // A graduate's role changed: they sign in again as an alumnus.
  const graduates = batch.items.filter((i) => i.outcome === 'graduated').map((i) => i.student);
  if (graduates.length) await revokeSessions({ user: { $in: graduates } }, 'graduated');

  await logAudit(req, 'STUDENTS_PROMOTED', { details: { batch: String(batch._id), scope: batch.scope, counts: batch.counts } });
  res.status(201).json(summary(batch));
});

export const listPromotions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req);
  const [rows, total] = await Promise.all([
    PromotionBatch.find().select('-items').sort({ createdAt: -1 }).skip(skip).limit(limit).populate('createdBy undoneBy', 'name title').lean(),
    PromotionBatch.countDocuments(),
  ]);
  res.json({ items: rows.map(summary), ...pageMeta(total, page, limit) });
});

export const getPromotion = asyncHandler(async (req, res) => {
  const b = await PromotionBatch.findById(req.params.id).populate('createdBy undoneBy', 'name title').lean();
  if (!b) throw new ApiError(404, 'Promotion not found');
  res.json({ ...summary(b), items: b.items });
});

/**
 * Put back everyone this promotion changed. A student who has changed since (a
 * later promotion, an Admin's edit) is left alone and counted as not restored.
 */
export const undoPromotion = asyncHandler(async (req, res) => {
  await requirePassword(req);
  const claimed = await PromotionBatch.findOneAndUpdate({ _id: req.params.id, status: 'applied' }, { $set: { status: 'undoing' } }, { returnDocument: 'after' });
  if (!claimed) {
    if (!(await PromotionBatch.exists({ _id: req.params.id }))) throw new ApiError(404, 'Promotion not found');
    throw new ApiError(409, 'This promotion has already been undone');
  }

  const changed = claimed.items.filter((i) => CHANGED_OUTCOMES.includes(i.outcome));
  const restore = (from) => {
    const $set = { role: from.role };
    const $unset = { graduatedAt: 1 };
    for (const key of ['year', 'section', 'semester']) {
      if (from[key] == null) $unset[key] = 1;
      else $set[key] = from[key];
    }
    return { $set, $unset };
  };
  const result = changed.length
    ? await User.bulkWrite(
        changed.map((i) => ({
          updateOne: {
            filter: i.outcome === 'graduated' ? { _id: i.student, role: 'alumni', semester: null } : { _id: i.student, role: i.to.role, semester: i.to.semester },
            update: restore(i.from),
          },
        })),
        { ordered: false }
      )
    : { modifiedCount: 0 };

  const restored = result.modifiedCount;
  const notRestored = changed.length - restored;
  claimed.status = 'undone';
  claimed.undoneBy = req.user._id;
  claimed.undoneAt = new Date();
  claimed.undoResult = { restored, notRestored };
  await claimed.save();

  // A restored graduate is a student again: they sign in again with that role.
  const graduates = claimed.items.filter((i) => i.outcome === 'graduated').map((i) => i.student);
  if (graduates.length) await revokeSessions({ user: { $in: graduates } }, 'graduation_undone');

  await logAudit(req, 'PROMOTION_UNDONE', { details: { batch: String(claimed._id), restored, notRestored } });
  res.json(summary(claimed));
});
