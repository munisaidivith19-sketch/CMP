import mongoose from 'mongoose';
import ODLeaveRequest, { OD_LEAVE_TYPES, OD_LEAVE_STATUSES } from '../models/ODLeaveRequest.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSession from '../models/AttendanceSession.js';
import User from '../models/User.js';
import { ApiError, asyncHandler, paginate, pageMeta } from '../utils/http.js';
import { notifyUsers } from '../utils/notify.js';
import { emitToUsers, emitToRoles } from '../config/socket.js';
import { announceClassAttendance } from '../services/attendanceLive.js';
import { addDays, campusParts, dayKey, toDay, today } from '../utils/dates.js';
import { clock } from '../utils/clock.js';
import {
  FIRST_YEAR_HOD_DEPT,
  facultyClassInChargeScope,
  isBranchHod,
  isFirstYearHod,
  ownDepartment,
} from '../utils/academicScope.js';

const REVIEWER_POPULATE = 'name rollNo avatar role department section';
const norm = (s) => String(s || '').trim().toUpperCase();

/**
 * The requests a reviewer is responsible for, taken from the account only —
 * never from the request. Faculty: their class (department + section, and the
 * in-charge year when the account stores one; a faculty member with no section
 * keeps the department-wide fallback the gate pass uses). HOD: their own
 * department's 2nd–4th years, or every 1st year for the first-year HOD.
 * Principal / admin: college-wide. Used for the queue AND every review action.
 */
function reviewScope(user) {
  if (user.role === 'faculty') {
    if (!user.department) return null;
    const section = norm(user.section);
    return {
      department: user.department,
      ...(section ? { section } : {}),
      ...(section && user.inChargeYear != null ? { year: Number(user.inChargeYear) } : {}),
    };
  }
  if (user.role === 'hod') {
    if (isFirstYearHod(user)) return { year: 1 };
    if (!user.department) return null;
    return { department: user.department, year: { $ne: 1 } };
  }
  if (['principal', 'admin'].includes(user.role)) return {};
  return null;
}

/** Whether one request falls inside reviewScope(user) (same rules, in memory). */
function inReviewScope(request, user) {
  const scope = reviewScope(user);
  if (!scope) return false;
  if (scope.department && request.department !== scope.department) return false;
  if (scope.section && norm(request.section) !== scope.section) return false;
  if (typeof scope.year === 'number' && request.year !== scope.year) return false;
  if (scope.year?.$ne !== undefined && request.year === scope.year.$ne) return false;
  return true;
}

/** Only the known attachment fields are stored, never whatever else the body carries. */
const pickDocument = (doc) =>
  doc?.url
    ? Object.fromEntries(
        Object.entries({ url: doc.url, name: doc.name, mimeType: doc.mimeType, size: doc.size }).filter(([, v]) => v !== undefined && v !== null && v !== '')
      )
    : undefined;

/**
 * Check the 5:00 PM previous-day cut-off rule.
 * Requests for tomorrow (or future dates) must be submitted before 5:00 PM (17:00 IST)
 * on the calendar day immediately preceding `fromDate`.
 */
export function checkODLeaveCutoff(fromDate, now = clock.now()) {
  const startDay = toDay(fromDate);
  const nowDay = toDay(now);
  const prevDay = addDays(startDay, -1);
  const { time } = campusParts(now);

  // If now is on or after the start day, cut-off is already passed
  if (nowDay.getTime() >= startDay.getTime()) {
    return {
      allowed: false,
      reason: 'Requests must be submitted before 5:00 PM on the day prior to the start date.',
    };
  }

  // If now is exactly the day before the start day, must be before 17:00
  if (nowDay.getTime() === prevDay.getTime()) {
    if (time >= '17:00') {
      return {
        allowed: false,
        reason: 'Requests for tomorrow must be submitted before 5:00 PM on the previous day.',
      };
    }
  }

  // Otherwise, now is 2 or more days before startDay
  return { allowed: true };
}

