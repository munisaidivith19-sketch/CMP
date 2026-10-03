import { Router } from 'express';
import { body, query, param } from 'express-validator';
import { protect, authorize } from '../middleware/auth.js';
import { idParam, validate } from '../middleware/validate.js';
import { aiHourLimiter, aiMinuteLimiter, authLimiter, otpLimiter, returnLocationLimiter, passwordResetLimiter, passwordResetSubmitLimiter, uploadLimiter, verifyLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { ApiError } from '../utils/http.js';
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
  EMERGENCY_AUTHORITIES,
  LOST_FOUND_TYPES,
  LOST_FOUND_CATEGORIES,
  LOST_FOUND_STATUSES,
  WEEKDAYS,
  ATTENDANCE_STATUSES,
  CONVERSATION_TYPES,
  GROUP_CATEGORIES,
  STAY_TYPES,
  STAFF_ROLES,
  NO_DEPARTMENT_ROLES,
  COMPLAINT_CATEGORIES,
  COMPLAINT_SUBCATEGORIES,
  COMPLAINT_ESCALATE_TO,
  TIMETABLE_VIEW_ROLES,
  TIMETABLE_WRITE_ROLES,
  ATTENDANCE_VIEW_ROLES,
  ATTENDANCE_SUMMARY_ROLES,
  PEOPLE_DIRECTORY_ROLES,
  STUDY_MATERIAL_VIEW_ROLES,
  STUDY_MATERIAL_WRITE_ROLES,
  STUDY_MATERIAL_CATEGORIES,
  ACADEMIC_YEARS,
  DEPARTMENTS,
  SEMESTERS,
  SECTIONS,
  yearOfSemester,
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
import { REPORT_SCOPES, REPORT_TYPES } from '../services/attendanceReport.js';
import * as staffAttendance from '../controllers/staffAttendanceController.js';
import * as timetable from '../controllers/timetableController.js';
import * as gatePass from '../controllers/gatePassController.js';
import * as lostFound from '../controllers/lostFoundController.js';
import * as complaints from '../controllers/complaintController.js';
import { COMPLAINT_AUTHORITY_ROLES } from '../controllers/complaintController.js';
import * as materials from '../controllers/studyMaterialController.js';
import * as ai from '../controllers/aiController.js';
import { env } from '../config/env.js';
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

const isStudentRole = (_v, { req }) => STUDENT_ROLES.includes(req.body.role);
const isFacultyRole = (_v, { req }) => req.body.role === 'faculty';

/** Faculty years/sections handled: distinct multi-select lists, required on create. */
const teachingScopeRules = (required) => {
  const list = (field, allowed, normalise, message) => {
    const chain = body(field);
    return (required ? chain.if(isFacultyRole) : chain.optional())
      .isArray({ min: 1, max: allowed.length })
      .withMessage(message)
      .bail()
      .custom((arr) => arr.every((x) => allowed.includes(normalise(x))) && new Set(arr.map(normalise)).size === arr.length)
      .withMessage(`${message} — distinct values from ${allowed.join(', ')}`)
      .customSanitizer((arr) => arr.map(normalise).sort());
  };
  return [
    list('teachingYears', ACADEMIC_YEARS, Number, 'Select the year(s) handled'),
    list('teachingSections', SECTIONS, (s) => String(s).trim().toUpperCase(), 'Select the section(s) handled'),
  ];
};

/**
 * Faculty Class In-Charge year + semester ("Our Class"). Optional on the API so
 * existing clients keep working, but when sent they must name a real year, a
 * real semester of that year, and belong to a faculty account. The model
 * re-checks the pair and the section on every save.
 */
const inChargeRules = ({ create }) => [
  body('inChargeYear')
    .optional({ values: 'falsy' })
    .custom((_v, { req }) => !create || req.body.role === 'faculty')
    .withMessage('In-charge year and semester apply to faculty accounts only')
    .bail()
    .isIn(ACADEMIC_YEARS)
    .withMessage('In-charge year must be 1–4')
    .toInt(),
  body('inChargeSemester')
    .optional({ values: 'falsy' })
    .custom((_v, { req }) => !create || req.body.role === 'faculty')
    .withMessage('In-charge year and semester apply to faculty accounts only')
    .bail()
    .isIn(SEMESTERS)
    .withMessage('In-charge semester must be 1–8')
    .bail()
    .custom((sem, { req }) => !req.body.inChargeYear || yearOfSemester(sem) === Number(req.body.inChargeYear))
    .withMessage('That in-charge semester does not belong to the in-charge year')
    .toInt(),
];

/** Optional `year` that must be 1–4 and, when a semester is sent too, the year that semester belongs to. */
const yearMatchesSemester = () =>
  body('year')
    .optional({ values: 'falsy' })
    .isIn(ACADEMIC_YEARS)
    .withMessage('Year must be 1–4')
    .bail()
    .custom((y, { req }) => !req.body.semester || yearOfSemester(req.body.semester) === Number(y))
    .withMessage('That semester does not belong to this year')
    .toInt();

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
router.get('/users', query('context').optional().isIn(['picker']), validate, users.listUsers);
// The People filter dropdowns this account may use, derived from its own role
// and department — so the UI can never offer an out-of-scope option.
router.get('/users/people-filters', authorize(...PEOPLE_DIRECTORY_ROLES), users.peopleFilters);
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
    .if(isStudentRole)
    .trim()
    .isLength({ min: 1, max: 30 })
    .withMessage('Roll number is required'),
  // A student belongs to exactly one class: department + year + section + semester.
  body('department').if(isStudentRole).isIn(DEPARTMENTS).withMessage('Choose a valid department'),
  body('year').if(isStudentRole).isIn(ACADEMIC_YEARS).withMessage('Year is required (1–4)').toInt(),
  body('section').if(isStudentRole).trim().toUpperCase().isIn(SECTIONS).withMessage('Section is required'),
  body('semester')
    .if(isStudentRole)
    .optional({ values: 'falsy' })
    .isIn(SEMESTERS)
    .withMessage('Semester must be 1–8')
    .bail()
    .custom((s, { req }) => yearOfSemester(s) === Number(req.body.year))
    .withMessage('That semester does not belong to the selected year')
    .toInt(),
  // Faculty: the year(s) and section(s) they handle — both multi-select.
  body('department').if(isFacultyRole).isIn(DEPARTMENTS).withMessage('Choose a valid department'),
  ...teachingScopeRules(true),
  ...inChargeRules({ create: true }),
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
  // Staff "class in charge" section, optional.
  body('section').if((_v, { req }) => !isStudentRole(_v, { req })).optional({ values: 'falsy' }).trim().toUpperCase().isIn(SECTIONS).withMessage('Choose a valid section'),
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
  body('year').optional({ values: 'falsy' }).isIn(ACADEMIC_YEARS).withMessage('Year must be 1–4').toInt(),
  body('section').optional({ values: 'falsy' }).trim().toUpperCase().isIn(SECTIONS).withMessage('Choose a valid section'),
  body('semester').optional({ values: 'falsy' }).isIn(SEMESTERS).withMessage('Semester must be 1–8').toInt(),
  ...teachingScopeRules(false),
  ...inChargeRules({ create: false }),
  body('rollNo').optional({ values: 'null' }).trim().isLength({ max: 30 }),
  body('employeeId').optional({ values: 'null' }).trim().isLength({ max: 30 }),
  body('stayType').optional({ values: 'null' }).isIn(STAY_TYPES),
  body('phone').optional({ values: 'null' }).trim().isLength({ max: 20 }),
  body('parentPhone').optional({ values: 'null' }).trim().isLength({ max: 20 }),
  validate,
  admin.updateUser
);
router.delete('/admin/users/:id', idParam('id'), authorize('admin'), admin.deleteUser);
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
// HOD group requests are approved by the principal; an admin reviews any
// request (faculty requests included). The controller enforces which.
router.patch(
  '/chat/requests/:id',
  idParam('id'),
  authorize('admin', 'principal'),
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
  // HOD groups: Custom / Academics / Faculty, and why it is needed (for the principal).
  body('category').optional({ values: 'falsy' }).isIn(GROUP_CATEGORIES).withMessage('Choose Custom, Academics or Faculty'),
  body('reason').optional().trim().isLength({ max: 500 }),
  validate,
  chat.createConversation
);
// HOD group builder: every student of one class in the HOD's own department.
router.get(
  '/chat/group-class',
  authorize('hod', 'admin'),
  query('year').isIn(ACADEMIC_YEARS).withMessage('Choose a year'),
  query('section').trim().toUpperCase().isIn(SECTIONS).withMessage('Choose a section'),
  query('department').optional().trim().isLength({ max: 80 }),
  validate,
  chat.groupClassStudents
);
router.get('/chat/conversations/:id', idParam('id'), chat.getConversation);
// Rename / delete a group — its group admin (the creator) only.
router.patch(
  '/chat/conversations/:id',
  idParam('id'),
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('description').optional().trim().isLength({ max: 300 }),
  validate,
  chat.updateGroup
);
router.delete('/chat/conversations/:id', idParam('id'), chat.deleteGroup);
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

