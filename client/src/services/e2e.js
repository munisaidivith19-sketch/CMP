/**
 * End-to-end encrypted chat in the browser (docs/chat-e2e.md).
 *
 * Each browser profile is one device: its private key is a non-extractable
 * CryptoKey kept in IndexedDB (per signed-in user), so even this page's own
 * code cannot read it out. Messages are encrypted for every device of every
 * participant; the server only ever sees ciphertext.
 */
import { useEffect, useMemo, useState } from 'react';
import { store } from '../app/store';
import { api } from './api';
import { NoKeyForDevice, decryptMessage, encryptMessage, generateDeviceKey } from './e2eCrypto';

const DB = 'vexon-chat-e2e';
const STORE = 'devices';

export const TEXT = {
  pending: '🔒 Decrypting…',
  noKey: '🔒 Sent before this device was set up for encrypted chat, so it cannot be read here.',
  failed: '🔒 This message could not be decrypted on this device.',
};

export const supported = () => Boolean(globalThis.crypto?.subtle && globalThis.indexedDB);

// ── IndexedDB (one record per user: { userId, deviceId, privateKey, publicKey }) ──
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'userId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const loadRecord = (userId) => idbDo('readonly', (s) => s.get(userId));
const saveRecord = (rec) => idbDo('readwrite', (s) => s.put(rec));

const currentUserId = () => {
  const u = store.getState().auth.user;
  return u?._id ? String(u._id) : null;
};

// ── This device ──────────────────────────────────────────────────────
const devices = new Map(); // userId -> Promise<{ deviceId, privateKey }>

async function setUp(userId) {
  let rec = await loadRecord(userId);
  if (!rec) {
    rec = { userId, deviceId: null, ...(await generateDeviceKey()) };
    await saveRecord(rec);
  }
  // Announce the key every start: registers it, or marks the device as still in use.
  const res = await store.dispatch(api.endpoints.registerChatDevice.initiate({ publicKey: rec.publicKey, platform: 'web' }));
  if (res.error?.data?.code === 'E2E_DEVICE_REVOKED') {
    // Removed from the account: start again with a brand-new key.
    rec = { userId, deviceId: null, ...(await generateDeviceKey()) };
    await saveRecord(rec);
    return setUp(userId);
  }
  if (res.error) throw new Error('could not register this device for encrypted chat');
  if (rec.deviceId !== res.data.deviceId) {
    rec = { ...rec, deviceId: res.data.deviceId };
    await saveRecord(rec);
  }
  return { deviceId: rec.deviceId, privateKey: rec.privateKey };
}

/** This browser's chat device for the signed-in user (set up once per session). */
export function ensureDevice() {
  const userId = currentUserId();
  if (!userId || !supported()) return Promise.resolve(null);
  if (!devices.has(userId)) {
    const p = setUp(userId).catch((err) => {
      devices.delete(userId); // try again next time
      throw err;
    });
    devices.set(userId, p);
  }
  return devices.get(userId);
}

// ── Sending ──────────────────────────────────────────────────────────
const plainCache = new Map(); // envelope id (epk+iv) -> text
const envId = (env) => `${env.epk}|${env.iv}`;
const remember = (env, text) => {
  if (plainCache.size > 3000) plainCache.clear();
  plainCache.set(envId(env), text);
};

async function conversationKeys(conversationId, fresh) {
  const sub = store.dispatch(api.endpoints.getChatKeys.initiate(conversationId, { forceRefetch: fresh }));
  try {
    return await sub.unwrap();
  } finally {
    sub.unsubscribe();
  }
}

const devicesChanged = (err) => err?.status === 409 && err?.data?.code === 'E2E_DEVICES_CHANGED';

/**
 * Send (or edit) `text` in a conversation: end-to-end encrypted when every
 * participant has a device that supports it, otherwise plain (still encrypted
 * at rest on the server). `request(payload)` performs the API call with
 * `{ e2e }` or `{ body }` and returns the RTK promise's unwrap().
 */
export async function sendSecure(conversationId, text, request) {
  const attempt = async (fresh) => {
    const me = await ensureDevice().catch(() => null);
    let keys = me ? await conversationKeys(conversationId, fresh) : null;
    // A cached answer may predate this device's registration: confirm before sending unencrypted.
    if (keys && !fresh && (!keys.complete || !keys.devices.some((d) => d.deviceId === me.deviceId))) {
      keys = await conversationKeys(conversationId, true);
    }
    if (!keys?.complete) return request({ body: text });
    const e2e = await encryptMessage(conversationId, text, keys.devices);
    remember(e2e, text);
    return request({ e2e });
  };
  try {
    return await attempt(false);
  } catch (err) {
    // Someone set up a new device (or one expired): re-read the keys and try once more.
    if (devicesChanged(err)) return attempt(true);
    throw err;
  }
}

// ── Reading ──────────────────────────────────────────────────────────
/** Plain text of an envelope on this device (never throws). */
export async function openEnvelope(conversationId, env) {
  const id = envId(env);
  if (plainCache.has(id)) return plainCache.get(id);
  let me;
  try {
    me = await ensureDevice();
  } catch {
    return TEXT.failed; // not remembered: this device may be set up on the next try
  }
  let text;
  try {
    text = me ? await decryptMessage(conversationId, env, me) : TEXT.failed;
  } catch (err) {
    text = err instanceof NoKeyForDevice ? TEXT.noKey : TEXT.failed;
  }
  remember(env, text);
  return text;
}

const known = (env) => plainCache.get(envId(env));

/** A copy of `item` whose `body` is the readable text when it carries `e2e`. */
function withText(item) {
  if (!item?.e2e) return { ...item };
  return { ...item, body: known(item.e2e) ?? TEXT.pending };
}

/**
 * Decrypts the end-to-end encrypted messages of a list (and their reply
 * quotes / conversation previews) and returns the list with readable `body`
 * text. `convIdOf(item)` names each item's conversation.
 */
export function useDecrypted(items, convIdOf) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    const todo = [];
    for (const item of items || []) {
      const convId = convIdOf(item);
      for (const part of [item, item?.replyTo, item?.lastMessage]) {
        if (part?.e2e && known(part.e2e) === undefined) todo.push(openEnvelope(convId, part.e2e));
      }
    }
    if (todo.length) Promise.all(todo).then(() => live && setVersion((v) => v + 1));
    return () => {
      live = false;
    };
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(
    () =>
      (items || []).map((item) => {
        if (!item || !(item.e2e || item.replyTo?.e2e || item.lastMessage?.e2e)) return item;
        const out = withText(item);
        if (item.replyTo?.e2e) out.replyTo = withText(item.replyTo);
        if (item.lastMessage?.e2e) out.lastMessage = withText(item.lastMessage);
        return out;
      }),
    [items, version] // eslint-disable-line react-hooks/exhaustive-deps
  );
}

/** Readable text of one socket/toast message (plain body, or decrypted). */
export const textOf = (conversationId, message) =>
  message?.e2e ? openEnvelope(conversationId, message.e2e) : Promise.resolve(message?.body ?? '');
