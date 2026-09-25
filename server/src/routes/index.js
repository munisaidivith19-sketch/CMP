import { Router } from 'express';
import { body, query, param } from 'express-validator';
import { protect, authorize } from '../middleware/auth.js';
import { idParam, validate } from '../middleware/validate.js';
import { authLimiter, passwordResetLimiter, passwordResetSubmitLimiter, uploadLimiter, verifyLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { realtimeChanges } from '../middleware/realtime.js';
import { upload } from '../utils/storage.js';
import {
  ANNOUNCEMENT_PRIORITIES,
  AUDIENCE_SCOPES,
  CLUB_CATEGORIES,
  DISCUSSION_CATEGORIES,
  EVENT_CATEGORIES,
  REPORT_ACTIONS,
  REPORT_REASONS,
  REPORT_TARGETS,
  ROLES,
  GATE_PASS_REGARDING,
  LOST_FOUND_TYPES,
  LOST_FOUND_CATEGORIES,
  LOST_FOUND_STATUSES,
  WEEKDAYS,
  ATTENDANCE_STATUSES,
  CONVERSATION_TYPES,
  STAY_TYPES,
  STAFF_ROLES,
  NO_DEPARTMENT_ROLES,
} from '../constants.js';

import * as auth from '../controllers/authController.js';
import * as users from '../controllers/userController.js';
import * as clubs from '../controllers/clubController.js';
import * as events from '../controllers/eventController.js';
import * as ann from '../controllers/announcementController.js';
import * as disc from '../controllers/discussionController.js';
import * as reports from '../controllers/reportController.js';
import * as notes from '../controllers/notificationController.js';
import * as admin from '../controllers/adminController.js';
import * as chat from '../controllers/chatController.js';
import * as attendance from '../controllers/attendanceController.js';
import * as staffAttendance from '../controllers/staffAttendanceController.js';
import * as timetable from '../controllers/timetableController.js';
import * as gatePass from '../controllers/gatePassController.js';
import * as lostFound from '../controllers/lostFoundController.js';
import * as analytics from '../controllers/analyticsController.js';
import { globalSearch } from '../controllers/searchController.js';
import { getDashboard } from '../controllers/dashboardController.js';
import { uploadFile } from '../controllers/uploadController.js';

const router = Router();

// Only students (and club admins, who are students who also run a club) join
// clubs or register for events — faculty/HOD/principal/admin/security don't.
const STUDENT_ROLES = ['student', 'club_admin'];

// ── Reusable validators ────────────────────────────────────────────
const password = (field) =>
  body(field)
    .isString()
    .isLength({ min: 8, max: 72 })
    .withMessage('Password must be 8–72 characters')
    .matches(/[A-Za-z]/)
    .withMessage('Password must contain a letter')
    .matches(/\d/)
    .withMessage('Password must contain a number');

const tagArray = (field) =>
  body(field)
    .optional()
    .isArray({ max: 25 })
    .withMessage(`${field} must be a list (max 25)`)
    .customSanitizer((arr) => arr.map((s) => String(s).trim().toLowerCase().slice(0, 40)).filter(Boolean));

const safeUrl = (field) =>
  body(field)
    .optional({ values: 'falsy' })
    .isString()
    .custom((v) => v.startsWith('/uploads/') || /^https:\/\//.test(v))
    .withMessage(`${field} must be an uploaded file or https URL`);

// ── Auth ───────────────────────────────────────────────────────────
router.post(
  '/auth/register',
  authLimiter,
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2–80 characters'),
  body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail({ gmail_remove_dots: false }),
  password('password'),
  body('department').optional().trim().isLength({ max: 80 }),
  body('year').optional({ values: 'falsy' }).isInt({ min: 1, max: 6 }).toInt(),
  body('rollNo').optional().trim().isLength({ max: 30 }),
  validate,
  auth.register
);
router.post(
  '/auth/login',
  authLimiter,
  body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail({ gmail_remove_dots: false }),
  body('password').isString().notEmpty().withMessage('Password is required'),
  validate,
  auth.login
);
router.post('/auth/refresh', auth.refresh);
router.post('/auth/logout', auth.logout);
router.post(
  '/auth/forgot-password',
  passwordResetLimiter,
  body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail({ gmail_remove_dots: false }),
  validate,
  auth.forgotPassword
);
router.post(
  '/auth/reset-password',
  passwordResetSubmitLimiter,
  body('token').isString().isLength({ min: 20, max: 200 }).withMessage('This reset link is invalid or has expired'),
  password('password'),
  validate,
  auth.resetPassword
);

// Everything below requires a signed-in user.
router.use(protect);
// Live "something changed" signals for announcements / events / clubs / discussions.
router.use(realtimeChanges);

router.get('/auth/me', auth.me);
router.get('/auth/sessions', auth.listSessions);
router.post('/auth/sessions/revoke-others', auth.revokeOtherSessions);
router.delete('/auth/sessions/:id', idParam('id'), auth.revokeSession);
router.post(
  '/auth/push-token',
  body('token').isString().matches(/^Expo(nent)?PushToken\[[\w-]+\]$/).withMessage('Invalid push token'),
  validate,
  auth.registerPushToken
);
router.delete('/auth/push-token', body('token').isString().isLength({ max: 200 }), validate, auth.removePushToken);
router.post(
  '/auth/change-password',
  authLimiter,
  body('currentPassword').isString().notEmpty(),
  password('newPassword'),
  validate,
  auth.changePassword
);
router.get('/auth/login-history', auth.getLoginHistory);

// ── Dashboard + search ─────────────────────────────────────────────
router.get('/dashboard', getDashboard);
router.get('/search', query('q').optional().isString().isLength({ max: 64 }), validate, globalSearch);

// ── Uploads ────────────────────────────────────────────────────────
router.post('/uploads', uploadLimiter, upload.single('file'), uploadFile);

// ── Users / profiles ───────────────────────────────────────────────
router.get('/users', users.listUsers);
router.put(
  '/users/me',
  writeLimiter,
  body('name').optional().trim().isLength({ min: 2, max: 80 }),
  body('department').optional().trim().isLength({ max: 80 }),
  body('year').optional({ values: 'null' }).isInt({ min: 1, max: 6 }).toInt(),
  body('bio').optional().trim().isLength({ max: 500 }),
  body('phone').optional().trim().isLength({ max: 20 }),
  tagArray('interests'),
  tagArray('skills'),
  tagArray('extracurriculars'),
  body('achievements').optional().isArray({ max: 20 }),
  body('achievements.*.title').optional().trim().isLength({ min: 1, max: 120 }),
  validate,
  users.updateMe
);
router.put('/users/me/avatar', uploadLimiter, upload.single('file'), users.uploadAvatar);
router.get('/users/:id', idParam('id'), users.getUser);

// ── Clubs ──────────────────────────────────────────────────────────
const clubRules = (optional = false) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body('name')).trim().isLength({ min: 3, max: 80 }).withMessage('Club name must be 3–80 characters'),
    o(body('description')).trim().isLength({ min: 20, max: 3000 }).withMessage('Description must be at least 20 characters'),
    body('tagline').optional().trim().isLength({ max: 140 }),
    body('category').optional().isIn(CLUB_CATEGORIES),
    body('contactEmail').optional({ values: 'falsy' }).isEmail(),
    body('facultyAdvisor').optional({ values: 'falsy' }).isMongoId(),
    tagArray('tags'),
    safeUrl('logo'),
    safeUrl('coverImage'),
    validate,
  ];
};
router.get('/clubs', clubs.listClubs);
router.post('/clubs', writeLimiter, ...clubRules(), clubs.createClub);
router.get('/clubs/:id', clubs.getClub);
router.put('/clubs/:id', idParam('id'), ...clubRules(true), clubs.updateClub);
router.delete('/clubs/:id', idParam('id'), authorize('admin'), clubs.deleteClub);
router.patch(
  '/clubs/:id/review',
  idParam('id'),
  authorize('admin'),
  body('status').isIn(['approved', 'rejected']),
  body('note').optional().trim().isLength({ max: 300 }),
  validate,
  clubs.reviewClub
);
router.post('/clubs/:id/join', idParam('id'), authorize(...STUDENT_ROLES), body('message').optional().trim().isLength({ max: 300 }), validate, clubs.requestJoin);
router.delete('/clubs/:id/join', idParam('id'), clubs.cancelRequest);
router.post('/clubs/:id/leave', idParam('id'), clubs.leaveClub);
router.get('/clubs/:id/requests', idParam('id'), clubs.listRequests);
router.post(
  '/clubs/:id/requests/:userId/:action',
  idParam('id', 'userId'),
  (req, res, next) => (['approve', 'reject'].includes(req.params.action) ? next() : res.status(404).end()),
  clubs.handleRequest
);
router.delete('/clubs/:id/members/:userId', idParam('id', 'userId'), clubs.removeMember);
router.patch(
  '/clubs/:id/members/:userId/role',
  idParam('id', 'userId'),
  body('makeAdmin').isBoolean(),
  validate,
  clubs.setMemberRole
);