// A class is identified either by its timetable period (`slotId` — required
// for faculty, whose date/time then come from the server) or, for HOD/admin
// edits, by subject + date + period + section.
const bySlot = (src) => (_v, { req }) => Boolean(req[src].slotId);
router.get('/attendance/my-periods', authorize('faculty', 'hod', 'admin'), attendance.getMyPeriods);
router.get(
  '/attendance/roster',
  authorize(...STAFF),
  query('slotId').optional().isMongoId(),
  query('subjectId').if((v, meta) => !bySlot('query')(v, meta)).isMongoId().withMessage('Subject is required'),
  dateField('date', query).optional(),
  query('period').if((v, meta) => !bySlot('query')(v, meta)).isInt({ min: 1, max: 12 }).withMessage('Period is required'),
  query('section').optional().trim().isLength({ max: 10 }),
  validate,
  attendance.getRoster
);
router.post(
  '/attendance/mark',
  writeLimiter,
  authorize(...STAFF),
  body('slotId').optional().isMongoId(),
  body('subjectId').if((v, meta) => !bySlot('body')(v, meta)).isMongoId().withMessage('Subject is required'),
  dateField('date').optional(),
  body('period').if((v, meta) => !bySlot('body')(v, meta)).isInt({ min: 1, max: 12 }).toInt(),
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
router.get('/attendance/sessions', authorize(...ATTENDANCE_VIEW_ROLES), ...rangeQuery, validate, attendance.listSessions);
router.get('/attendance/low', authorize(...ATTENDANCE_VIEW_ROLES), ...rangeQuery, validate, attendance.getLowAttendance);
router.get('/attendance/student/:id', idParam('id'), authorize(...ATTENDANCE_VIEW_ROLES), ...rangeQuery, validate, attendance.getStudentAttendance);
router.get('/attendance/subject/:subjectId', idParam('subjectId'), authorize(...ATTENDANCE_VIEW_ROLES), ...rangeQuery, validate, attendance.getSubjectAttendance);
router.get('/attendance/section', authorize(...ATTENDANCE_VIEW_ROLES), ...rangeQuery, validate, attendance.getSectionAttendance);

// "My Classes": attendance for a class the signed-in faculty member actually
// handles. The subject/section lists come from their teaching assignments and
// the backend re-checks the pair on every read.
router.get('/attendance/my-classes/options', authorize('faculty'), attendance.getMyClassOptions);
// "Our Class": the complete attendance of the faculty member's Class In-Charge
// class — no subject chosen; the class comes from the account.
router.get('/attendance/our-class', authorize('faculty'), ...rangeQuery, validate, attendance.getOurClassAttendance);
router.get(
  '/attendance/my-classes',
  authorize('faculty'),
  query('subjectId').isMongoId().withMessage('Subject is required'),
  query('section').optional({ values: 'falsy' }).trim().isLength({ max: 10 }),
  ...rangeQuery,
  validate,
  attendance.getMyClassAttendance
);

// Attendance reports. Faculty are limited to their teaching assignments and an
// HOD to their own department; a period report is refused until the period has
// finished on the server clock. Everything is enforced in the report service.
router.get('/attendance/reports/options', authorize(...ATTENDANCE_VIEW_ROLES), attendance.getReportOptions);
// Registered before /reports/:type so "periods" is never read as a report type.
router.get(
  '/attendance/reports/periods',
  authorize(...ATTENDANCE_VIEW_ROLES),
  query('scope').optional({ values: 'falsy' }).isIn(REPORT_SCOPES),
  query('subjectId').optional({ values: 'falsy' }).isMongoId(),
  query('section').optional({ values: 'falsy' }).trim().isLength({ max: 10 }),
  query('year').optional({ values: 'falsy' }).isIn(ACADEMIC_YEARS),
  query('semester').optional({ values: 'falsy' }).isInt({ min: 1, max: 12 }),
  dateField('date', query).optional({ values: 'falsy' }),
  validate,
  attendance.getReportPeriods
);
router.get(
  '/attendance/reports/:type',
  authorize(...ATTENDANCE_VIEW_ROLES),
  param('type').isIn(REPORT_TYPES).withMessage('Unknown report type'),
  query('format').optional({ values: 'falsy' }).isIn(['json', 'pdf']),
  query('subjectId').optional({ values: 'falsy' }).isMongoId(),
  query('section').optional({ values: 'falsy' }).trim().isLength({ max: 10 }),
  query('year').optional({ values: 'falsy' }).isIn(ACADEMIC_YEARS),
  query('semester').optional({ values: 'falsy' }).isInt({ min: 1, max: 12 }),
  // A period number, or "all" for every finished period of the date.
  query('period')
    .optional({ values: 'falsy' })
    .custom((v) => v === 'all' || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 12))
    .withMessage('Period must be 1–12 or all'),
  // Faculty: "class" = Our Class (Class In-Charge), "handling" = Handling Class.
  query('scope').optional({ values: 'falsy' }).isIn(REPORT_SCOPES).withMessage('Scope must be class or handling'),
  dateField('date', query).optional({ values: 'falsy' }),
  query('from').optional({ values: 'falsy' }).isISO8601(),
  query('to').optional({ values: 'falsy' }).isISO8601(),
  validate,
  attendance.getAttendanceReport
);

