import User from '../models/User.js';
import GatePass from '../models/GatePass.js';
import { asyncHandler, escapeRegex } from '../utils/http.js';

/**
 * Hostel dashboard: how many hostellers there are, how many are inside the
 * campus and who is outside right now (boys / girls / everyone).
 *
 * "Outside" is read from the gate-pass records only: a pass whose exit was
 * recorded at the gate and whose return has not been recorded yet. A day
 * scholar's Outing is never "outside" (and day scholars are not hostellers).
 */
const STUDENT_ROLES = ['student', 'club_admin'];
const hostellerFilter = (gender) => ({
  role: { $in: STUDENT_ROLES },
  isActive: true,
  stayType: 'hosteler',
  ...(gender ? { gender } : {}),
});
const OUTSIDE_PASS = { status: 'active', actualExit: { $ne: null }, dayScholarOuting: { $ne: true } };

const LIST_FIELDS = 'name title gender rollNo department year section';
const OUTSIDE_FIELDS = `${LIST_FIELDS} phone`;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/** Student ids that are outside campus right now. */
const outsideStudentIds = () => GatePass.distinct('student', OUTSIDE_PASS);

export const summary = asyncHandler(async (_req, res) => {
  const outside = await outsideStudentIds();
  const count = async (gender) => {
    const base = hostellerFilter(gender);
    const [total, out] = await Promise.all([
      User.countDocuments(base),
      User.countDocuments({ ...base, _id: { $in: outside } }),
    ]);
    return { total, inside: total - out, outside: out };
  };
  const [all, boys, girls] = await Promise.all([count(), count('male'), count('female')]);
  res.json({ ...all, boys, girls });
});

/**
 * Hostellers for one card. `status`: all | inside | outside; `gender`: male |
 * female (absent = everyone); `q` searches name or roll number. Without a
 * search the first names are listed by default.
 */
export const listStudents = asyncHandler(async (req, res) => {
  const { gender, status = 'all' } = req.query;
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);

  const filter = hostellerFilter(gender);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { rollNo: rx }];
  }

  if (status === 'outside') {
    // Who is outside, with when they left and when they are due back.
    const passes = await GatePass.find(OUTSIDE_PASS).select('student actualExit toDate').sort({ actualExit: -1 }).lean();
    const passOf = new Map(passes.map((p) => [String(p.student), p]));
    filter._id = { $in: [...passOf.keys()] };
    const [students, total] = await Promise.all([
      User.find(filter).select(OUTSIDE_FIELDS).sort({ name: 1 }).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    const rows = students.map((s) => {
      const p = passOf.get(String(s._id));
      return { ...s, leftAt: p?.actualExit || null, returnBy: p?.toDate || null, gatePassId: p?._id };
    });
    rows.sort((a, b) => new Date(b.leftAt) - new Date(a.leftAt));
    return res.json({ status, total, students: rows });
  }

  if (status === 'inside') filter._id = { $nin: await outsideStudentIds() };
  const [students, total] = await Promise.all([
    User.find(filter).select(LIST_FIELDS).sort({ name: 1 }).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  res.json({ status, total, students });
});
