import User from '../models/User.js';
import DeviceToken from '../models/DeviceToken.js';
import Notification from '../models/Notification.js';
import Session from '../models/Session.js';
import { env } from '../config/env.js';
import { fcmConfigured, sendToToken } from './fcm.js';
import { HIGH_PRIORITY_CATEGORIES } from '../constants.js';

/**
 * Push stored notifications to the recipients' Android devices over FCM, and
 * record the outcome on each notification (sent / skipped / failed).
 *
 * Only devices registered from a session that is still signed in receive
 * anything; tokens FCM reports as unregistered are deleted. The message is
 * data-only — title, text, link and category — and the app shows it on the
 * channel for its category, hiding the text on the lock screen. The Expo
 * tokens of the legacy app are served by sendPushToUsers below as before.
 */
export async function deliverPush(docs) {
  const userIds = [...new Set(docs.map((d) => String(d.user)))];
  // Legacy Expo app devices, unchanged behaviour: one call per distinct message.
  const groups = new Map();
  for (const d of docs) {
    const k = `${d.type}|${d.title}|${d.message}|${d.link}`;
    if (!groups.has(k)) groups.set(k, { d, users: [] });
    groups.get(k).users.push(d.user);
  }
  for (const { d, users } of groups.values()) sendPushToUsers(users, { title: d.title, body: d.message, data: { type: d.type, link: d.link } });

  const tokens = fcmConfigured() ? await DeviceToken.find({ user: { $in: userIds } }).lean() : [];
  const live = tokens.length
    ? new Set((await Session.find({ _id: { $in: tokens.map((t) => t.session).filter(Boolean) }, revokedAt: null, expiresAt: { $gt: new Date() } }).distinct('_id')).map(String))
    : new Set();
  const byUser = new Map();
  for (const t of tokens) {
    if (!t.session || !live.has(String(t.session))) continue;
    if (!byUser.has(String(t.user))) byUser.set(String(t.user), []);
    byUser.get(String(t.user)).push(t);
  }

  const invalid = new Set();
  await Promise.all(
    docs.map(async (d) => {
      const devices = byUser.get(String(d.user)) || [];
      let status = 'skipped';
      let sent = 0;
      if (devices.length) {
        const results = await Promise.all(
          devices.map((t) =>
            sendToToken(
              t.token,
              { notificationId: d._id, title: d.title, body: d.message || '', link: d.link || '', category: d.category || 'system' },
              { priority: HIGH_PRIORITY_CATEGORIES.includes(d.category) ? 'high' : 'normal' }
            ).then((r) => {
              if (r === 'invalid') invalid.add(t.token);
              return r;
            })
          )
        );
        sent = results.filter((r) => r === 'sent').length;
        status = sent ? 'sent' : results.every((r) => r === 'skipped') ? 'skipped' : 'failed';
      }
      await Notification.updateOne({ _id: d._id }, { $set: { 'delivery.status': status, 'delivery.devices': sent, 'delivery.at': new Date() } });
    })
  );
  if (invalid.size) await DeviceToken.deleteMany({ token: { $in: [...invalid] } });
}

/**
 * A push that is NOT kept as an in-app notification (a chat message: the chat
 * itself is the history). Honours the category preference, active sessions
 * and invalid-token cleanup exactly like deliverPush. Never throws.
 */
export async function pushNow(userIds, { title, body, link, category = 'system' }) {
  try {
    const ids = [...new Set((userIds || []).map(String))];
    if (!ids.length || !fcmConfigured()) return;
    const off = new Set((await User.find({ _id: { $in: ids }, 'notificationPrefs.disabled': category }).distinct('_id')).map(String));
    const wanted = ids.filter((id) => !off.has(id));
    const tokens = await DeviceToken.find({ user: { $in: wanted } }).lean();
    const live = new Set((await Session.find({ _id: { $in: tokens.map((t) => t.session).filter(Boolean) }, revokedAt: null, expiresAt: { $gt: new Date() } }).distinct('_id')).map(String));
    const invalid = [];
    await Promise.all(
      tokens
        .filter((t) => t.session && live.has(String(t.session)))
        .map(async (t) => {
          const r = await sendToToken(t.token, { title, body: body || '', link: link || '', category }, { priority: HIGH_PRIORITY_CATEGORIES.includes(category) ? 'high' : 'normal' });
          if (r === 'invalid') invalid.push(t.token);
        })
    );
    if (invalid.length) await DeviceToken.deleteMany({ token: { $in: invalid } });
  } catch (err) {
    console.error('[push] failed:', err.message);
  }
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const isExpoToken = (t) => /^Expo(nent)?PushToken\[[\w-]+\]$/.test(t);

/**
 * Send an Expo push notification to every registered device of the given users.
 * Used by the central notification helper, so web and Android share one set of
 * business rules. Never throws — a failed push must not fail the request.
 */
export async function sendPushToUsers(userIds, { title, body, data } = {}) {
  try {
    const ids = [...new Set((userIds || []).map(String))];
    if (!ids.length) return;
    const users = await User.find({ _id: { $in: ids }, isActive: true, 'pushTokens.0': { $exists: true } })
      .select('+pushTokens')
      .lean();
    // Only tokens bound to a live session (as for FCM devices): a token whose
    // session was revoked, expired or signed out, or that was registered before
    // tokens were bound to sessions, gets nothing until the app registers again.
    const sessionIds = users.flatMap((u) => (u.pushTokens || []).map((t) => t.session).filter(Boolean));
    const live = sessionIds.length
      ? new Set((await Session.find({ _id: { $in: sessionIds }, revokedAt: null, expiresAt: { $gt: new Date() } }).distinct('_id')).map(String))
      : new Set();
    const messages = users.flatMap((u) =>
      (u.pushTokens || [])
        .filter((t) => t.session && live.has(String(t.session)))
        .map((t) => t.token)
        .filter(isExpoToken)
        .map((to) => ({ to, title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 240), data, sound: 'default', channelId: 'default' }))
    );
    if (!messages.length) return;

    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (env.expoAccessToken) headers.Authorization = `Bearer ${env.expoAccessToken}`;
    // Expo accepts up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages.slice(i, i + 100)) });
      if (!res.ok) {
        console.error('[push] Expo push request failed:', res.status);
        continue;
      }
      const { data: tickets = [] } = await res.json().catch(() => ({}));
      // Forget tokens for uninstalled apps.
      const dead = tickets
        .map((t, k) => (t?.details?.error === 'DeviceNotRegistered' ? messages[i + k].to : null))
        .filter(Boolean);
      if (dead.length) await User.updateMany({}, { $pull: { pushTokens: { token: { $in: dead } } } });
    }
  } catch (err) {
    console.error('[push] failed:', err.message);
  }
}