// ── Events ─────────────────────────────────────────────────────────
const eventRules = (optional = false) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body('title')).trim().isLength({ min: 3, max: 120 }).withMessage('Title must be 3–120 characters'),
    o(body('description')).trim().isLength({ min: 10, max: 5000 }).withMessage('Description must be at least 10 characters'),
    o(body('venue')).trim().isLength({ min: 2, max: 160 }).withMessage('Venue is required'),
    o(body('startDate')).isISO8601().withMessage('Valid start date required').toDate(),
    o(body('endDate')).isISO8601().withMessage('Valid end date required').toDate(),
    body('registrationDeadline').optional({ values: 'falsy' }).isISO8601().toDate(),
    body('category').optional().isIn(EVENT_CATEGORIES),
    body('capacity').optional().isInt({ min: 0, max: 100000 }).toInt(),
    body('club').optional({ values: 'falsy' }).isMongoId(),
    body('isFeatured').optional().isBoolean().toBoolean(),
    tagArray('tags'),
    safeUrl('poster'),
    validate,
  ];
};
router.get(
  '/events',
  query('from').optional({ values: 'falsy' }).isISO8601(),
  query('to').optional({ values: 'falsy' }).isISO8601(),
  query('club').optional({ values: 'falsy' }).isMongoId(),
  validate,
  events.listEvents
);
router.post('/events', writeLimiter, ...eventRules(), events.createEvent);
router.get('/events/:id', idParam('id'), events.getEvent);
router.put('/events/:id', idParam('id'), ...eventRules(true), events.updateEvent);
router.delete('/events/:id', idParam('id'), events.deleteEvent);
router.post('/events/:id/register', idParam('id'), authorize(...STUDENT_ROLES), events.registerForEvent);
router.delete('/events/:id/register', idParam('id'), events.cancelRegistration);
router.get('/events/:id/participants', idParam('id'), events.getParticipants);
router.patch(
  '/events/:id/attendance/:userId',
  idParam('id', 'userId'),
  body('attended').isBoolean(),
  validate,
  events.markAttendance
);

