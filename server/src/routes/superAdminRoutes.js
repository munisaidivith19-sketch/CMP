import { Router } from 'express';
import { body, query } from 'express-validator';
import { authorize } from '../middleware/auth.js';
import { idParam, validate } from '../middleware/validate.js';
import { requireRecentReauth } from '../middleware/platform.js';
import { aiMinuteLimiter, reauthLimiter, socRunLimiter, superAdminWriteLimiter } from '../middleware/rateLimit.js';
import { ACADEMIC_YEARS, CONVERSATION_TYPES, DEPARTMENTS, GENDERS, SECTIONS, SUPER_ADMIN_ROLE, TITLES } from '../constants.js';
import { OTP_STATUSES } from '../models/OutpassOtp.js';
import * as security from '../controllers/securityController.js';
import { PLATFORM_MODES } from '../models/PlatformState.js';
import { AUDIT_ACTIONS } from '../models/AuditLog.js';
import { SECURITY_EVENTS } from '../models/SecurityLog.js';
import * as sa from '../controllers/superAdminController.js';
import * as soc from '../controllers/socController.js';
import { ERROR_SEVERITIES, ERROR_SOURCES, ERROR_STATUSES } from '../models/ErrorEvent.js';
import { INCIDENT_ASSESSMENTS, INCIDENT_SEVERITIES, INCIDENT_STATUSES } from '../models/Incident.js';
import { RUN_STATUSES } from '../models/DiagnosticRun.js';
import { RANGES } from '../services/soc/detections.js';

/**
 * /api/super-admin/* — mounted after protect, the platform gate and the
 * confined-role guard. Every route is Super Admin only; sensitive writes also
 * need a password re-entry on this session within the last five minutes.
 */
const router = Router();
router.use(authorize(SUPER_ADMIN_ROLE));

const password = (field) =>
  body(field)
    .isString()
    .isLength({ min: 10, max: 72 })
    .withMessage('Temporary password must be 10–72 characters')
    .matches(/[A-Za-z]/)
    .withMessage('Password must contain a letter')
    .matches(/\d/)
    .withMessage('Password must contain a number')
    .matches(/[^A-Za-z0-9]/)
    .withMessage('Password must contain a symbol');
const profileRules = (create) => [
  (create ? body('name') : body('name').optional()).isString().trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2–80 characters'),
  body('title').optional({ values: 'falsy' }).isIn(TITLES).withMessage('Choose Ms, Mr or Dr'),
  body('gender').optional({ values: 'falsy' }).isIn(GENDERS).withMessage('Choose a gender'),
  body('phone').optional({ values: 'falsy' }).isString().trim().matches(/^[0-9+\-\s()]{6,20}$/).withMessage('Enter a valid phone number'),
  (create ? body('employeeId') : body('employeeId').optional()).isString().trim().isLength({ min: 1, max: 30 }).withMessage('Employee ID is required'),
];
const reason = body('reason').isString().trim().isLength({ min: 5, max: 500 }).withMessage('Give a reason (5–500 characters)');
const sensitive = [superAdminWriteLimiter, requireRecentReauth];

router.post('/reauth', reauthLimiter, body('password').isString().notEmpty().withMessage('Password is required'), validate, sa.reauth);

router.get('/overview', sa.overview);
router.get('/policies/catalogue', sa.policyCatalogue);

// Admin accounts.
router.get(
  '/admins',
  query('q').optional().isString().trim().isLength({ max: 64 }),
  query('status').optional().isIn(['active', 'inactive']),
  validate,
  sa.listAdmins
);
router.post(
  '/admins',
  ...sensitive,
  ...profileRules(true),
  body('email').isString().trim().isEmail().withMessage('Enter a valid email').normalizeEmail({ gmail_remove_dots: false }),
  password('password'),
  body('policies').optional().isArray({ max: 40 }),
  validate,
  sa.createAdmin
);
router.patch('/admins/:id', idParam('id'), ...sensitive, ...profileRules(false), validate, sa.updateAdmin);
router.post('/admins/:id/status', idParam('id'), ...sensitive, body('isActive').isBoolean().withMessage('isActive must be true or false').toBoolean(), reason, validate, sa.setAdminStatus);
router.post(
  '/admins/:id/reset-password',
  idParam('id'),
  ...sensitive,
  password('newPassword'),
  body('confirmPassword').custom((v, { req }) => v === req.body.newPassword).withMessage('Passwords do not match'),
  reason,
  validate,
  sa.resetAdminPassword
);
router.post('/admins/:id/revoke-sessions', idParam('id'), ...sensitive, sa.revokeAdminSessions);
router.put('/admins/:id/policies', idParam('id'), ...sensitive, body('policies').isArray({ max: 40 }).withMessage('Policies must be a list'), validate, sa.setAdminPolicies);
// Dashboard modules as checkboxes: exactly the ticked module keys (policies.js → modulesToPolicies).
router.put('/admins/:id/modules', idParam('id'), ...sensitive, body('modules').isArray({ max: 40 }).withMessage('Modules must be a list'), body('modules.*').isString().isLength({ max: 40 }), validate, sa.setAdminModules);
// Delegation limits: which roles the Admin may create / assign and the most it may delegate.
router.put('/admins/:id/delegation', idParam('id'), ...sensitive, body('delegation').isObject().withMessage('Delegation must be an object'), validate, sa.setAdminDelegation);
router.get('/admins/:id/events', idParam('id'), sa.adminEvents);