/**
 * Create a new OD / Leave request (student only).
 */
export const createRequest = asyncHandler(async (req, res) => {
  const { requestType, category, fromDate, toDate, description, document } = req.body;

  if (!OD_LEAVE_TYPES.includes(requestType)) {
    throw new ApiError(422, 'Invalid request type. Must be "od" or "leave".');
  }
  // The request is routed (and scoped) by the student's class, so it must be on file — never guessed.
  if (!req.user.department || !req.user.section || !req.user.year) {
    throw new ApiError(422, 'Your account has no department/year/section on file — ask your Class In-Charge or an admin to set it');
  }

  if (requestType === 'od' && (!document || !document.url)) {
    throw new ApiError(422, 'Supporting document is compulsory to apply for On Duty (OD).');
  }

  if (!category || !String(category).trim()) {
    throw new ApiError(422, 'Category is required.');
  }

  if (!description || String(description).trim().length < 5) {
    throw new ApiError(422, 'Description must be at least 5 characters long.');
  }

  const startDay = toDay(fromDate);
  const endDay = toDay(toDate);

  if (endDay.getTime() < startDay.getTime()) {
    throw new ApiError(422, 'To Date cannot be before From Date.');
  }

  // Check 5:00 PM previous-day deadline
  const cutoff = checkODLeaveCutoff(startDay);
  if (!cutoff.allowed) {
    throw new ApiError(422, cutoff.reason);
  }

  // Max 15 consecutive days
  const diffDays = Math.round((endDay.getTime() - startDay.getTime()) / 86400000) + 1;
  if (diffDays > 15) {
    throw new ApiError(422, 'Requests cannot exceed 15 consecutive days.');
  }

  // Check overlapping active/pending requests
  const overlap = await ODLeaveRequest.findOne({
    student: req.user._id,
    status: { $nin: ['rejected', 'cancelled'] },
    fromDate: { $lte: endDay },
    toDate: { $gte: startDay },
  });

  if (overlap) {
    throw new ApiError(422, 'You already have an active or pending request for overlapping dates.');
  }

  const request = await ODLeaveRequest.create({
    student: req.user._id,
    department: req.user.department,
    section: req.user.section,
    year: req.user.year,
    semester: req.user.semester,
    requestType,
    category: String(category).trim(),
    fromDate: startDay,
    toDate: endDay,
    daysCount: diffDays,
    description: String(description).trim(),
    document: pickDocument(document),
    status: 'pending_faculty',
  });

  // Notify the Class In-Charge — of this year when the account records it.
  try {
    const inChargeFaculty = await User.find({
      role: 'faculty',
      department: req.user.department,
      section: req.user.section,
      inChargeYear: { $in: [req.user.year, null] },
    }).select('_id');

    const facultyIds = inChargeFaculty.map((f) => f._id);
    if (facultyIds.length) {
      await notifyUsers(facultyIds, {
        type: 'attendance',
        title: `New ${requestType.toUpperCase()} Request`,
        message: `${req.user.name} submitted a ${requestType.toUpperCase()} request (${dayKey(startDay)} to ${dayKey(endDay)}).`,
        link: '/attendance?tab=od-leave',
      });
      emitToUsers(facultyIds, 'od_leave:updated', { requestId: String(request._id), status: request.status });
    }
  } catch (err) {
    console.error('[odLeave] notification error:', err.message);
  }

  emitToUsers([req.user._id], 'od_leave:updated', { requestId: String(request._id), status: request.status });

  res.status(201).json(request);
});

/**
 * List the student's own requests.
 */