// Daily headcount for the college-wide roles / HOD (own department) dashboard.
const SUMMARY_VIEW = ATTENDANCE_SUMMARY_ROLES;
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
    o(body('section')).trim().toUpperCase().isIn(SECTIONS).withMessage('Choose a valid section'),
    o(body('department')).trim().isLength({ min: 1, max: 80 }).withMessage('Department is required'),
    o(body('dayOfWeek')).isIn(WEEKDAYS).withMessage('Choose a day'),
    o(body('period')).isInt({ min: 1, max: 12 }).toInt(),
    o(body('startTime')).matches(HHMM).withMessage('Start time must be HH:mm'),
    o(body('endTime')).matches(HHMM).withMessage('End time must be HH:mm'),
    o(body('semester')).isIn(SEMESTERS).withMessage('Choose a semester (1–8)').toInt(),
    body('room').optional().trim().isLength({ max: 60 }),
    yearMatchesSemester(),
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
// Warden/Security get zero access to any timetable-related endpoint, including
// the read-only ones — enforced here, not just by hiding the sidebar item.
router.get(
  '/timetable',
  authorize(...TIMETABLE_VIEW_ROLES),
  query('year').optional().isIn(ACADEMIC_YEARS).withMessage('Year must be 1–4'),
  query('semester').optional().isIn(SEMESTERS).withMessage('Semester must be 1–8'),
  // Faculty: `class` = their Class In-Charge class, `handling` = their own periods.
  query('scope').optional({ values: 'falsy' }).isIn(['class', 'handling']).withMessage('Scope must be class or handling'),
  validate,
  timetable.getMyTimetable
);
router.get('/timetable/current', authorize(...TIMETABLE_VIEW_ROLES), timetable.getCurrentClass);
// "My Schedule": the authenticated user's own weekly teaching periods. There
// is no faculty parameter — it is always the caller's own assignments.
router.get(
  '/timetable/my-schedule',
  authorize(...TIMETABLE_VIEW_ROLES),
  query('semester').optional({ values: 'falsy' }).isInt({ min: 1, max: 12 }),
  validate,
  timetable.getMySchedule
);
router.get('/timetable/faculty-options', authorize(...TIMETABLE_WRITE_ROLES), timetable.listFacultyOptions);
router.get('/timetable/section/:section', authorize(...TIMETABLE_VIEW_ROLES), param('section').trim().isLength({ min: 1, max: 10 }), validate, timetable.getSectionTimetable);
router.get('/timetable/faculty/:id', authorize(...TIMETABLE_VIEW_ROLES), idParam('id'), timetable.getFacultyTimetable);
router.get('/subjects', authorize(...TIMETABLE_VIEW_ROLES), timetable.listSubjects);
router.post('/subjects', writeLimiter, authorize(...TIMETABLE_WRITE_ROLES), ...subjectRules(), timetable.createSubject);
router.put('/subjects/:id', idParam('id'), authorize(...TIMETABLE_WRITE_ROLES), ...subjectRules(true), timetable.updateSubject);
router.delete('/subjects/:id', idParam('id'), authorize(...TIMETABLE_WRITE_ROLES), timetable.deleteSubject);
router.post('/timetable', writeLimiter, authorize(...TIMETABLE_WRITE_ROLES), ...slotRules(), timetable.createSlot);
router.put('/timetable/:id', idParam('id'), authorize(...TIMETABLE_WRITE_ROLES), ...slotRules(true), timetable.updateSlot);
router.delete('/timetable/:id', idParam('id'), authorize(...TIMETABLE_WRITE_ROLES), timetable.deleteSlot);