// Security center.
router.get(
  '/security/events',
  query('event').optional().isIn(SECURITY_EVENTS),
  query('success').optional().isIn(['true', 'false']),
  query('q').optional().isString().trim().isLength({ max: 64 }),
  query('from').optional().isISO8601().withMessage('Invalid "from" date'),
  query('to').optional().isISO8601().withMessage('Invalid "to" date'),
  validate,
  sa.securityEvents
);
router.get('/security/suspicious-logins', sa.suspiciousLogins);
router.get('/security/audit', query('action').optional().isIn(AUDIT_ACTIONS), validate, sa.auditTrail);

// Parent gate-pass OTP cards (moved here from Admin → Security & Logs).
const rangeRules = [
  query('range').optional().isIn(['today', 'yesterday', '7d', '30d', 'custom', 'all']).withMessage('Unknown date range'),
  query('from').optional().isISO8601({ strict: true }).withMessage('Invalid "from" date'),
  query('to').optional().isISO8601({ strict: true }).withMessage('Invalid "to" date'),
];
router.get(
  '/security/otps',
  query('q').optional().isString().trim().isLength({ max: 64 }),
  query('department').optional().isIn(DEPARTMENTS).withMessage('Unknown department'),
  query('year').optional().isIn(ACADEMIC_YEARS.map(String)).withMessage('Year must be 1–4'),
  query('section').optional().trim().toUpperCase().isIn(SECTIONS).withMessage('Unknown section'),
  query('status').optional().isIn(OTP_STATUSES).withMessage('Unknown status'),
  ...rangeRules,
  validate,
  security.listOtps
);

// Chats: read-only.
router.get('/chats', query('q').optional().isString().trim().isLength({ max: 64 }), query('type').optional().isIn(CONVERSATION_TYPES), validate, sa.listChats);
router.get('/chats/:id/messages', idParam('id'), sa.chatMessages);

// Monitoring and recovery (read-only).
router.get('/monitoring', sa.monitoring);
router.get('/recovery', sa.recoveryStatus);

// Emergency control. The UI page is unlinked; the APIs are what is protected.
router.get('/emergency/state', sa.emergencyState);
router.post(
  '/emergency/transition',
  ...sensitive,
  body('to').isIn(PLATFORM_MODES).withMessage('Unknown mode'),
  body('expectedVersion').isInt({ min: 0 }).withMessage('expectedVersion is required').toInt(),
  body('confirm').isString().isLength({ max: 40 }),
  reason,
  body('message').optional({ values: 'falsy' }).isString().trim().isLength({ max: 300 }),
  validate,
  sa.emergencyTransition
);
router.post('/emergency/health-check', ...sensitive, sa.emergencyHealthCheck);

