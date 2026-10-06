import SOSAlert from '../models/SOSAlert.js';
import { SOS_BROADCAST_ROLES, SOS_RESPONDER_ROLES } from '../constants.js';
import { ApiError, asyncHandler, pageMeta, paginate, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyRoles, notifyUsers } from '../utils/notify.js';
import { emitToRoles } from '../config/socket.js';

const USER_FIELDS = 'name avatar department section rollNo phone';

// One account can raise a few alerts in a burst (a genuine emergency may need a
// retry), but not flood every campus user with notifications.
const SOS_BURST_LIMIT = 5;
const SOS_BURST_WINDOW_MS = 10 * 60 * 1000;

// Everyone on campus is alerted, but the sender's phone, roll number and GPS
// position go only to the responders who act on the alert.
const SOS_BYSTANDER_ROLES = SOS_BROADCAST_ROLES.filter((r) => !SOS_RESPONDER_ROLES.includes(r));
const bystanderView = (a) => ({
  _id: a._id,
  alertId: a.alertId,
  type: a.type,
  note: a.note,
  status: a.status,
  department: a.department,
  section: a.section,
  createdAt: a.createdAt,
  user: a.user && { _id: a.user._id, name: a.user.name, avatar: a.user.avatar, department: a.user.department },
  triggeredBy: a.triggeredBy,
});

const CLOSED = ['resolved', 'false_alarm'];

export const createAlert = asyncHandler(async (req, res) => {
  const data = pick(req.body, ['type', 'note', 'location']);
  data.user = req.user._id;
  data.department = req.user.department;
  data.section = req.user.section;
  data.status = 'active';

  const recent = await SOSAlert.countDocuments({ user: req.user._id, createdAt: { $gte: new Date(Date.now() - SOS_BURST_WINDOW_MS) } });
  if (recent >= SOS_BURST_LIMIT) {
    throw new ApiError(429, 'You have raised several alerts in the last few minutes. Responders have been notified — please call campus security directly.');
  }

  const alert = await SOSAlert.create(data);
  logActivity(req, 'sos.create', { entityType: 'sos', entityId: alert._id, summary: data.type });

  const populated = await SOSAlert.findById(alert._id).populate('user', USER_FIELDS).lean();

  // Persisted notification + push to every campus role (sender excluded)
  await notifyRoles(
    SOS_BROADCAST_ROLES,
    {
      type: 'sos',
      title: alert.type === 'fire' ? '🚨 FIRE EMERGENCY ALERT' : `Campus SOS: ${alert.type.toUpperCase()}`,
      message: `${req.user.name} (${alert.department || 'Campus'}${alert.section ? ' - ' + alert.section : ''}) triggered an emergency alert${alert.note ? ': "' + alert.note + '"' : ''}`,
      link: '/sos',
    },
    { exclude: req.user._id }
  );

  // Real-time broadcast to every connected client of every role
  const payload = {
    ...populated,
    alertId: populated._id,
    triggeredBy: { name: req.user.name, role: req.user.role, department: req.user.department },
  };
  emitToRoles(SOS_RESPONDER_ROLES, 'sos:new', payload);
  emitToRoles(SOS_BYSTANDER_ROLES, 'sos:new', bystanderView(payload));

  res.status(201).json(populated);
});

export const listAlerts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 15);
  const filter = {};
  const { status, type } = req.query;

  // (Non-responders are already blocked by the route's authorize(); this branch is a safety net.)
  if (!SOS_RESPONDER_ROLES.includes(req.user.role)) filter.user = req.user._id;
  if (status) filter.status = status;
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    SOSAlert.find(filter)
      .populate('user', USER_FIELDS)
      .populate('acknowledgedBy', 'name role')
      .populate('resolvedBy', 'name role')
      .sort({ status: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SOSAlert.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

export const acknowledgeAlert = asyncHandler(async (req, res) => {
  const alert = await SOSAlert.findById(req.params.id);
  if (!alert) throw new ApiError(404, 'Alert not found');
  if (CLOSED.includes(alert.status)) throw new ApiError(409, 'This alert is already closed');

  alert.acknowledgedBy = req.user._id;
  alert.acknowledgedAt = new Date();
  if (alert.status === 'active') alert.status = 'acknowledged';
  await alert.save();
  logActivity(req, 'sos.ack', { entityType: 'sos', entityId: alert._id });

  const populated = await SOSAlert.findById(alert._id)
    .populate('user', USER_FIELDS)
    .populate('acknowledgedBy', 'name role')
    .populate('resolvedBy', 'name role')
    .lean();

  emitToRoles(SOS_RESPONDER_ROLES, 'sos:updated', populated);
  await notifyUsers([alert.user], {
    type: 'sos',
    title: 'SOS alert acknowledged',
    message: 'Responders have acknowledged your emergency alert.',
    link: '/sos',
  });
  res.json(populated);
});

export const resolveAlert = asyncHandler(async (req, res) => {
  const alert = await SOSAlert.findById(req.params.id);
  if (!alert) throw new ApiError(404, 'Alert not found');
  if (CLOSED.includes(alert.status)) throw new ApiError(409, 'This alert is already closed');

  const { resolutionNote, status } = req.body;
  if (!resolutionNote || !resolutionNote.trim()) throw new ApiError(400, 'Resolution note is required');

  alert.resolvedBy = req.user._id;
  alert.resolvedAt = new Date();
  alert.resolutionNote = resolutionNote.trim();
  alert.status = status === 'false_alarm' ? 'false_alarm' : 'resolved';
  await alert.save();
  logActivity(req, 'sos.resolve', { entityType: 'sos', entityId: alert._id, summary: alert.resolutionNote });

  const populated = await SOSAlert.findById(alert._id)
    .populate('user', USER_FIELDS)
    .populate('acknowledgedBy', 'name role')
    .populate('resolvedBy', 'name role')
    .lean();

  emitToRoles(SOS_RESPONDER_ROLES, 'sos:updated', populated);
  await notifyUsers([alert.user], {
    type: 'sos',
    title: `SOS alert ${alert.status === 'false_alarm' ? 'closed as false alarm' : 'resolved'}`,
    message: alert.resolutionNote,
    link: '/sos',
  });
  res.json(populated);
});
