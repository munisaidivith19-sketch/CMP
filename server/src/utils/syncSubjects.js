import Subject from '../models/Subject.js';
import { timetableSubjects } from '../data/timetableData.js';

/**
 * Create any catalogue subject (data/timetableData.js) that isn't in the
 * database yet, so the timetable always has real Subject records to pick from.
 * Insert-only: an existing subject with the same code + department + semester
 * — active or retired — is left untouched, so edits and retirements made in
 * Academics → Subjects are never undone by a restart.
 */
export async function syncSubjects() {
  const wanted = timetableSubjects.flatMap(({ department, year, semester, subjects }) =>
    subjects.map((s) => ({
      name: s.name,
      code: String(s.code).trim().toUpperCase(),
      department,
      semester,
      year,
      type: s.type || 'theory',
      credits: s.credits ?? 3,
    }))
  );
  if (!wanted.length) return 0;

  const existing = await Subject.find({ department: { $in: [...new Set(wanted.map((w) => w.department))] } })
    .select('code department semester')
    .lean();
  const key = (s) => `${s.department}|${s.semester}|${s.code}`;
  const have = new Set(existing.map(key));
  const missing = wanted.filter((w) => !have.has(key(w)));
  if (missing.length) await Subject.insertMany(missing, { ordered: false });
  return missing.length;
}