// ── Announcements ──────────────────────────────────────────────────
const announcementRules = (optional = false) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body('title')).trim().isLength({ min: 3, max: 160 }).withMessage('Title must be 3–160 characters'),
    o(body('content')).trim().isLength({ min: 5, max: 5000 }).withMessage('Content is required'),
    body('priority').optional().isIn(ANNOUNCEMENT_PRIORITIES),
    body('audience.scope').optional().isIn(AUDIENCE_SCOPES),
    body('audience.club').optional({ values: 'falsy' }).isMongoId(),
    body('audience.year').optional({ values: 'falsy' }).isInt({ min: 1, max: 6 }),
    body('deadline').optional({ values: 'falsy' }).isISO8601().toDate(),
    body('attachments').optional().isArray({ max: 5 }),
    body('attachments.*.url')
      .optional()
      .custom((v) => String(v).startsWith('/uploads/') || /^https:\/\//.test(v)),
    validate,
  ];
};
router.get('/announcements', ann.listAnnouncements);
router.post('/announcements', writeLimiter, ...announcementRules(), ann.createAnnouncement);
router.put('/announcements/:id', idParam('id'), ...announcementRules(true), ann.updateAnnouncement);
router.delete('/announcements/:id', idParam('id'), ann.deleteAnnouncement);
router.patch('/announcements/:id/pin', idParam('id'), authorize('admin', 'faculty', 'hod'), ann.togglePin);

// ── Discussions ────────────────────────────────────────────────────
router.get('/discussions', disc.listDiscussions);
router.post(
  '/discussions',
  writeLimiter,
  body('title').trim().isLength({ min: 5, max: 160 }).withMessage('Title must be 5–160 characters'),
  body('body').trim().isLength({ min: 10, max: 5000 }).withMessage('Please add a bit more detail (10+ characters)'),
  body('category').optional().isIn(DISCUSSION_CATEGORIES),
  body('club').optional({ values: 'falsy' }).isMongoId(),
  tagArray('tags'),
  validate,
  disc.createDiscussion
);
router.get('/discussions/:id', idParam('id'), disc.getDiscussion);
router.put(
  '/discussions/:id',
  idParam('id'),
  body('title').optional().trim().isLength({ min: 5, max: 160 }),
  body('body').optional().trim().isLength({ min: 10, max: 5000 }),
  body('category').optional().isIn(DISCUSSION_CATEGORIES),
  tagArray('tags'),
  validate,
  disc.updateDiscussion
);
router.delete('/discussions/:id', idParam('id'), disc.deleteDiscussion);
router.post(
  '/discussions/:id/replies',
  writeLimiter,
  idParam('id'),
  body('body').trim().isLength({ min: 1, max: 3000 }).withMessage('Reply cannot be empty'),
  validate,
  disc.addReply
);
router.delete('/discussions/:id/replies/:replyId', idParam('id', 'replyId'), disc.deleteReply);
router.post('/discussions/:id/upvote', idParam('id'), disc.toggleUpvote);
router.post('/discussions/:id/replies/:replyId/upvote', idParam('id', 'replyId'), disc.toggleReplyUpvote);
router.patch(
  '/discussions/:id/moderate/:action',
  idParam('id'),
  authorize('admin', 'faculty', 'hod'),
  (req, res, next) => (['lock', 'pin', 'hide'].includes(req.params.action) ? next() : res.status(404).end()),
  disc.moderateDiscussion
);