// ── SOC and troubleshooting (read-only diagnostics; audited state changes) ──
const range = query('range').optional().isIn(Object.keys(RANGES)).withMessage('Unknown range');
const ids = (field) => body(field).optional().isArray({ max: 50 }).withMessage(`${field} must be a list`);
router.get('/soc/overview', range, validate, soc.overview);
router.get('/soc/alerts', range, validate, soc.alerts);
router.get(
  '/soc/errors',
  query('q').optional().isString().trim().isLength({ max: 64 }),
  query('source').optional().isIn(ERROR_SOURCES),
  query('severity').optional().isIn(ERROR_SEVERITIES),
  query('status').optional().isIn(ERROR_STATUSES),
  query('classification').optional().isIn(['classified', 'unclassified']),
  query('module').optional().isString().trim().matches(/^[a-z_]{1,40}$/),
  query('code').optional().isString().trim().matches(/^[A-Z][A-Z0-9_]{1,59}$/),
  query('environment').optional().isString().trim().matches(/^[a-z0-9_-]{1,20}$/i),
  query('correlationId').optional().isString().trim().matches(/^[A-Za-z0-9._-]{8,64}$/),
  query('from').optional().isISO8601().withMessage('Invalid "from" date'),
  query('to').optional().isISO8601().withMessage('Invalid "to" date'),
  range,
  validate,
  soc.listErrors
);
router.get('/soc/errors/:id', idParam('id'), soc.getError);
router.post('/soc/errors/:id/status', idParam('id'), superAdminWriteLimiter, body('status').isIn(ERROR_STATUSES).withMessage('Unknown status'), body('note').optional({ values: 'falsy' }).isString().isLength({ max: 1000 }), validate, soc.setErrorStatus);
router.post('/soc/errors/:id/notes', idParam('id'), superAdminWriteLimiter, body('text').isString().trim().isLength({ min: 2, max: 1000 }).withMessage('Write a note (2–1000 characters)'), validate, soc.addErrorNote);
router.post('/soc/errors/:id/verify', idParam('id'), socRunLimiter, soc.verifyError);
router.post('/soc/errors/:id/ai-explain', idParam('id'), aiMinuteLimiter, soc.aiExplain);

router.get('/soc/diagnostics', query('errorId').optional().isMongoId(), validate, soc.listDiagnostics);
router.post(
  '/soc/diagnostics/run',
  socRunLimiter,
  body('testId').isString().matches(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/).withMessage('Unknown diagnostic test'),
  body('errorId').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid error'),
  validate,
  soc.runDiagnostic
);
router.get('/soc/diagnostics/runs', query('errorId').optional().isMongoId(), query('testId').optional().isString().isLength({ max: 60 }), query('status').optional().isIn(RUN_STATUSES), validate, soc.listRuns);
router.get('/soc/diagnostics/runs/:id', idParam('id'), soc.getRun);
router.post('/soc/diagnostics/runs/:id/cancel', idParam('id'), soc.cancelDiagnostic);

router.get('/soc/incidents', query('status').optional().isIn(INCIDENT_STATUSES), query('severity').optional().isIn(INCIDENT_SEVERITIES), query('assessment').optional().isIn(INCIDENT_ASSESSMENTS), query('q').optional().isString().trim().isLength({ max: 64 }), validate, soc.listIncidents);
router.get('/soc/incidents/assignees', soc.superAdmins);
router.post(
  '/soc/incidents',
  superAdminWriteLimiter,
  body('title').isString().trim().isLength({ min: 3, max: 200 }).withMessage('Title must be 3–200 characters'),
  body('summary').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }),
  body('category').optional().isIn(['security', 'reliability', 'other']),
  body('severity').optional().isIn(INCIDENT_SEVERITIES),
  body('assessment').optional().isIn(['undetermined', 'suspected']).withMessage('A new incident is undetermined or suspected; confirm it later with evidence'),
  body('assignee').optional({ values: 'falsy' }).isMongoId(),
  ids('errorIds'),
  ids('securityEventIds'),
  ids('runIds'),
  body('alert').optional().isObject(),
  validate,
  soc.createIncident
);
router.get('/soc/incidents/:id', idParam('id'), soc.getIncident);
router.patch(
  '/soc/incidents/:id',
  idParam('id'),
  superAdminWriteLimiter,
  body('status').optional().isIn(INCIDENT_STATUSES),
  body('severity').optional().isIn(INCIDENT_SEVERITIES),
  body('assessment').optional().isIn(INCIDENT_ASSESSMENTS),
  body('assessmentNote').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }),
  body('assignee').optional({ values: 'null' }).custom((v) => v === '' || v === null || /^[a-f0-9]{24}$/i.test(v)).withMessage('Invalid assignee'),
  body('resolution').optional().isString().isLength({ max: 2000 }),
  ids('addErrorIds'),
  ids('addRunIds'),
  ids('addSecurityEventIds'),
  validate,
  soc.updateIncident
);
router.post('/soc/incidents/:id/notes', idParam('id'), superAdminWriteLimiter, body('text').isString().trim().isLength({ min: 2, max: 2000 }).withMessage('Write a note (2–2000 characters)'), validate, soc.addIncidentNote);

router.get('/soc/health', soc.health);
router.post('/soc/health/run', socRunLimiter, soc.health);
router.get('/soc/catalog', soc.catalog);
router.get('/soc/catalog/:code', soc.catalogEntry);
router.get('/soc/coverage', soc.coverage);

export default router;
