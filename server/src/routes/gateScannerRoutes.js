import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { gateScanLimiter } from '../middleware/rateLimit.js';
import { GATE_SCAN_DIRECTIONS, GATE_SCAN_OUTCOMES, GATE_SCAN_SOURCES } from '../models/GateScanEvent.js';
import * as scanner from '../controllers/gateScannerController.js';

/**
 * Windows Gate Scanner API (mounted at /gate-scanner, after protect and the
 * platform / password / terms gates). Security role only — the desktop app's
 * own session type is Security-only too, but these routes check the role
 * themselves so the web portal or a mobile Security session behaves the same.
 */
const router = Router();
router.use(authorize('security'));

const scanIdRule = (where) => where('scanId').isString().matches(/^[A-Za-z0-9-]{8,64}$/).withMessage('Invalid scan id');
const rangeRules = [
  query('range').optional().isIn(['today', 'yesterday', 'week', 'month', 'custom']).withMessage('Unknown range'),
  query('from').optional({ values: 'falsy' }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date must be YYYY-MM-DD'),
  query('to').optional({ values: 'falsy' }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date must be YYYY-MM-DD'),
  query('type').optional({ values: 'falsy' }).isIn(GATE_SCAN_DIRECTIONS).withMessage('Type must be in or out'),
  query('q').optional().isString().isLength({ max: 64 }),
  query('page').optional().isInt({ min: 1, max: 10000 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

router.get('/session', scanner.session);
router.get('/dashboard', scanner.dashboard);
router.post(
  '/scans',
  gateScanLimiter,
  scanIdRule(body),
  // Bounded here; the controller decides what the value is (and never stores it).
  body('payload').isString().isLength({ min: 1, max: 200 }).withMessage('Nothing was scanned'),
  body('source').optional().isIn(GATE_SCAN_SOURCES).withMessage('Unknown scan source'),
  body('kind').optional({ values: 'null' }).isIn(GATE_SCAN_DIRECTIONS).withMessage('Kind must be in or out'),
  validate,
  scanner.submitScan
);
router.get('/scans/:scanId', scanIdRule(param), validate, scanner.getScan);
router.get('/history', ...rangeRules, validate, scanner.history);
router.get(
  '/attempts',
  ...rangeRules,
  query('outcome').optional({ values: 'falsy' }).isIn(GATE_SCAN_OUTCOMES).withMessage('Unknown outcome'),
  validate,
  scanner.attempts
);

export default router;