export const listMyRequests = asyncHandler(async (req, res) => {
  const filter = { student: req.user._id };
  if (req.query.requestType && OD_LEAVE_TYPES.includes(req.query.requestType)) {
    filter.requestType = req.query.requestType;
  }
  if (req.query.status && OD_LEAVE_STATUSES.includes(req.query.status)) {
    filter.status = req.query.status;
  }

  const { page, limit, skip } = paginate(req, 20, 100);
  const [requests, total] = await Promise.all([
    ODLeaveRequest.find(filter)
      .populate('facultyReview.by', REVIEWER_POPULATE)
      .populate('hodReview.by', REVIEWER_POPULATE)
      .populate('principalReview.by', REVIEWER_POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ODLeaveRequest.countDocuments(filter),
  ]);

  res.json({ requests, pagination: pageMeta(total, page, limit) });
});

/**
 * List pending requests for review (Class In-Charge, HOD, Principal, Admin).
 */
export const listPendingReviews = asyncHandler(async (req, res) => {
  const { role } = req.user;
  let filter = {};
  const scope = reviewScope(req.user);

  if (role === 'faculty') {
    filter = scope
      ? { $or: [{ 'facultyReview.by': req.user._id }, { status: 'pending_faculty', ...scope }] }
      : { 'facultyReview.by': req.user._id };
  } else if (role === 'hod') {
    filter = scope
      ? { $or: [{ 'hodReview.by': req.user._id }, { status: 'pending_hod', ...scope }] }
      : { 'hodReview.by': req.user._id };
  } else if (role === 'principal' || role === 'admin') {
    filter = {
      $or: [
        { 'principalReview.by': req.user._id },
        { status: 'pending_principal' },
        { status: 'approved' },
      ],
    };
  } else {
    throw new ApiError(403, 'Not authorized to review OD / Leave requests.');
  }

  if (req.query.status && OD_LEAVE_STATUSES.includes(req.query.status)) {
    filter = { $and: [filter, { status: req.query.status }] };
  }
  if (req.query.requestType && OD_LEAVE_TYPES.includes(req.query.requestType)) {
    filter = { $and: [filter, { requestType: req.query.requestType }] };
  }

  const { page, limit, skip } = paginate(req, 25, 100);
  const [requests, total] = await Promise.all([
    ODLeaveRequest.find(filter)
      .populate('student', REVIEWER_POPULATE)
      .populate('facultyReview.by', REVIEWER_POPULATE)
      .populate('hodReview.by', REVIEWER_POPULATE)
      .populate('principalReview.by', REVIEWER_POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ODLeaveRequest.countDocuments(filter),
  ]);

  res.json({ requests, pagination: pageMeta(total, page, limit) });
});

/**
 * Apply approved OD or Leave status to attendance records.
 */
export async function applyApprovedODLeaveAttendance(request, user) {
  const { student, fromDate, toDate, requestType } = request;
  const startDay = toDay(fromDate);
  const endDay = toDay(toDate);

  const studentDoc = await User.findById(student).select('department section year semester').lean();
  if (!studentDoc) return;

  let curr = new Date(startDay);
  while (curr.getTime() <= endDay.getTime()) {
    const day = new Date(curr);

    // Find all attendance sessions held or scheduled for this student's class on this day
    const sessions = await AttendanceSession.find({
      department: studentDoc.department,
      section: studentDoc.section,
      year: studentDoc.year,
      date: day,
    }).lean();

    for (const sess of sessions) {
      const existing = await AttendanceRecord.findOne({
        student,
        subject: sess.subject,
        date: day,
        period: sess.period,
      });

      if (requestType === 'od') {
        if (existing) {
          if (existing.status !== 'od') {
            existing.history.push({
              from: existing.status,
              to: 'od',
              by: user._id,
              at: new Date(),
              reason: 'Approved On-Duty Request',
            });
            existing.status = 'od';
            existing.odLeaveRequest = request._id;
            await existing.save();
          }
        } else {
          await AttendanceRecord.create({
            student,
            subject: sess.subject,
            date: day,
            period: sess.period,
            status: 'od',
            department: sess.department,
            section: sess.section,
            session: sess._id,
            odLeaveRequest: request._id,
            markedBy: user._id,
            markedAt: new Date(),
          });
        }
      } else if (requestType === 'leave') {
        if (existing) {
          if (existing.status !== 'absent') {
            existing.history.push({
              from: existing.status,
              to: 'absent',
              by: user._id,
              at: new Date(),
              reason: 'Approved Leave Request',
            });
            existing.status = 'absent';
            existing.odLeaveRequest = request._id;
            await existing.save();
          }
        } else {
          await AttendanceRecord.create({
            student,
            subject: sess.subject,
            date: day,
            period: sess.period,
            status: 'absent',
            department: sess.department,
            section: sess.section,
            session: sess._id,
            odLeaveRequest: request._id,
            markedBy: user._id,
            markedAt: new Date(),
          });
        }
      }
    }

    curr = addDays(curr, 1);
  }

  request.attendanceApplied = true;
  await request.save();
  emitToUsers([student], 'attendance:updated', { date: dayKey(startDay) });
  announceClassAttendance({ ...studentDoc, day: startDay }, user._id);
}

/**
 * Revert approved OD attendance records back to absent (when cancelled by student).
 */
export async function revertApprovedODLeaveAttendance(request, user) {
  const { student, fromDate, toDate } = request;
  const startDay = toDay(fromDate);
  const endDay = toDay(toDate);

  // Find all attendance records associated with this request or dated within range for this student
  const records = await AttendanceRecord.find({
    student,
    $or: [
      { odLeaveRequest: request._id },
      { date: { $gte: startDay, $lte: endDay }, status: 'od' },
    ],
  });

  for (const rec of records) {
    rec.history.push({
      from: rec.status,
      to: 'absent',
      by: user._id,
      at: new Date(),
      reason: 'Student cancelled approved On-Duty request',
    });
    rec.status = 'absent';
    rec.odLeaveRequest = undefined;
    await rec.save();
  }

  request.attendanceApplied = false;
  await request.save();

  emitToUsers([student], 'attendance:updated', { date: dayKey(startDay) });
  const studentDoc = await User.findById(student).select('department year section semester').lean();
  if (studentDoc) announceClassAttendance({ ...studentDoc, day: startDay }, user._id);
}

/**
 * Review a stage: forward, approve, or reject.
 */
export const reviewStage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body;
  const { role } = req.user;

  const request = await ODLeaveRequest.findById(id);
  if (!request) throw new ApiError(404, 'Request not found');

  // Object-level check first: a reviewer acts only on their own students' requests.
  if (!inReviewScope(request, req.user)) {
    throw new ApiError(403, 'This request is outside your review scope.');
  }

  if (['approved', 'rejected', 'cancelled'].includes(request.status)) {
    throw new ApiError(422, `This request is already ${request.status}.`);
  }

  if (action === 'reject' && (!reason || String(reason).trim().length < 3)) {
    throw new ApiError(422, 'A rejection reason is required (at least 3 characters).');
  }

  const now = new Date();
  const trimmedReason = reason ? String(reason).trim() : '';

  if (role === 'faculty') {
    if (request.status !== 'pending_faculty') {
      throw new ApiError(422, 'This request is no longer waiting for Class In-Charge review.');
    }
    if (action === 'forward') {
      request.status = 'pending_hod';
      request.facultyReview = { by: req.user._id, at: now, action: 'forwarded', reason: trimmedReason };

      // Notify HOD
      try {
        const isFirstYear = request.year === 1;
        const hodFilter = isFirstYear ? { role: 'hod', department: FIRST_YEAR_HOD_DEPT } : { role: 'hod', department: request.department };
        const hod = await User.findOne(hodFilter).select('_id');
        if (hod) {
          await notifyUsers([hod._id], {
            type: 'attendance',
            title: `OD/Leave Request Needs HOD Review`,
            message: `Forwarded by Class In-Charge for ${request.department} - Year ${request.year}.`,
            link: '/attendance?tab=od-leave',
          });
        }
      } catch (err) {
        console.error('[odLeave] HOD notify error:', err.message);
      }
    } else if (action === 'reject') {
      request.status = 'rejected';
      request.rejectedStage = 'faculty';
      request.rejectedReason = trimmedReason;
      request.facultyReview = { by: req.user._id, at: now, action: 'rejected', reason: trimmedReason };

      await notifyUsers([request.student], {
        type: 'attendance',
        title: `OD/Leave Request Rejected`,
        message: `Your request was rejected by Class In-Charge: "${trimmedReason}"`,
        link: '/attendance?tab=od-leave',
      });
    } else {
      throw new ApiError(422, 'Invalid action for faculty. Must be "forward" or "reject".');
    }
  } else if (role === 'hod') {
    if (request.status !== 'pending_hod') {
      throw new ApiError(422, 'This request is no longer waiting for HOD review.');
    }
    if (action === 'forward') {
      request.status = 'pending_principal';
      request.hodReview = { by: req.user._id, at: now, action: 'forwarded', reason: trimmedReason };

      // Notify Principal
      try {
        const principals = await User.find({ role: 'principal' }).select('_id');
        if (principals.length) {
          await notifyUsers(principals.map((p) => p._id), {
            type: 'attendance',
            title: `OD/Leave Request Needs Principal Approval`,
            message: `Forwarded by HOD (${request.department}).`,
            link: '/attendance?tab=od-leave',
          });
        }
      } catch (err) {
        console.error('[odLeave] Principal notify error:', err.message);
      }
    } else if (action === 'reject') {
      request.status = 'rejected';
      request.rejectedStage = 'hod';
      request.rejectedReason = trimmedReason;
      request.hodReview = { by: req.user._id, at: now, action: 'rejected', reason: trimmedReason };

      await notifyUsers([request.student], {
        type: 'attendance',
        title: `OD/Leave Request Rejected`,
        message: `Your request was rejected by HOD: "${trimmedReason}"`,
        link: '/attendance?tab=od-leave',
      });
    } else {
      throw new ApiError(422, 'Invalid action for HOD. Must be "forward" or "reject".');
    }
  } else if (role === 'principal' || role === 'admin') {
    if (request.status !== 'pending_principal' && role !== 'admin') {
      throw new ApiError(422, 'This request is no longer waiting for Principal approval.');
    }
    if (action === 'approve') {
      request.status = 'approved';
      request.principalReview = { by: req.user._id, at: now, action: 'approved', reason: trimmedReason };

      // Apply attendance immediately
      await applyApprovedODLeaveAttendance(request, req.user);

      await notifyUsers([request.student], {
        type: 'attendance',
        title: `OD/Leave Request Approved!`,
        message: `Your ${request.requestType.toUpperCase()} request from ${dayKey(request.fromDate)} to ${dayKey(request.toDate)} was approved by the Principal.`,
        link: '/attendance?tab=od-leave',
      });
    } else if (action === 'reject') {
      request.status = 'rejected';
      request.rejectedStage = 'principal';
      request.rejectedReason = trimmedReason;
      request.principalReview = { by: req.user._id, at: now, action: 'rejected', reason: trimmedReason };

      await notifyUsers([request.student], {
        type: 'attendance',
        title: `OD/Leave Request Rejected`,
        message: `Your request was rejected by Principal: "${trimmedReason}"`,
        link: '/attendance?tab=od-leave',
      });
    } else {
      throw new ApiError(422, 'Invalid action for Principal. Must be "approve" or "reject".');
    }
  } else {
    throw new ApiError(403, 'Not authorized to review this request.');
  }

  await request.save();

  const populated = await ODLeaveRequest.findById(request._id)
    .populate('student', REVIEWER_POPULATE)
    .populate('facultyReview.by', REVIEWER_POPULATE)
    .populate('hodReview.by', REVIEWER_POPULATE)
    .populate('principalReview.by', REVIEWER_POPULATE)
    .lean();

  const audienceIds = [request.student];
  if (request.facultyReview?.by) audienceIds.push(request.facultyReview.by);
  if (request.hodReview?.by) audienceIds.push(request.hodReview.by);
  if (request.principalReview?.by) audienceIds.push(request.principalReview.by);

  emitToUsers(audienceIds, 'od_leave:updated', { requestId: String(request._id), status: request.status });
  emitToRoles(['principal', 'admin'], 'od_leave:updated', { requestId: String(request._id), status: request.status });

  res.json(populated);
});

