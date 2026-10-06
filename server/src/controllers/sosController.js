import SOSAlert from '../models/SOSAlert.js';
import { SOS_BROADCAST_ROLES, SOS_RESPONDER_ROLES } from '../constants.js';
import { ApiError, asyncHandler, pageMeta, paginate, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyRoles, notifyUsers } from '../utils/notify.js';
import { emitToRoles } from '../config/socket.js';

const USER_FIELDS = 'name avatar department section rollNo phone';

export const createAlert = asyncHandler(async (req, res) => {
  const data = pick(req.body, ['type', 'note', 'location']);
  data.user = req.user._id;
  data.department = req.user.department;
  data.section = req.user.section;
  data.status = 'active';

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
  emitToRoles(SOS_BROADCAST_ROLES, 'sos:new', {
    ...populated,
    alertId: populated._id,
    triggeredBy: { name: req.user.name, role: req.user.role, department: req.user.department },
  });

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