// ── Reports / moderation ───────────────────────────────────────────
router.post(
  '/reports',
  writeLimiter,
  body('targetType').isIn(REPORT_TARGETS),
  body('targetId').isMongoId(),
  body('replyId').optional({ values: 'falsy' }).isMongoId(),
  body('reason').isIn(REPORT_REASONS),
  body('details').optional().trim().isLength({ max: 500 }),
  validate,
  reports.createReport
);
router.get('/reports', authorize('admin', 'faculty', 'hod', 'principal'), reports.listReports);
router.patch(
  '/reports/:id',
  idParam('id'),
  authorize('admin', 'faculty', 'hod'),
  body('action').isIn(REPORT_ACTIONS),
  body('note').optional().trim().isLength({ max: 500 }),
  validate,
  reports.resolveReport
);

// ── Notifications ──────────────────────────────────────────────────
router.get('/notifications', notes.listNotifications);
router.patch('/notifications/read-all', notes.markAllRead);
router.patch('/notifications/:id/read', idParam('id'), notes.markRead);
router.delete('/notifications/:id', idParam('id'), notes.deleteNotification);

// ── Admin ──────────────────────────────────────────────────────────
router.get('/admin/analytics', authorize('admin', 'faculty', 'hod', 'principal'), admin.analytics);
router.get('/admin/users', authorize('admin'), admin.listUsers);
router.post(
  '/admin/users',
  writeLimiter,
  authorize('admin'),
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2–80 characters'),
  body('email').trim().isEmail().withMessage('Enter a valid college email').normalizeEmail({ gmail_remove_dots: false }),
  password('password'),
  body('role').isIn(ROLES).withMessage('Choose a role'),
  // Student / club admin.
  body('rollNo')
    .if((_v, { req }) => ['student', 'club_admin'].includes(req.body.role))
    .trim()
    .isLength({ min: 1, max: 30 })
    .withMessage('Roll number is required'),
  body('year')
    .if((_v, { req }) => ['student', 'club_admin'].includes(req.body.role))
    .isInt({ min: 1, max: 6 })
    .withMessage('Year is required')
    .toInt(),
  body('stayType')
    .if((_v, { req }) => ['student', 'club_admin'].includes(req.body.role))
    .isIn(STAY_TYPES)
    .withMessage('Select hosteler or day scholar'),
  body('parentPhone')
    .if((_v, { req }) => ['student', 'club_admin'].includes(req.body.role))
    .trim()
    .isLength({ min: 6, max: 20 })
    .withMessage("Parent's mobile number is required"),
  // Faculty / HOD / Principal / Admin.
  body('employeeId')
    .if((_v, { req }) => STAFF_ROLES.includes(req.body.role))
    .trim()
    .isLength({ min: 1, max: 30 })
    .withMessage('Employee ID is required'),
  // Everyone except Principal and Security needs a department on file.
  body('department')
    .if((_v, { req }) => !NO_DEPARTMENT_ROLES.includes(req.body.role))
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('Department is required'),
  body('section').optional({ values: 'falsy' }).trim().isLength({ max: 10 }).matches(/^[A-Za-z0-9-]*$/),
  body('semester').optional({ values: 'falsy' }).isInt({ min: 1, max: 12 }).toInt(),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
  validate,
  admin.createUser
);
router.patch(
  '/admin/users/:id',
  idParam('id'),
  authorize('admin'),
  body('role').optional().isIn(ROLES),
  body('isActive').optional().isBoolean(),
  body('department').optional({ values: 'null' }).trim().isLength({ max: 80 }),
  body('year').optional({ values: 'falsy' }).isInt({ min: 1, max: 6 }).toInt(),
  body('section')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 10 })
    .matches(/^[A-Za-z0-9-]*$/)
    .withMessage('Section may contain letters, numbers and dashes'),
  body('semester').optional({ values: 'falsy' }).isInt({ min: 1, max: 12 }).toInt(),
  body('rollNo').optional({ values: 'null' }).trim().isLength({ max: 30 }),
  body('employeeId').optional({ values: 'null' }).trim().isLength({ max: 30 }),
  body('stayType').optional({ values: 'null' }).isIn(STAY_TYPES),
  body('phone').optional({ values: 'null' }).trim().isLength({ max: 20 }),
  body('parentPhone').optional({ values: 'null' }).trim().isLength({ max: 20 }),
  validate,
  admin.updateUser
);
router.get('/admin/activity', authorize('admin'), admin.listActivity);

