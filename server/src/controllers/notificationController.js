import Notification from '../models/Notification.js';
import DeviceToken from '../models/DeviceToken.js';
import User from '../models/User.js';
import { asyncHandler, pageMeta, paginate } from '../utils/http.js';
import { OPTIONAL_NOTIFICATION_CATEGORIES, REMINDER_MINUTES } from '../constants.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 20);
  const filter = { user: req.user._id };
  if (req.query.unread === 'true') filter.read = false;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-eventKey').lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, read: false }),
  ]);
  res.json({ items, unread, ...pageMeta(total, page, limit) });
});

export const markRead = asyncHandler(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, user: req.user._id, read: false }, { read: true, readAt: new Date() });
  res.json({ ok: true });
});

export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true, readAt: new Date() });
  res.json({ ok: true });
});

export const deleteNotification = asyncHandler(async (req, res) => {
  await Notification.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ ok: true });
});

// ── Notification preferences ───────────────────────────────────────

const prefsOf = (u) => ({
  disabled: u?.notificationPrefs?.disabled || [],
  reminderMinutes: u?.notificationPrefs?.reminderMinutes || 10,
  optional: OPTIONAL_NOTIFICATION_CATEGORIES,
  reminderChoices: REMINDER_MINUTES,
});

export const getPreferences = asyncHandler(async (req, res) => {
  const u = await User.findById(req.user._id).select('notificationPrefs').lean();
  res.json(prefsOf(u));
});

/** Only the optional categories can be switched off; safety and duty notifications always arrive. */
export const updatePreferences = asyncHandler(async (req, res) => {
  const set = {};
  if (Array.isArray(req.body.disabled)) set['notificationPrefs.disabled'] = [...new Set(req.body.disabled)].filter((c) => OPTIONAL_NOTIFICATION_CATEGORIES.includes(c));
  if (req.body.reminderMinutes !== undefined) set['notificationPrefs.reminderMinutes'] = Number(req.body.reminderMinutes);
  const u = await User.findByIdAndUpdate(req.user._id, { $set: set }, { new: true, runValidators: true }).select('notificationPrefs').lean();
  res.json(prefsOf(u));
});

// ── Android devices (FCM) ──────────────────────────────────────────

/**
 * Register this device's FCM token for the signed-in account and the session
 * it is signed in with. A token that was registered by another account on the
 * same phone moves to this one (the phone now belongs to whoever signed in on
 * it) — a token can never be attached to any account but the caller's own.
 */
export const registerDevice = asyncHandler(async (req, res) => {
  const { token, deviceName, appVersion } = req.body;
  await DeviceToken.findOneAndUpdate(
    { token },
    {
      $set: { user: req.user._id, session: req.sessionId, lastSeenAt: new Date(), failures: 0, ...(deviceName ? { deviceName } : {}), ...(appVersion ? { appVersion } : {}) },
      $setOnInsert: { token, provider: 'fcm', platform: 'android' },
    },
    { upsert: true }
  );
  res.json({ ok: true });
});

/** Forget this device (sign-out, notifications turned off). Only the caller's own tokens. */
export const unregisterDevice = asyncHandler(async (req, res) => {
  await DeviceToken.deleteOne({ token: req.body.token, user: req.user._id });
  res.json({ ok: true });
});
