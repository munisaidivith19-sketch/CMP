/**
 * End-to-end encrypted chat: device registry and envelope checks
 * (protocol: docs/chat-e2e.md). The server never sees message keys or text;
 * it only checks the envelope's shape and that every active device of every
 * participant got a copy of the message key.
 */
import crypto from 'node:crypto';
import ChatDevice from '../models/ChatDevice.js';
import { ApiError } from '../utils/http.js';

export const E2E_PLACEHOLDER = '🔒 End-to-end encrypted message. Update the app to read it.';
export const DEVICE_ACTIVE_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_DEVICES_PER_USER = 10;
const SEEN_REFRESH_MS = 60 * 60 * 1000;
const PLATFORMS = ['web', 'android', 'ios'];

const devicesChanged = () =>
  new ApiError(409, 'Someone in this chat set up a new device. Please send again.', null, { code: 'E2E_DEVICES_CHANGED' });

const b64Len = (v, max) => {
  if (typeof v !== 'string' || !v.length || v.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return -1;
  return Buffer.from(v, 'base64').length;
};

/** A P-256 public key as SPKI DER (base64), normalised; throws 422 otherwise. */
export function parsePublicKey(value) {
  if (b64Len(value, 200) < 0) throw new ApiError(422, 'Invalid public key');
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('curve');
    return key.export({ format: 'der', type: 'spki' }).toString('base64');
  } catch {
    throw new ApiError(422, 'Invalid public key (expected an ECDH P-256 key)');
  }
}

const activeFilter = () => ({ revokedAt: null, lastSeenAt: { $gte: new Date(Date.now() - DEVICE_ACTIVE_MS) } });

/** Register (or re-announce) this device's public key. Returns { deviceId }. */
export async function registerDevice(user, { publicKey, platform }) {
  if (!PLATFORMS.includes(platform)) throw new ApiError(422, 'Unknown platform');
  const key = parsePublicKey(publicKey);
  const existing = await ChatDevice.findOne({ user: user._id, publicKey: key });
  if (existing) {
    // A removed device must make a new key: its old one is no longer trusted.
    if (existing.revokedAt) throw new ApiError(410, 'This device was removed from your chats. Set it up again.', null, { code: 'E2E_DEVICE_REVOKED' });
    if (Date.now() - existing.lastSeenAt.getTime() > SEEN_REFRESH_MS) {
      existing.lastSeenAt = new Date();
      await existing.save();
    }
    return { deviceId: existing.deviceId, created: false };
  }
  // Keep at most MAX_DEVICES_PER_USER: the least recently seen ones are retired.
  const active = await ChatDevice.find({ user: user._id, ...activeFilter() }).sort({ lastSeenAt: -1 }).select('_id').lean();
  const retire = active.slice(MAX_DEVICES_PER_USER - 1).map((d) => d._id);
  if (retire.length) await ChatDevice.updateMany({ _id: { $in: retire } }, { $set: { revokedAt: new Date() } });
  const device = await ChatDevice.create({ user: user._id, deviceId: crypto.randomUUID(), publicKey: key, platform });
  return { deviceId: device.deviceId, created: true };
}

export async function listMyDevices(user) {
  return ChatDevice.find({ user: user._id, ...activeFilter() }).select('deviceId platform lastSeenAt createdAt -_id').sort({ lastSeenAt: -1 }).lean();
}

export async function revokeDevice(user, deviceId) {
  const r = await ChatDevice.updateOne({ user: user._id, deviceId: String(deviceId), revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (!r.matchedCount) throw new ApiError(404, 'Device not found');
}

/** Active device ids of one user (to trim envelopes down to what they can open). */
export async function myDeviceIds(user) {
  const rows = await ChatDevice.find({ user: user._id, ...activeFilter() }).select('deviceId -_id').lean();
  return new Set(rows.map((r) => r.deviceId));
}

/** Every active device of a conversation's participants, and whether each participant has one. */
export async function conversationKeys(participantIds) {
  const ids = participantIds.map(String);
  const devices = await ChatDevice.find({ user: { $in: ids }, ...activeFilter() }).select('deviceId user publicKey -_id').lean();
  const withDevice = new Set(devices.map((d) => String(d.user)));
  return {
    complete: ids.length > 0 && ids.every((id) => withDevice.has(id)),
    devices: devices.map((d) => ({ deviceId: d.deviceId, userId: String(d.user), publicKey: d.publicKey })),
  };
}

/**
 * Check an envelope from a client and keep only known fields. Every active
 * device of every participant must have a key entry (else 409, the client
 * re-fetches the keys); entries for unknown devices are dropped.
 */
export async function acceptEnvelope(raw, participantIds) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) throw new ApiError(422, 'Invalid encrypted message');
  if (b64Len(raw.epk, 200) < 0) throw new ApiError(422, 'Invalid encrypted message');
  parsePublicKey(raw.epk);
  // 5000 characters of text, up to 4 UTF-8 bytes each, inside {"t":"…"} with escapes.
  if (b64Len(raw.iv, 24) !== 12 || b64Len(raw.ct, 60000) < 17) throw new ApiError(422, 'Invalid encrypted message');
  if (!Array.isArray(raw.keys) || !raw.keys.length || raw.keys.length > 1000) throw new ApiError(422, 'Invalid encrypted message');
  const keys = raw.keys.map((k) => {
    if (!k || typeof k.d !== 'string' || !k.d.length || k.d.length > 64 || b64Len(k.iv, 24) !== 12 || b64Len(k.wk, 100) !== 48) {
      throw new ApiError(422, 'Invalid encrypted message');
    }
    return { d: k.d, iv: k.iv, wk: k.wk };
  });

  const { complete, devices } = await conversationKeys(participantIds);
  if (!complete) throw devicesChanged();
  const given = new Set(keys.map((k) => k.d));
  if (devices.some((d) => !given.has(d.deviceId))) throw devicesChanged();
  const wanted = new Set(devices.map((d) => d.deviceId));
  return { v: 1, epk: raw.epk, iv: raw.iv, ct: raw.ct, keys: keys.filter((k) => wanted.has(k.d)) };
}

/** The envelope with only the key entries of the given devices (smaller responses). */
export function envelopeFor(env, deviceIds) {
  if (!env) return env;
  return { v: env.v, epk: env.epk, iv: env.iv, ct: env.ct, keys: (env.keys || []).filter((k) => deviceIds.has(k.d)) };
}