// ════════════════════════════════════════════════════════════════════
//  NEW FEATURE ROUTES
// ════════════════════════════════════════════════════════════════════

// ── Chat ───────────────────────────────────────────────────────────
// Can act: mark attendance, review corrections/gate passes, verify at the gate.
// HOD acts across their whole department (enforced inside each controller).
const STAFF = ['admin', 'faculty', 'hod'];
// Read-only staff views. Principal sees every dashboard but cannot mark/review/verify.
const STAFF_VIEW = [...STAFF, 'principal'];

router.get('/chat/conversations', query('search').optional().isString().isLength({ max: 64 }), validate, chat.listConversations);
router.get('/chat/unread', chat.getUnreadTotal);
router.get('/chat/search', query('q').optional().isString().isLength({ max: 64 }), validate, chat.searchMessages);
router.get('/chat/users/online', chat.getOnlineUsers);
router.get('/chat/requests', query('status').optional().isIn(['pending', 'all']), validate, chat.listGroupRequests);
router.patch(
  '/chat/requests/:id',
  idParam('id'),
  authorize('admin'),
  body('action').isIn(['approve', 'reject']).withMessage('Choose approve or reject'),
  body('reason').optional().trim().isLength({ max: 300 }),
  validate,
  chat.reviewGroupRequest
);
router.post(
  '/chat/conversations',
  writeLimiter,
  body('type').optional().isIn(CONVERSATION_TYPES),
  body('participantIds').isArray({ min: 1, max: 100 }).withMessage('Choose who to chat with'),
  body('participantIds.*').isMongoId(),
  body('name').optional().trim().isLength({ max: 100 }),
  body('description').optional().trim().isLength({ max: 300 }),
  validate,
  chat.createConversation
);
router.get('/chat/conversations/:id', idParam('id'), chat.getConversation);
router.get(
  '/chat/conversations/:id/messages',
  idParam('id'),
  query('q').optional().isString().isLength({ max: 64 }),
  query('before').optional().isISO8601(),
  validate,
  chat.getMessages
);
router.post(
  '/chat/conversations/:id/messages',
  writeLimiter,
  idParam('id'),
  body('body').trim().isLength({ min: 1, max: 5000 }).withMessage('Message cannot be empty'),
  body('replyTo').optional({ values: 'falsy' }).isMongoId(),
  body('attachment.url')
    .optional({ values: 'falsy' })
    .custom((v) => String(v).startsWith('/uploads/') || /^https:\/\//.test(v))
    .withMessage('Attachments must be uploaded files'),
  body('attachment.name').optional().trim().isLength({ max: 200 }),
  body('attachment.mimeType').optional().trim().isLength({ max: 50 }),
  body('attachment.size').optional().isInt({ min: 0 }).toInt(),
  validate,
  chat.sendMessage
);
router.delete('/chat/conversations/:id/messages/:msgId', idParam('id', 'msgId'), chat.deleteMessage);
router.patch('/chat/conversations/:id/messages/:msgId/pin', idParam('id', 'msgId'), chat.togglePinMessage);
router.patch('/chat/conversations/:id/read', idParam('id'), chat.markRead);
router.post(
  '/chat/conversations/:id/members',
  idParam('id'),
  body('userIds').isArray({ min: 1, max: 50 }),
  body('userIds.*').isMongoId(),
  validate,
  chat.addMembers
);
router.delete('/chat/conversations/:id/members/:userId', idParam('id', 'userId'), chat.removeMember);

// ── Attendance ─────────────────────────────────────────────────────
const dateField = (field, where = body) =>
  where(field).matches(/^\d{4}-\d{2}-\d{2}/).withMessage('Valid date required (YYYY-MM-DD)');
const rangeQuery = [
  query('range').optional().isIn(['day', 'week', 'month', 'semester', 'all', 'custom']),
  query('from').optional({ values: 'falsy' }).isISO8601(),
  query('to').optional({ values: 'falsy' }).isISO8601(),
  query('groupBy').optional().isIn(['day', 'week', 'month']),
];

router.get(
  '/attendance/roster',
  authorize(...STAFF),
  query('subjectId').isMongoId().withMessage('Subject is required'),
  dateField('date', query),
  query('period').isInt({ min: 1, max: 12 }).withMessage('Period is required'),
  query('section').optional().trim().isLength({ max: 10 }),
  validate,
  attendance.getRoster
);
router.post(
  '/attendance/mark',
  writeLimiter,
  authorize(...STAFF),
  body('subjectId').isMongoId().withMessage('Subject is required'),
  dateField('date'),
  body('period').isInt({ min: 1, max: 12 }).toInt(),
  body('section').optional().trim().isLength({ max: 10 }),
  body('records').isArray({ min: 1, max: 300 }).withMessage('Records are required'),
  body('records.*.student').isMongoId(),
  body('records.*.status').isIn(ATTENDANCE_STATUSES),
  validate,
  attendance.markAttendance
);
router.get('/attendance/my', ...rangeQuery, query('semester').optional().isInt({ min: 1, max: 12 }), validate, attendance.getMyAttendance);
router.get('/attendance/records', ...rangeQuery, validate, attendance.getAttendanceRecords);
router.get('/attendance/trends', ...rangeQuery, validate, attendance.getAttendanceTrends);
router.get('/attendance/sessions', authorize(...STAFF_VIEW), ...rangeQuery, validate, attendance.listSessions);
router.get('/attendance/low', authorize(...STAFF_VIEW), ...rangeQuery, validate, attendance.getLowAttendance);
router.get('/attendance/student/:id', idParam('id'), authorize(...STAFF_VIEW), ...rangeQuery, validate, attendance.getStudentAttendance);
router.get('/attendance/subject/:subjectId', idParam('subjectId'), authorize(...STAFF_VIEW), ...rangeQuery, validate, attendance.getSubjectAttendance);
router.get('/attendance/section', authorize(...STAFF_VIEW), ...rangeQuery, validate, attendance.getSectionAttendance);

// Daily headcount for the admin (college) / HOD (own department) dashboard.
const SUMMARY_VIEW = ['admin', 'hod', 'principal'];
const summaryQuery = [
  query('date').optional({ values: 'falsy' }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date must be YYYY-MM-DD'),
  query('department').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  query('section').optional({ values: 'falsy' }).trim().isLength({ max: 10 }),
  query('status').optional({ values: 'falsy' }).isIn(['present', 'absent', 'leave', 'unmarked']),
  validate,
];
router.get('/attendance/summary', authorize(...SUMMARY_VIEW), ...summaryQuery, staffAttendance.attendanceSummary);
router.get('/attendance/summary/students', authorize(...SUMMARY_VIEW), ...summaryQuery, staffAttendance.summaryStudents);
router.get('/attendance/summary/faculty', authorize(...SUMMARY_VIEW), ...summaryQuery, staffAttendance.summaryFaculty);

// Faculty attendance: HOD marks their department, admin marks anyone.
router.get('/attendance/faculty/roster', authorize(...SUMMARY_VIEW), ...summaryQuery, staffAttendance.facultyRoster);
router.post(
  '/attendance/faculty/mark',
  writeLimiter,
  authorize('admin', 'hod'),
  dateField('date'),
  body('records').isArray({ min: 1, max: 500 }).withMessage('Records are required'),
  body('records.*.faculty').isMongoId(),
  body('records.*.status').isIn(['present', 'absent', 'leave']),
  body('records.*.note').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  validate,
  staffAttendance.markFaculty
);
router.post(
  '/attendance/corrections',
  writeLimiter,
  authorize(...STUDENT_ROLES),
  body('subjectId').isMongoId(),
  dateField('date'),
  body('period').isInt({ min: 1, max: 12 }).toInt(),
  body('requestedStatus').isIn(ATTENDANCE_STATUSES),
  body('reason').trim().isLength({ min: 5, max: 500 }).withMessage('Please explain the correction (5+ characters)'),
  validate,
  attendance.requestCorrection
);
router.get('/attendance/corrections', attendance.listCorrections);
router.patch(
  '/attendance/corrections/:id',
  idParam('id'),
  authorize(...STAFF),
  body('action').isIn(['approved', 'rejected']),
  body('note').optional().trim().isLength({ max: 300 }),
  validate,
  attendance.reviewCorrection
);

// ── Timetable ──────────────────────────────────────────────────────
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const notBreak = (_v, { req }) => !req.body.isBreak;
const slotRules = (optional = false) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    body('isBreak').optional().isBoolean().toBoolean(),
    o(body('subject').if(notBreak)).isMongoId().withMessage('Subject is required'),
    o(body('faculty').if(notBreak)).isMongoId().withMessage('Faculty is required'),
    o(body('section')).trim().isLength({ min: 1, max: 10 }).withMessage('Section is required'),
    o(body('department')).trim().isLength({ min: 1, max: 80 }).withMessage('Department is required'),
    o(body('dayOfWeek')).isIn(WEEKDAYS).withMessage('Choose a day'),
    o(body('period')).isInt({ min: 1, max: 12 }).toInt(),
    o(body('startTime')).matches(HHMM).withMessage('Start time must be HH:mm'),
    o(body('endTime')).matches(HHMM).withMessage('End time must be HH:mm'),
    o(body('semester')).isInt({ min: 1, max: 12 }).toInt(),
    body('room').optional().trim().isLength({ max: 60 }),
    body('year').optional({ values: 'falsy' }).isInt({ min: 1, max: 6 }).toInt(),
    body('academicYear').optional().trim().isLength({ max: 20 }),
    body('breakLabel').optional().trim().isLength({ max: 40 }),
    validate,
  ];
};
const subjectRules = (optional = false) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body('name')).trim().isLength({ min: 2, max: 120 }).withMessage('Subject name required'),
    o(body('code')).trim().isLength({ min: 2, max: 20 }).withMessage('Subject code required'),
    o(body('department')).trim().isLength({ min: 1, max: 80 }).withMessage('Department required'),
    o(body('semester')).isInt({ min: 1, max: 12 }).toInt(),
    body('year').optional({ values: 'falsy' }).isInt({ min: 1, max: 6 }).toInt(),
    body('credits').optional().isInt({ min: 0, max: 10 }).toInt(),
    body('type').optional().isIn(['theory', 'lab', 'elective']),
    body('faculty').optional().isArray({ max: 20 }),
    body('faculty.*').isMongoId(),
    body('sections').optional().isArray({ max: 20 }),
    body('sections.*').trim().isLength({ min: 1, max: 10 }),
    validate,
  ];
};
router.get('/timetable', timetable.getMyTimetable);
router.get('/timetable/current', timetable.getCurrentClass);
router.get('/timetable/section/:section', param('section').trim().isLength({ min: 1, max: 10 }), validate, timetable.getSectionTimetable);
router.get('/timetable/faculty/:id', idParam('id'), timetable.getFacultyTimetable);
router.get('/subjects', timetable.listSubjects);
router.post('/subjects', writeLimiter, authorize('admin'), ...subjectRules(), timetable.createSubject);
router.put('/subjects/:id', idParam('id'), authorize('admin'), ...subjectRules(true), timetable.updateSubject);
router.delete('/subjects/:id', idParam('id'), authorize('admin'), timetable.deleteSubject);
router.post('/timetable', writeLimiter, authorize('admin'), ...slotRules(), timetable.createSlot);
router.put('/timetable/:id', idParam('id'), authorize('admin'), ...slotRules(true), timetable.updateSlot);
router.delete('/timetable/:id', idParam('id'), authorize('admin'), timetable.deleteSlot);

