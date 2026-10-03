import { Router } from 'express';
import { body, query } from 'express-validator';
import { authorize } from '../middleware/auth.js';
import { idParam, validate } from '../middleware/validate.js';
import { authLimiter, writeLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { upload } from '../utils/storage.js';
import {
  MENTORSHIP_DOMAINS,
  MENTORSHIP_STATUSES,
  SESSION_MODES,
  JOB_TYPES,
  JOB_WORK_MODES,
  JOB_STATUSES,
  JOB_APPLY_MODES,
  ALUMNI_EVENT_TYPES,
  ALUMNI_EVENT_MODES,
  CHAPTER_TYPES,
} from '../constants.js';

import * as alumniProfile from '../controllers/alumni/alumniProfileController.js';
import * as mentorship from '../controllers/alumni/mentorshipController.js';
import * as alumniJobs from '../controllers/alumni/alumniJobsController.js';
import * as alumniEvents from '../controllers/alumni/alumniEventsController.js';
import * as alumniChapters from '../controllers/alumni/alumniChaptersController.js';
import * as alumniImport from '../controllers/alumni/alumniImportController.js';
import * as alumniAnalytics from '../controllers/alumni/alumniAnalyticsController.js';
import * as alumniDashboard from '../controllers/alumni/alumniDashboardController.js';

// ── Public claim router (mounted at /auth/alumni-claim) ────────────
export const alumniPublicRouter = Router();

alumniPublicRouter.get('/:token', authLimiter, alumniImport.getPublicClaim);
alumniPublicRouter.post(
  '/:token',
  authLimiter,
  body('password')
    .isString()
    .isLength({ min: 8, max: 72 })
    .withMessage('Password must be 8–72 characters')
    .matches(/[A-Za-z]/)
    .withMessage('Password must contain a letter')
    .matches(/\d/)
    .withMessage('Password must contain a number'),
  body('accept').isBoolean().withMessage('You must accept the invitation'),
  validate,
  alumniImport.submitPublicClaim
);

// ── Mentorship requests router (mounted at /mentorship-requests) ───
export const mentorshipRequestsRouter = Router();

mentorshipRequestsRouter.post(
  '/',
  authorize('student'),
  writeLimiter,
  body('alumni').isMongoId().withMessage('Valid alumni ID required'),
  body('domain').isIn(MENTORSHIP_DOMAINS).withMessage('Valid mentorship domain required'),
  body('message').trim().isLength({ min: 5, max: 500 }).withMessage('Message must be 5–500 characters'),
  validate,
  mentorship.createRequest
);

mentorshipRequestsRouter.get(
  '/',
  query('status').optional().isIn(MENTORSHIP_STATUSES),
  query('page').optional().isInt({ min: 1 }),
  validate,
  mentorship.listRequests
);

mentorshipRequestsRouter.get('/:id', idParam('id'), validate, mentorship.getRequestById);

mentorshipRequestsRouter.patch(
  '/:id',
  idParam('id'),
  authorize('alumni', 'admin'),
  body('status').isIn(['accepted', 'declined']).withMessage('Status must be accepted or declined'),
  body('response').optional().trim().isLength({ max: 500 }),
  validate,
  mentorship.respondToRequest
);

mentorshipRequestsRouter.patch(
  '/:id/respond',
  idParam('id'),
  authorize('alumni', 'admin'),
  body('status').isIn(['accepted', 'declined']).withMessage('Status must be accepted or declined'),
  body('response').optional().trim().isLength({ max: 500 }),
  validate,
  mentorship.respondToRequest
);

mentorshipRequestsRouter.patch(
  '/:id/cancel',
  idParam('id'),
  body('reason').optional().trim().isLength({ max: 500 }),
  validate,
  mentorship.cancelRequest
);

mentorshipRequestsRouter.patch(
  '/:id/complete',
  idParam('id'),
  authorize('alumni', 'admin'),
  validate,
  mentorship.completeRequest
);

mentorshipRequestsRouter.patch(
  '/:id/rate',
  idParam('id'),
  authorize('student'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1–5'),
  body('review').optional().trim().isLength({ max: 500 }),
  body('feedback').optional().trim().isLength({ max: 500 }),
  validate,
  mentorship.rateRequest
);

mentorshipRequestsRouter.patch(
  '/:id/goals',
  idParam('id'),
  body('goals').isArray({ max: 5 }).withMessage('Max 5 goals allowed'),
  body('goals.*.text').trim().isLength({ min: 1, max: 200 }),
  body('goals.*.done').optional().isBoolean(),
  validate,
  mentorship.updateGoals
);

// ── Mentorship slots & sessions router (mounted at /mentorship) ─────
export const mentorshipRouter = Router();

mentorshipRouter.get(
  '/slots',
  query('alumni').optional().isMongoId(),
  validate,
  mentorship.listSlots
);

mentorshipRouter.post(
  '/slots',
  authorize('alumni', 'admin'),
  writeLimiter,
  body('slots').isArray({ min: 1, max: 20 }).withMessage('Must provide 1–20 slots'),
  body('slots.*.startsAt').isISO8601().withMessage('Valid start time required'),
  body('slots.*.durationMin').isInt({ min: 15, max: 180 }).withMessage('Duration must be 15–180 minutes'),
  body('slots.*.mode').isIn(SESSION_MODES).withMessage('Valid mode required'),
  body('slots.*.meetingLink').optional({ values: 'falsy' }).isURL().withMessage('Meeting link must be a valid URL'),
  body('slots.*.note').optional().trim().isLength({ max: 300 }),
  validate,
  mentorship.createSlots
);

mentorshipRouter.delete('/slots/:id', idParam('id'), authorize('alumni', 'admin'), validate, mentorship.deleteSlot);

mentorshipRouter.post(
  '/sessions',
  authorize('student'),
  writeLimiter,
  body('request').isMongoId().withMessage('Valid mentorship request ID required'),
  body('slot').isMongoId().withMessage('Valid slot ID required'),
  body('agenda').optional().trim().isLength({ max: 300 }),
  validate,
  mentorship.bookSession
);

mentorshipRouter.get(
  '/sessions',
  query('scope').optional().isIn(['upcoming', 'past']),
  validate,
  mentorship.listSessions
);

mentorshipRouter.patch(
  '/sessions/:id/reschedule',
  idParam('id'),
  body('slot').isMongoId().withMessage('Valid slot ID required'),
  validate,
  mentorship.rescheduleSession
);

mentorshipRouter.patch(
  '/sessions/:id/cancel',
  idParam('id'),
  body('reason').optional().trim().isLength({ max: 500 }),
  validate,
  mentorship.cancelSession
);

mentorshipRouter.patch(
  '/sessions/:id/complete',
  idParam('id'),
  authorize('alumni', 'admin'),
  body('outcome').optional().isIn(['completed', 'no_show']),
  validate,
  mentorship.completeSession
);

mentorshipRouter.patch(
  '/sessions/:id/notes',
  idParam('id'),
  body('sharedNotes').optional().trim().isLength({ max: 2000 }),
  body('alumniPrivateNotes').optional().trim().isLength({ max: 2000 }),
  body('actionItems').optional().isArray({ max: 10 }),
  validate,
  mentorship.updateSessionNotes
);

mentorshipRouter.post('/requests/:id/message', idParam('id'), validate, mentorship.messageMentor);

// ── Main Alumni Router (mounted at /alumni) ────────────────────────
export const alumniRouter = Router();

// Subrouter aliases so /alumni/mentorship-requests and /alumni/mentorship also work
alumniRouter.use('/mentorship-requests', mentorshipRequestsRouter);
alumniRouter.use('/mentorship', mentorshipRouter);

// 0. Alumni dashboard (alumni role only)
alumniRouter.get('/dashboard', authorize('alumni'), alumniDashboard.getAlumniDashboard);

// 1. My Profile & Directory Filters
alumniRouter.get('/me', alumniProfile.getMyProfile);
alumniRouter.put(
  '/me',
  // Only alumni accounts have an alumni profile — a student must not be able
  // to create one (and so pose as a graduate in the directory).
  authorize('alumni'),
  writeLimiter,
  body('gradYear').optional({ values: 'null' }).isInt({ min: 1970, max: new Date().getFullYear() + 1 }),
  body('company').optional().trim().isLength({ max: 120 }),
  body('designation').optional().trim().isLength({ max: 120 }),
  body('currentLocation').optional().trim().isLength({ max: 120 }),
  body('skills').optional().isArray({ max: 30 }),
  body('domains').optional().isArray({ max: 10 }),
  body('mentorshipAvailable').optional().isBoolean(),
  body('maxActiveMentees').optional().isInt({ min: 0, max: 20 }),
  body('openToReferrals').optional().isBoolean(),
  body('showInDirectory').optional().isBoolean(),
  body('privacy').optional().isObject(),
  body('social').optional().isObject(),
  validate,
  alumniProfile.updateMyProfile
);
alumniRouter.get('/filters', alumniProfile.getAlumniFilters);

// 2. Jobs & Applications
alumniRouter.get(
  '/jobs',
  query('search').optional().trim().isLength({ max: 100 }),
  query('type').optional().isIn(JOB_TYPES),
  query('workMode').optional().isIn(JOB_WORK_MODES),
  query('status').optional().isIn(JOB_STATUSES),
  query('mine').optional().isBoolean(),
  validate,
  alumniJobs.listJobs
);

alumniRouter.post(
  '/jobs',
  authorize('alumni', 'faculty', 'hod', 'admin'),
  writeLimiter,
  body('title').trim().isLength({ min: 3, max: 120 }).withMessage('Title must be 3–120 characters'),
  body('company').trim().isLength({ min: 2, max: 120 }).withMessage('Company must be 2–120 characters'),
  body('location').trim().isLength({ min: 2, max: 120 }).withMessage('Location must be 2–120 characters'),
  body('type').isIn(JOB_TYPES).withMessage('Valid job type required'),
  body('workMode').isIn(JOB_WORK_MODES).withMessage('Valid work mode required'),
  body('description').trim().isLength({ min: 20, max: 4000 }).withMessage('Description must be 20–4000 characters'),
  body('applyMode').isIn(JOB_APPLY_MODES).withMessage('Valid apply mode required'),
  body('externalUrl').optional({ values: 'falsy' }).isURL().withMessage('Valid external URL required'),
  body('deadline').isISO8601().withMessage('Valid deadline required'),
  validate,
  alumniJobs.createJob
);

alumniRouter.get('/jobs/:id', idParam('id'), validate, alumniJobs.getJobById);
alumniRouter.patch('/jobs/:id', idParam('id'), validate, alumniJobs.updateJob);
alumniRouter.patch('/jobs/:id/close', idParam('id'), validate, alumniJobs.closeJob);
alumniRouter.patch('/jobs/:id/reopen', idParam('id'), validate, alumniJobs.reopenJob);
alumniRouter.delete(
  '/jobs/:id',
  idParam('id'),
  body('reason').optional().trim().isLength({ max: 300 }),
  validate,
  alumniJobs.removeJob
);

alumniRouter.post(
  '/jobs/:id/apply',
  idParam('id'),
  authorize('student'),
  writeLimiter,
  body('note').optional().trim().isLength({ max: 500 }),
  // A web link only: javascript:/data: URLs would run in the poster's browser.
  body('resumeUrl')
    .optional({ values: 'falsy' })
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Resume link must be an http(s) URL'),
  body('referralRequested').optional().isBoolean(),
  validate,
  alumniJobs.applyToJob
);

alumniRouter.get('/jobs/:id/applications', idParam('id'), validate, alumniJobs.listJobApplications);
alumniRouter.get('/job-applications/mine', authorize('student'), validate, alumniJobs.listMyJobApplications);
alumniRouter.patch(
  '/job-applications/:id',
  idParam('id'),
  body('status').isIn(['pending', 'referred', 'shortlisted', 'rejected', 'hired']),
  body('posterNote').optional().trim().isLength({ max: 500 }),
  validate,
  alumniJobs.updateApplication
);
alumniRouter.patch('/job-applications/:id/withdraw', idParam('id'), authorize('student'), validate, alumniJobs.withdrawApplication);

// 3. Events
alumniRouter.get(
  '/events',
  query('when').optional().isIn(['upcoming', 'past', 'mine', 'pending']),
  validate,
  alumniEvents.listEvents
);

alumniRouter.post(
  '/events',
  authorize('alumni', 'faculty', 'hod', 'admin'),
  writeLimiter,
  body('title').trim().isLength({ min: 3, max: 140 }).withMessage('Title must be 3–140 characters'),
  body('type').isIn(ALUMNI_EVENT_TYPES).withMessage('Valid event type required'),
  body('mode').isIn(ALUMNI_EVENT_MODES).withMessage('Valid event mode required'),
  body('startsAt').isISO8601().withMessage('Valid start time required'),
  body('endsAt').isISO8601().withMessage('Valid end time required'),
  body('description').trim().isLength({ min: 20, max: 4000 }).withMessage('Description must be 20–4000 characters'),
  validate,
  alumniEvents.createEvent
);

alumniRouter.get('/events/:id', idParam('id'), validate, alumniEvents.getEventById);
alumniRouter.patch('/events/:id', idParam('id'), validate, alumniEvents.updateEvent);
alumniRouter.post('/events/:id/approve', idParam('id'), authorize('admin', 'hod'), validate, alumniEvents.approveEvent);
alumniRouter.post(
  '/events/:id/reject',
  idParam('id'),
  authorize('admin', 'hod'),
  body('reason').trim().isLength({ min: 5, max: 300 }).withMessage('Rejection reason required (5–300 chars)'),
  validate,
  alumniEvents.rejectEvent
);
alumniRouter.post(
  '/events/:id/cancel',
  idParam('id'),
  body('reason').optional().trim().isLength({ max: 300 }),
  validate,
  alumniEvents.cancelEvent
);
alumniRouter.post('/events/:id/rsvp', idParam('id'), writeLimiter, validate, alumniEvents.rsvpEvent);
alumniRouter.delete('/events/:id/rsvp', idParam('id'), validate, alumniEvents.cancelRsvp);
alumniRouter.get('/events/:id/attendees', idParam('id'), validate, alumniEvents.listAttendees);
alumniRouter.post(
  '/events/:id/checkin',
  idParam('id'),
  body('userId').isMongoId().withMessage('Valid user ID required'),
  validate,
  alumniEvents.checkInAttendee
);

// 4. Chapters
alumniRouter.get(
  '/chapters',
  query('type').optional().isIn(CHAPTER_TYPES),
  query('mine').optional().isBoolean(),
  validate,
  alumniChapters.listChapters
);

alumniRouter.post(
  '/chapters',
  authorize('admin', 'hod'),
  body('name').trim().isLength({ min: 3, max: 80 }).withMessage('Name must be 3–80 characters'),
  body('type').isIn(CHAPTER_TYPES).withMessage('Valid chapter type required'),
  body('description').trim().isLength({ min: 10, max: 1000 }).withMessage('Description must be 10–1000 characters'),
  validate,
  alumniChapters.createChapter
);

alumniRouter.get('/chapters/:slug', validate, alumniChapters.getChapterBySlug);
alumniRouter.patch('/chapters/:slug', validate, alumniChapters.updateChapter);
alumniRouter.delete('/chapters/:slug', authorize('admin'), validate, alumniChapters.archiveChapter);
alumniRouter.post('/chapters/:slug/join', authorize('alumni', 'faculty', 'hod', 'admin'), validate, alumniChapters.joinChapter);
alumniRouter.delete('/chapters/:slug/join', validate, alumniChapters.leaveChapter);
alumniRouter.patch(
  '/chapters/:slug/members/:userId',
  idParam('userId'),
  body('status').isIn(['active', 'removed']),
  validate,
  alumniChapters.approveMember
);
alumniRouter.get('/chapters/:slug/members', validate, alumniChapters.listMembers);
alumniRouter.get('/chapters/:slug/posts', validate, alumniChapters.listPosts);
alumniRouter.post(
  '/chapters/:slug/posts',
  writeLimiter,
  body('body').trim().isLength({ min: 1, max: 2000 }).withMessage('Post content required (1–2000 characters)'),
  validate,
  alumniChapters.createPost
);
alumniRouter.delete('/chapters/posts/:id', idParam('id'), validate, alumniChapters.deletePost);
alumniRouter.patch('/chapters/posts/:id/pin', idParam('id'), validate, alumniChapters.pinPost);
alumniRouter.post('/chapters/posts/:id/like', idParam('id'), validate, alumniChapters.toggleLikePost);
alumniRouter.get('/chapters/posts/:id/comments', idParam('id'), validate, alumniChapters.listComments);
alumniRouter.post(
  '/chapters/posts/:id/comments',
  idParam('id'),
  writeLimiter,
  body('body').trim().isLength({ min: 1, max: 500 }).withMessage('Comment must be 1–500 characters'),
  validate,
  alumniChapters.addComment
);
alumniRouter.delete('/chapters/comments/:id', idParam('id'), validate, alumniChapters.deleteComment);

// 5. Bulk Import & Invites
alumniRouter.post(
  '/import/preview',
  authorize('admin', 'hod'),
  uploadLimiter,
  upload.single('file'),
  validate,
  alumniImport.previewImport
);

alumniRouter.post(
  '/import/:batchId/commit',
  idParam('batchId'),
  authorize('admin', 'hod'),
  body('sendEmails').optional().isBoolean(),
  validate,
  alumniImport.commitImport
);

alumniRouter.get('/import', authorize('admin', 'hod'), validate, alumniImport.listImports);
alumniRouter.get('/import/:id', idParam('id'), authorize('admin', 'hod'), validate, alumniImport.getImportBatch);
alumniRouter.get('/invites', authorize('admin', 'hod'), validate, alumniImport.listInvites);
alumniRouter.post('/invites/:id/resend', idParam('id'), authorize('admin', 'hod'), validate, alumniImport.resendInvite);
alumniRouter.patch('/invites/:id/revoke', idParam('id'), authorize('admin', 'hod'), validate, alumniImport.revokeInvite);

// 6. Analytics & Export
alumniRouter.get('/analytics', authorize('admin', 'hod', 'principal', 'dean', 'chairman'), validate, alumniAnalytics.getAlumniAnalytics);
alumniRouter.get('/analytics/export', authorize('admin', 'hod'), validate, alumniAnalytics.exportDirectoryCSV);

// 7. Verification & Directory (parameterised routes placed last to avoid collision)
alumniRouter.patch('/:id/verify', idParam('id'), authorize('admin', 'hod'), validate, alumniProfile.verifyAlumniProfile);
alumniRouter.post(
  '/:id/reject',
  idParam('id'),
  authorize('admin', 'hod'),
  body('reason').trim().isLength({ min: 5, max: 300 }).withMessage('Rejection reason required (5–300 chars)'),
  validate,
  alumniProfile.rejectAlumniProfile
);

alumniRouter.get('/', validate, alumniProfile.listAlumniDirectory);
alumniRouter.get('/:userId', idParam('userId'), validate, alumniProfile.getAlumniProfile);

export default alumniRouter;
