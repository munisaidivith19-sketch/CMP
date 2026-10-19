/**
 * Automatic Present for exam-blocked regular periods.
 *
 * When a published exam blocks some of a class's regular periods, the first
 * regular period after the exam is its "post-exam period". Marking a student
 * PRESENT in that period marks THAT student's blocked periods of the same
 * exam Present too:
 *
 * - per student, never per section, and never just because an exam exists;
 * - a student marked Absent (or anything but Present) there gets nothing;
 * - an existing record for a blocked period is never overwritten — it is
 *   kept and reported as a conflict for review;
 * - records are tagged source AUTO_EXAM_PERIOD_PRESENT with the exam, the
 *   trigger session / period and the marking actor (markedBy), and nothing
 *   is ever written as exam attendance;
 * - repeating the request changes nothing (upserts with $setOnInsert, and an
 *   already-applied record is recognised); if the trigger is later corrected
 *   to Absent, the untouched automatic records of that exam are withdrawn.
 *
 * prepareExamAuto runs before the transaction (it snapshots the blocked
 * periods, which is idempotent); applyExamAuto runs inside the same
 * transaction as the trigger period's own records.
 */
import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSession from '../models/AttendanceSession.js';
import { sameId } from '../utils/permissions.js';
import { classOfSlot, examBrief, examPlan } from './exams.js';
import { ensureSession } from './attendanceSessions.js';

export const AUTO_EXAM_SOURCE = 'AUTO_EXAM_PERIOD_PRESENT';

/**
 * If the class meeting being marked is the first post-exam period of a
 * published exam for its class on `day`, return that exam and the blocked
 * periods (each with its session snapshot); otherwise null.
 */
export async function prepareExamAuto({ slot, session, day }, user) {
  if (!slot) return null;
  const plan = await examPlan(classOfSlot(session || slot), day);
  const entry = plan.find((p) => p.post && sameId(p.post._id, slot._id));
  if (!entry) return null;

  const blocked = [];
  for (const s of entry.blocked) {
    if (!s.subject?._id) continue; // a retired subject has nothing to record against
    const existing = await AttendanceSession.findOne({ timetableSlot: s._id, date: day }).lean();
    const snap = await ensureSession({ slot: s, session: existing, subject: s.subject, day }, user);
    blocked.push({
      slot: s,
      session: snap,
      subject: s.subject._id,
      subjectCode: snap?.subjectCode || s.subject.code,
      period: snap?.period ?? s.period,
      startTime: snap?.startTime || s.startTime,
      endTime: snap?.endTime || s.endTime,
    });
  }
  return blocked.length ? { exam: entry.exam, blocked } : null;
}

/**
 * Apply the automatic marks for the students of one trigger submission.
 * `statuses` maps student id → the status actually stored in the trigger
 * period. All writes use `txn` when given.
 */
export async function applyExamAuto(plan, { statuses, user, day, triggerSession, triggerPeriod, txn }) {
  const ids = [...statuses.keys()];
  const keyOf = (student, subject, period) => `${student}|${subject}|${period}`;
  const existing = await AttendanceRecord.find({
    student: { $in: ids },
    date: day,
    $or: plan.blocked.map((b) => ({ subject: b.subject, period: b.period })),
  })
    .select('student subject period status source exam history')
    .session(txn || null)
    .lean();
  const byKey = new Map(existing.map((r) => [keyOf(r.student, r.subject, r.period), r]));

  const now = new Date();
  const ops = [];
  const conflicts = [];
  const updatedStudents = new Set();
  let alreadyApplied = 0;
  let reverted = 0;

  for (const id of ids) {
    const present = statuses.get(id) === 'present';
    for (const b of plan.blocked) {
      const rec = byKey.get(keyOf(id, b.subject, b.period));
      const ours = rec && rec.source === AUTO_EXAM_SOURCE && sameId(rec.exam, plan.exam._id);
      if (present) {
        if (!rec) {
          updatedStudents.add(id);
          ops.push({
            updateOne: {
              filter: { student: id, subject: b.subject, date: day, period: b.period },
              // $setOnInsert only: a record that appeared meanwhile is never touched.
              update: {
                $setOnInsert: {
                  student: id,
                  subject: b.subject,
                  date: day,
                  period: b.period,
                  status: 'present',
                  department: b.slot.department,
                  section: b.slot.section,
                  ...(b.session ? { session: b.session._id } : {}),
                  source: AUTO_EXAM_SOURCE,
                  exam: plan.exam._id,
                  triggerSession: triggerSession || undefined,
                  triggerPeriod,
                  markedBy: user._id,
                  markedAt: now,
                },
              },
              upsert: true,
            },
          });
        } else if (ours && rec.status === 'present') {
          alreadyApplied += 1;
        } else {
          // Preserve whatever is recorded and report it for review.
          conflicts.push({ student: id, period: b.period, subjectCode: b.subjectCode, status: rec.status, source: rec.source || 'manual' });
        }
      } else if (ours && rec.status === 'present' && !(rec.history || []).length) {
        // The trigger is no longer Present: withdraw only our own, untouched marks.
        reverted += 1;
        ops.push({ deleteOne: { filter: { _id: rec._id, source: AUTO_EXAM_SOURCE, exam: plan.exam._id, status: 'present', 'history.0': { $exists: false } } } });
      }
    }
  }

  let recordsCreated = 0;
  if (ops.length) {
    const result = await AttendanceRecord.bulkWrite(ops, { ordered: true, session: txn || undefined });
    recordsCreated = result.upsertedCount || 0;
    reverted = result.deletedCount || 0;
  }

  return {
    exam: examBrief(plan.exam),
    triggerPeriod,
    periods: plan.blocked.map((b) => ({ period: b.period, startTime: b.startTime, endTime: b.endTime, subjectCode: b.subjectCode })),
    studentsUpdated: updatedStudents.size,
    // Ids only (the marking faculty already has the class roster).
    updatedStudentIds: [...updatedStudents],
    recordsCreated,
    alreadyApplied,
    reverted,
    conflicts,
  };
}