// ── Gate Pass ──────────────────────────────────────────────────────
// Approval climbs faculty (class in-charge) → HOD → principal; security
// only ever sees approved/active/completed passes to record OUT / IN.
const GATE_FACULTY = ['faculty', 'admin'];
const GATE_HOD = ['hod', 'admin'];
const GATE_PRINCIPAL = ['principal', 'admin'];
const GATE_SECURITY = ['security', 'admin'];
const GATE_VIEW = [...STAFF_VIEW, 'security'];

const gateDestinationRules = [
  body('regarding').isIn(GATE_PASS_REGARDING).withMessage('Select a valid reason'),
  body('description').trim().isLength({ min: 5, max: 500 }).withMessage('Please describe the reason (5+ characters)'),
  body('fromDate').isISO8601().withMessage('Departure date required'),
  body('toDate').isISO8601().withMessage('Return date required'),
  body('parentPhone').trim().isLength({ min: 6, max: 20 }).withMessage("Parent's mobile number is required"),
  body('destination.state').trim().isLength({ min: 1, max: 80 }).withMessage('State is required'),
  body('destination.district').trim().isLength({ min: 1, max: 80 }).withMessage('District is required'),
  body('destination.area').trim().isLength({ min: 1, max: 120 }).withMessage('Village / area is required'),
];
const gateReviewRules = (actions) => [
  idParam('id'),
  body('action').isIn(actions),
  body('reason').optional().trim().isLength({ max: 300 }),
  validate,
];

