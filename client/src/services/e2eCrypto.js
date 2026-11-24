/**
 * End-to-end encryption for chat, protocol v1 (docs/chat-e2e.md). Pure
 * WebCrypto, no storage or network: runs in the browser and in Node tests.
 * The Android and iOS apps implement the same steps byte for byte.
 */
const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const E2E_VERSION = 1;
const LABEL = 'vexon-chat-e2e-v1';
const EC = { name: 'ECDH', namedCurve: 'P-256' };

export function bytesToB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** A new device key pair. The private key cannot be exported (it can still be stored in IndexedDB). */
export async function generateDeviceKey() {
  const pair = await subtle().generateKey(EC, false, ['deriveBits']);
  const spki = await subtle().exportKey('spki', pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: bytesToB64(spki) };
}

const importPublic = (b64) => subtle().importKey('spki', b64ToBytes(b64), EC, false, []);

/** AES-256-GCM key wrapping the content key for one device (ECDH + HKDF-SHA256). */
async function kek(privateKey, publicKey, deviceId, usage) {
  const shared = await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const ikm = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(LABEL), info: enc.encode(deviceId) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

const contentAad = (conversationId) => enc.encode(`${LABEL}|${conversationId}`);

/**
 * Encrypt `text` for every device in `devices` ([{ deviceId, publicKey }]).
 * Returns the envelope the server stores: { v, epk, iv, ct, keys: [{ d, iv, wk }] }.
 */
export async function encryptMessage(conversationId, text, devices) {
  const ck = random(32);
  const iv = random(12);
  const contentKey = await subtle().importKey('raw', ck, 'AES-GCM', false, ['encrypt']);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: contentAad(conversationId) },
    contentKey,
    enc.encode(JSON.stringify({ t: text }))
  );
  const eph = await subtle().generateKey(EC, false, ['deriveBits']);
  const keys = await Promise.all(
    devices.map(async ({ deviceId, publicKey }) => {
      const wrapKey = await kek(eph.privateKey, await importPublic(publicKey), deviceId, 'encrypt');
      const kiv = random(12);
      const wk = await subtle().encrypt({ name: 'AES-GCM', iv: kiv, additionalData: enc.encode(deviceId) }, wrapKey, ck);
      return { d: deviceId, iv: bytesToB64(kiv), wk: bytesToB64(wk) };
    })
  );
  ck.fill(0);
  return {
    v: E2E_VERSION,
    epk: bytesToB64(await subtle().exportKey('spki', eph.publicKey)),
    iv: bytesToB64(iv),
    ct: bytesToB64(ct),
    keys,
  };
}

export class NoKeyForDevice extends Error {}

/**
 * Decrypt an envelope with this device's key. Throws NoKeyForDevice when the
 * message was not encrypted for this device (sent before it was set up), and
 * a DOMException when the data was tampered with or the key is wrong.
 */
export async function decryptMessage(conversationId, envelope, { deviceId, privateKey }) {
  if (envelope?.v !== E2E_VERSION) throw new Error('unsupported envelope');
  const entry = envelope.keys?.find((k) => k.d === deviceId);
  if (!entry) throw new NoKeyForDevice('no key for this device');
  const unwrapKey = await kek(privateKey, await importPublic(envelope.epk), deviceId, 'decrypt');
  const ck = await subtle().decrypt({ name: 'AES-GCM', iv: b64ToBytes(entry.iv), additionalData: enc.encode(deviceId) }, unwrapKey, b64ToBytes(entry.wk));
  const contentKey = await subtle().importKey('raw', ck, 'AES-GCM', false, ['decrypt']);
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(envelope.iv), additionalData: contentAad(conversationId) },
    contentKey,
    b64ToBytes(envelope.ct)
  );
  const { t } = JSON.parse(dec.decode(plain));
  return String(t ?? '');
}