/**
 * Cancel a request (student only).
 * OD requests can be cancelled at any time (even after approved).
 * Leave requests can only be cancelled while pending.
 */
export const cancelRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const request = await ODLeaveRequest.findById(id);
  if (!request) throw new ApiError(404, 'Request not found');

  if (String(request.student) !== String(req.user._id)) {
    throw new ApiError(403, 'You can only cancel your own request.');
  }

  if (['rejected', 'cancelled'].includes(request.status)) {
    throw new ApiError(422, `This request is already ${request.status}.`);
  }

  // Approved Leave requests cannot be cancelled; only OD requests can be cancelled after approval
  if (request.requestType === 'leave' && request.status === 'approved') {
    throw new ApiError(422, 'Approved Leave requests cannot be cancelled.');
  }

  const wasApproved = request.status === 'approved';

  // If approved OD request is cancelled, revert attendance records back to absent
  if (request.requestType === 'od' && wasApproved) {
    await revertApprovedODLeaveAttendance(request, req.user);
  }

  request.status = 'cancelled';
  request.cancelledAt = new Date();
  await request.save();

  let staffToNotify = [];
  try {
    const isFirstYear = request.year === 1;
    const hodFilter = isFirstYear
      ? { role: 'hod', department: FIRST_YEAR_HOD_DEPT }
      : { role: 'hod', department: request.department };

    const [inChargeFaculty, hodUser, principals] = await Promise.all([
      User.find({ role: 'faculty', department: request.department, section: request.section }).select('_id').lean(),
      User.findOne(hodFilter).select('_id').lean(),
      User.find({ role: 'principal' }).select('_id').lean(),
    ]);

    const ids = [
      ...inChargeFaculty.map((f) => f._id),
      ...(hodUser ? [hodUser._id] : []),
      ...principals.map((p) => p._id),
      ...(request.facultyReview?.by ? [request.facultyReview.by] : []),
      ...(request.hodReview?.by ? [request.hodReview.by] : []),
      ...(request.principalReview?.by ? [request.principalReview.by] : []),
    ];

    staffToNotify = [...new Set(ids.map((id) => String(id)))];

    if (request.requestType === 'od' && staffToNotify.length) {
      const statusDesc = wasApproved ? 'approved' : 'pending';
      await notifyUsers(staffToNotify, {
        type: 'attendance',
        title: `OD Request Cancelled by Student`,
        message: `${req.user.name} (${req.user.rollNo || req.user.department}) cancelled their ${statusDesc} On Duty (OD) request (${dayKey(request.fromDate)} to ${dayKey(request.toDate)}).`,
        link: '/attendance?tab=od-leave',
      });
    }
  } catch (err) {
    console.error('[odLeave] cancel notify error:', err.message);
  }

  const audienceIds = [...new Set([String(req.user._id), ...staffToNotify])];

  emitToUsers(audienceIds, 'od_leave:updated', { requestId: String(request._id), status: 'cancelled' });
  emitToRoles(['principal', 'admin'], 'od_leave:updated', { requestId: String(request._id), status: 'cancelled' });

  res.json({ message: 'Request cancelled successfully', request });
});