// ── Study Materials ────────────────────────────────────────────────
// Upload/edit/delete authorization is never role-only — the controller
// re-verifies the *current* timetable assignment (faculty) or department
// (HOD) for every write, never trusting department/section/semester/subject
// sent by the client.
const materialWriteRules = (optional = false) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body('title')).trim().isLength({ min: 2, max: 150 }).withMessage('Title is required'),
    body('description').optional().trim().isLength({ max: 1000 }),
    body('category').optional().isIn(STUDY_MATERIAL_CATEGORIES),
    o(body('subjectId')).isMongoId().withMessage('Choose a subject'),
    body('department').optional().trim().isLength({ max: 80 }),
    body('section').optional().trim().isLength({ max: 10 }),
    body('semester').optional().isInt({ min: 1, max: 12 }).toInt(),
    body('year').optional({ values: 'falsy' }).isInt({ min: 1, max: 6 }).toInt(),
    safeUrl('file.url'), // missing/invalid file.url is caught by the controller (422 "A file is required")
    body('file.name').optional().trim().isLength({ max: 150 }),
    body('file.mimeType').optional().trim().isLength({ max: 100 }),
    body('file.size').optional().isInt({ min: 0 }),
    validate,
  ];
};

router.get('/study-materials', authorize(...STUDY_MATERIAL_VIEW_ROLES), materials.listMaterials);
router.get('/study-materials/my-assignments', authorize('faculty'), materials.getMyAssignments);
router.get('/study-materials/:id', authorize(...STUDY_MATERIAL_VIEW_ROLES), idParam('id'), materials.getMaterial);
router.post('/study-materials', writeLimiter, authorize(...STUDY_MATERIAL_WRITE_ROLES), ...materialWriteRules(), materials.createMaterial);
router.put('/study-materials/:id', idParam('id'), authorize(...STUDY_MATERIAL_WRITE_ROLES), ...materialWriteRules(true), materials.updateMaterial);
router.delete('/study-materials/:id', idParam('id'), authorize(...STUDY_MATERIAL_WRITE_ROLES), materials.deleteMaterial);

