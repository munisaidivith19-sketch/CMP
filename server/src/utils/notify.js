import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { emitTo } from '../config/socket.js';
import { deliverPush } from '../services/pushService.js';
import { OPTIONAL_NOTIFICATION_CATEGORIES } from '../constants.js';

// A notification's category when the caller does not name one.
const CATEGORY_OF_TYPE = {
  announcement: 'announcement', event: 'event', club: 'event', chat: 'chat', attendance: 'attendance',
  gate_pass: 'gate_pass', timetable: 'timetable', sos: 'sos',
};

/**
 * The one place notifications are created. For each recipient, in order:
 *
 *   1. recipients who switched this (optional) category off are dropped;
 *   2. the notification is STORED — with `eventKey`, a repeated event
 *      (retry, double submit, reminder tick) never makes a second one;
 *   3. it goes out live over Socket.io to the user's open web / app sessions;
 *   4. push delivery to their Android devices is attempted afterwards, and
 *      its outcome recorded on the stored notification.
 *
 * So the in-app history never depends on push delivery. Recipients are always
 * resolved by the caller from backend authorization — never from a client.
 * Never throws: a failed notification must not fail the main request.
 */
export async function notifyUsers(userIds, { type = 'system', title, message, link }, { exclude, push = true, category, eventKey } = {}) {
  try {
    let ids = [...new Set((userIds || []).map((id) => String(id?._id || id)))].filter((id) => id && id !== String(exclude || ''));
    if (!ids.length) return [];
    const cat = category || CATEGORY_OF_TYPE[type] || 'system';

    if (OPTIONAL_NOTIFICATION_CATEGORIES.includes(cat)) {
      const off = await User.find({ _id: { $in: ids }, 'notificationPrefs.disabled': cat }).distinct('_id');
      if (off.length) {
        const offSet = new Set(off.map(String));
        ids = ids.filter((id) => !offSet.has(id));
      }
    }
    if (eventKey) {
      const already = await Notification.find({ user: { $in: ids }, eventKey }).distinct('user');
      if (already.length) {
        const seen = new Set(already.map(String));
        ids = ids.filter((id) => !seen.has(id));
      }
    }
    if (!ids.length) return [];

    let docs;
    try {
      docs = await Notification.insertMany(
        ids.map((user) => ({ user, type, title, message, link, category: cat, ...(eventKey ? { eventKey } : {}) })),
        { ordered: false }
      );
    } catch (err) {
      // A concurrent identical event won the unique (user, eventKey) race: keep the rest.
      if (err.code !== 11000 && !err.writeErrors) throw err;
      docs = err.insertedDocs || [];
    }
    docs.forEach((doc) => emitTo(`user:${doc.user}`, 'notification', doc.toJSON ? doc.toJSON() : doc));
    if (push && docs.length) deliverPush(docs).catch((err) => console.error('[notify] push failed:', err.message));
    return docs;
  } catch (err) {
    console.error('[notify] failed:', err.message);
    return [];
  }
}

export async function notifyRoles(roles, payload, opts) {
  const ids = await User.find({ role: { $in: roles }, isActive: true }).distinct('_id');
  return notifyUsers(ids, payload, opts);
}