router.post('/gate-pass', writeLimiter, authorize(...STUDENT_ROLES), ...gateDestinationRules, validate, gatePass.createGatePass);
router.get('/gate-pass', ...rangeQuery, validate, gatePass.listGatePasses);
router.get('/gate-pass/dashboard', authorize(...GATE_VIEW), gatePass.gateDashboard);
router.get('/gate-pass/dashboard/security', authorize(...GATE_SECURITY), gatePass.securityDashboard);
router.post(
  '/gate-pass/verify',
  verifyLimiter,
  authorize(...GATE_SECURITY),
  body('code').isString().trim().isLength({ min: 4, max: 20 }).withMessage('Verification code is required'),
  validate,
  gatePass.verifyGatePass
);
router.get('/gate-pass/:id', idParam('id'), gatePass.getGatePass);
router.get('/gate-pass/:id/qr', idParam('id'), gatePass.getGatePassQr);
router.patch('/gate-pass/:id/faculty-review', authorize(...GATE_FACULTY), ...gateReviewRules(['forward', 'reject']), gatePass.facultyReview);
router.patch('/gate-pass/:id/hod-review', authorize(...GATE_HOD), ...gateReviewRules(['forward', 'reject']), gatePass.hodReview);
router.patch('/gate-pass/:id/principal-review', authorize(...GATE_PRINCIPAL), ...gateReviewRules(['approve', 'reject']), gatePass.principalReview);
router.patch('/gate-pass/:id/cancel', idParam('id'), gatePass.cancelGatePass);
router.patch('/gate-pass/:id/out', idParam('id'), authorize(...GATE_SECURITY), gatePass.recordOut);
router.patch('/gate-pass/:id/in', idParam('id'), authorize(...GATE_SECURITY), gatePass.recordIn);
router.patch(
  '/gate-pass/:id/revoke',
  idParam('id'),
  authorize('admin', 'principal'),
  body('reason').optional().trim().isLength({ max: 300 }),
  validate,
  gatePass.revokeGatePass
);