// ── JNN Study Assistant (lives inside Study Materials) ─────────────
// Same audience as Study Materials. Retrieval scope is always derived from
// req.user in the service — useStudyMaterials/useWebSearch can only turn a
// source OFF, never widen access. The Groq key never leaves the backend.
router.post(
  '/ai/study-assistant/chat',
  authorize(...STUDY_MATERIAL_VIEW_ROLES),
  aiMinuteLimiter,
  aiHourLimiter,
  body('message')
    .isString()
    .withMessage('Please type a question')
    .bail()
    .trim()
    .isLength({ min: 1, max: env.ai.maxMessageLength })
    .withMessage(`Questions must be 1–${env.ai.maxMessageLength} characters`),
  body('conversationId').optional({ values: 'null' }).isMongoId().withMessage('Invalid conversation id'),
  body('useStudyMaterials').optional().isBoolean({ strict: true }),
  body('useWebSearch').optional().isBoolean({ strict: true }),
  body('stream').optional().isBoolean({ strict: true }),
  validate,
  ai.chat
);
router.get('/ai/study-assistant/conversations', authorize(...STUDY_MATERIAL_VIEW_ROLES), ai.listConversations);
router.get('/ai/study-assistant/conversations/:id', authorize(...STUDY_MATERIAL_VIEW_ROLES), idParam('id'), ai.getConversation);
router.delete('/ai/study-assistant/conversations/:id', authorize(...STUDY_MATERIAL_VIEW_ROLES), idParam('id'), ai.deleteConversation);

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
// Emergency: goes straight to the chosen authority. Student identity comes from the session.
router.post(
  '/gate-pass/emergency',
  writeLimiter,
  authorize(...STUDENT_ROLES),
  body('authority').isIn(EMERGENCY_AUTHORITIES).withMessage('Choose who to send it to: Principal, AO, Dean or Chairman'),
  body('reason').isString().trim().isLength({ min: 5, max: 500 }).withMessage('Please describe the emergency (5+ characters)'),
  body('destination').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Destination is required'),
  body('leaveAt').isISO8601().withMessage('Date and leaving time are required'),
  body('expectedReturnAt').isISO8601().withMessage('Expected return time is required'),
  safeUrl('supportingDocument.url'),
  body('supportingDocument.name').optional().isString().trim().isLength({ max: 200 }),
  body('supportingDocument.mimeType').optional().isString().trim().isLength({ max: 100 }),
  validate,
  gatePass.createEmergencyGatePass
);
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
// Return to campus: Security scans the return QR / types the return code (read-only).
const returnCodeRule = body('code').isString().trim().isLength({ min: 4, max: 80 }).withMessage('Return code is required');
router.post('/gate-pass/return/verify', verifyLimiter, authorize(...GATE_SECURITY), returnCodeRule, validate, gatePass.verifyReturnCredential);
router.get('/gate-pass/:id', idParam('id'), gatePass.getGatePass);
router.get('/gate-pass/:id/qr', idParam('id'), gatePass.getGatePassQr);
router.get('/gate-pass/:id/parent-otp', idParam('id'), authorize(...GATE_FACULTY), gatePass.getParentOtp);
router.post('/gate-pass/:id/parent-otp', otpLimiter, idParam('id'), authorize(...GATE_FACULTY), gatePass.requestParentOtp);
router.post(
  '/gate-pass/:id/parent-otp/verify',
  otpLimiter,
  idParam('id'),
  authorize(...GATE_FACULTY),
  body('otp')
    .isString()
    .trim()
    .custom((v) => new RegExp(`^\\d{${env.otp.length}}$`).test(v))
    .withMessage(`Enter the ${env.otp.length}-digit OTP`),
  validate,
  gatePass.verifyParentOtp
);
router.patch('/gate-pass/:id/faculty-review', authorize(...GATE_FACULTY), ...gateReviewRules(['forward', 'reject']), gatePass.facultyReview);
router.patch('/gate-pass/:id/hod-review', authorize(...GATE_HOD), ...gateReviewRules(['forward', 'reject']), gatePass.hodReview);
router.patch('/gate-pass/:id/principal-review', authorize(...GATE_PRINCIPAL), ...gateReviewRules(['approve', 'reject']), gatePass.principalReview);
router.patch('/gate-pass/:id/cancel', idParam('id'), gatePass.cancelGatePass);
// Only the authority the student chose may decide (checked in the controller).
router.patch('/gate-pass/:id/emergency-review', authorize(...EMERGENCY_AUTHORITIES), ...gateReviewRules(['approve', 'reject']), gatePass.emergencyReview);
router.patch(
  '/gate-pass/:id/out',
  verifyLimiter,
  idParam('id'),
  authorize(...GATE_SECURITY),
  body('code').isString().trim().isLength({ min: 4, max: 20 }).withMessage('Gate pass code is required'),
  validate,
  gatePass.recordOut
);
router.patch('/gate-pass/:id/in', verifyLimiter, idParam('id'), authorize(...GATE_SECURITY), returnCodeRule, validate, gatePass.recordIn);
// The student's one-shot location reading. Only raw readings are accepted; the server computes distance.
router.post(
  '/gate-pass/:id/return-location/verify',
  returnLocationLimiter,
  idParam('id'),
  authorize(...STUDENT_ROLES),
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude').toFloat(),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude').toFloat(),
  body('accuracy').isFloat({ min: 0, max: 100000 }).withMessage('Location accuracy is required').toFloat(),
  body('timestamp')
    .custom((v) => (typeof v === 'number' || typeof v === 'string') && Number.isFinite(new Date(v).getTime()))
    .withMessage('Location timestamp is required'),
  validate,
  gatePass.verifyReturnLocation
);
router.get('/gate-pass/:id/return-credential', idParam('id'), authorize(...STUDENT_ROLES), gatePass.getReturnCredential);
router.patch(
  '/gate-pass/:id/revoke',
  idParam('id'),
  authorize('admin', 'principal'),
  body('reason').optional().trim().isLength({ max: 300 }),
  validate,
  gatePass.revokeGatePass
);

