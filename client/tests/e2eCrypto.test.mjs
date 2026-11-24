import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NoKeyForDevice, b64ToBytes, decryptMessage, encryptMessage, generateDeviceKey } from '../src/services/e2eCrypto.js';

const CONV = '6650a1b2c3d4e5f601234567';
const device = async (deviceId) => ({ deviceId, ...(await generateDeviceKey()) });

test('every device in the conversation (and only those) can read the message', async () => {
  const [alice, bobWeb, bobPhone, eve] = await Promise.all([device('alice'), device('bob-web'), device('bob-phone'), device('eve')]);
  const text = 'Meet at the library at 4 🙂 — ಸರಿ?';
  const env = await encryptMessage(CONV, text, [alice, bobWeb, bobPhone]);

  assert.equal(env.v, 1);
  assert.ok(!JSON.stringify(env).includes('library'), 'no plaintext in the envelope');
  for (const d of [alice, bobWeb, bobPhone]) assert.equal(await decryptMessage(CONV, env, d), text);
  await assert.rejects(decryptMessage(CONV, env, eve), NoKeyForDevice);
  // A device that steals another device's key entry still cannot unwrap it.
  await assert.rejects(decryptMessage(CONV, env, { ...eve, deviceId: 'bob-web' }));
});

test('the ciphertext is bound to its conversation and cannot be altered', async () => {
  const bob = await device('bob');
  const env = await encryptMessage(CONV, 'secret', [bob]);
  await assert.rejects(decryptMessage('ffffffffffffffffffffffff', env, bob), 'moved to another chat');
  const bytes = b64ToBytes(env.ct);
  bytes[0] ^= 1;
  const tampered = { ...env, ct: Buffer.from(bytes).toString('base64') };
  await assert.rejects(decryptMessage(CONV, tampered, bob), 'tampered');
});

test('reads the shared test vector made by an independent node:crypto implementation', async () => {
  // docs/chat-e2e-vector.json pins the wire format for the Android and iOS apps too.
  const v = JSON.parse(readFileSync(new URL('../../docs/chat-e2e-vector.json', import.meta.url), 'utf8'));
  const privateKey = await crypto.subtle.importKey('pkcs8', b64ToBytes(v.devicePrivatePkcs8), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  assert.equal(await decryptMessage(v.conversationId, v.envelope, { deviceId: v.deviceId, privateKey }), v.text);
});