// ── Lost & Found ───────────────────────────────────────────────────
router.post(
  '/lost-found',
  writeLimiter,
  body('type').isIn(LOST_FOUND_TYPES).withMessage('Type must be "lost" or "found"'),
  body('itemName').trim().isLength({ min: 2, max: 120 }).withMessage('Item name is required'),
  body('category').isIn(LOST_FOUND_CATEGORIES).withMessage('Choose a category'),
  body('description').optional().trim().isLength({ max: 1000 }),
  safeUrl('photo'),
  body('location').trim().isLength({ min: 2, max: 200 }).withMessage('Location is required'),
  body('dateTime').isISO8601().withMessage('Date/time is required'),
  body('additionalDetails').optional().trim().isLength({ max: 500 }),
  body('contactMethod').optional().isIn(['email', 'phone', 'in_person']),
  validate,
  lostFound.reportItem
);
router.get('/lost-found', query('search').optional().isString().isLength({ max: 64 }), validate, lostFound.listItems);
router.get('/lost-found/:id', idParam('id'), lostFound.getItem);
router.get('/lost-found/:id/matches', idParam('id'), lostFound.findMatches);
router.put(
  '/lost-found/:id',
  idParam('id'),
  body('itemName').optional().trim().isLength({ min: 2, max: 120 }),
  body('category').optional().isIn(LOST_FOUND_CATEGORIES),
  body('description').optional().trim().isLength({ max: 1000 }),
  safeUrl('photo'),
  body('location').optional().trim().isLength({ min: 2, max: 200 }),
  body('dateTime').optional().isISO8601(),
  body('additionalDetails').optional().trim().isLength({ max: 500 }),
  body('contactMethod').optional().isIn(['email', 'phone', 'in_person']),
  validate,
  lostFound.updateItem
);
router.delete('/lost-found/:id', idParam('id'), lostFound.deleteItem);
router.patch(
  '/lost-found/:id/status',
  idParam('id'),
  body('status').isIn(LOST_FOUND_STATUSES),
  body('matchedWith').optional({ values: 'falsy' }).isMongoId(),
  body('resolutionNote').optional().trim().isLength({ max: 300 }),
  validate,
  lostFound.updateStatus
);

// ── Advanced Analytics ─────────────────────────────────────────────
router.get('/analytics/student', ...rangeQuery, validate, analytics.studentAnalytics);
router.get('/analytics/faculty', authorize(...STAFF_VIEW), ...rangeQuery, validate, analytics.facultyAnalytics);
router.get('/analytics/department', authorize(...STAFF_VIEW), ...rangeQuery, validate, analytics.departmentAnalytics);
router.get('/analytics/college', authorize('admin', 'principal'), ...rangeQuery, validate, analytics.collegeAnalytics);
router.get('/analytics/gate', authorize(...STAFF_VIEW), ...rangeQuery, validate, analytics.gateAnalytics);
router.get('/analytics/club/:id', param('id').isString().isLength({ min: 1, max: 80 }), ...rangeQuery, validate, analytics.clubAnalytics);

export default router;