// ── Development OTP portal — stand-in for the college SMS vendor ───
// Admins only. Not found in production unless DEV_OTP_PORTAL=true is set explicitly.
const devOnly = (_req, _res, next) => (env.isProd && !env.otp.devPortalInProduction ? next(new ApiError(404, 'Not found')) : next());
router.get('/dev/otp', devOnly, authorize('admin'), gatePass.listDevOtps);

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

// ── Complaints ─────────────────────────────────────────────────────
// Only students register complaints; routing/escalation is resolved server-side
// from the database, never from a client-supplied recipient.
const complaintCreateRules = [
  body('anonymous').optional().isBoolean().toBoolean(),
  body('category').isIn(COMPLAINT_CATEGORIES).withMessage('Choose a valid complaint category'),
  body('subCategory')
    .custom((v, { req }) => {
      const allowed = COMPLAINT_SUBCATEGORIES[req.body.category] || [];
      if (!allowed.length) return true;
      return allowed.includes(v);
    })
    .withMessage('Choose a valid subcategory'),
  body('escalateTo')
    .custom((v, { req }) => (COMPLAINT_ESCALATE_TO[req.body.category] || []).includes(String(v || '').toLowerCase()))
    .withMessage('Choose a valid authority to escalate to'),
  body('description').trim().isLength({ min: 10, max: 2000 }).withMessage('Describe the complaint (10–2000 characters)'),
  body('attachments').optional().isArray({ max: 5 }).withMessage('At most 5 supporting files'),
  body('attachments.*.url')
    .optional()
    .isString()
    .custom((v) => v.startsWith('/uploads/') || /^https:\/\//.test(v))
    .withMessage('Attachment must be an uploaded file or https URL'),
  body('attachments.*.name').optional().trim().isLength({ max: 150 }),
  body('attachments.*.mimeType').optional().trim().isLength({ max: 100 }),
];

router.post('/complaints', writeLimiter, authorize('student'), ...complaintCreateRules, validate, complaints.createComplaint);
router.get('/complaints', validate, complaints.listComplaints);
router.get('/complaints/dashboard', authorize('admin', 'chairman'), complaints.complaintDashboard);
router.get('/complaints/:id', idParam('id'), validate, complaints.getComplaint);
router.patch(
  '/complaints/:id/authority-update',
  idParam('id'),
  authorize(...COMPLAINT_AUTHORITY_ROLES, 'admin'),
  body('status').isIn(['IN_REVIEW', 'IN_PROGRESS', 'RESOLVED']),
  body('comment').optional().trim().isLength({ max: 500 }),
  validate,
  complaints.authorityUpdate
);
router.patch('/complaints/:id/not-resolved', idParam('id'), validate, complaints.markNotResolved);
router.patch('/complaints/:id/resolved', idParam('id'), validate, complaints.markResolved);
router.patch('/complaints/:id/cancel', idParam('id'), validate, complaints.cancelComplaint);

// ── Advanced Analytics ─────────────────────────────────────────────
router.get('/analytics/student', ...rangeQuery, validate, analytics.studentAnalytics);
router.get('/analytics/faculty', authorize(...STAFF_VIEW), ...rangeQuery, validate, analytics.facultyAnalytics);
router.get('/analytics/department', authorize(...STAFF_VIEW), ...rangeQuery, validate, analytics.departmentAnalytics);
router.get('/analytics/college', authorize('admin', 'principal'), ...rangeQuery, validate, analytics.collegeAnalytics);
router.get('/analytics/gate', authorize(...STAFF_VIEW), ...rangeQuery, validate, analytics.gateAnalytics);
router.get('/analytics/club/:id', param('id').isString().isLength({ min: 1, max: 80 }), ...rangeQuery, validate, analytics.clubAnalytics);

export default router;
