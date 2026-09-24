import User from '../models/User.js';
import { env } from '../config/env.js';

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
    const messages = users.flatMap((u) =>
      (u.pushTokens || [])
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
