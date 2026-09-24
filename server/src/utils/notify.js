import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { emitTo } from '../config/socket.js';
import { sendPushToUsers } from '../services/pushService.js';

/**
 * Persist a notification for each user, push it in real time over Socket.io
 * (web + Android while open) and as an Expo push notification (Android, even
 * when the app is closed). This is the single place notification rules live.
 * Never throws — a failed notification must not fail the main request.
 */
export async function notifyUsers(userIds, { type = 'system', title, message, link }, { exclude, push = true } = {}) {
  try {
    const ids = [...new Set((userIds || []).map((id) => String(id?._id || id)))].filter(
      (id) => id && id !== String(exclude || '')
    );
    if (!ids.length) return;
    const docs = await Notification.insertMany(
      ids.map((user) => ({ user, type, title, message, link })),
      { ordered: false }
    );
    docs.forEach((doc) => emitTo(`user:${doc.user}`, 'notification', doc.toJSON()));
    if (push) sendPushToUsers(ids, { title, body: message, data: { type, link } });
  } catch (err) {
    console.error('[notify] failed:', err.message);
  }
}

export async function notifyRoles(roles, payload, opts) {
  const ids = await User.find({ role: { $in: roles }, isActive: true }).distinct('_id');
  return notifyUsers(ids, payload, opts);
}
