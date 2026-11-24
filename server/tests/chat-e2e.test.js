import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, nextEvent } from './helpers.js';
// The browser's own implementation (pure WebCrypto), so this exercises the real wire format.
import { decryptMessage, encryptMessage, generateDeviceKey } from '../../client/src/services/e2eCrypto.js';

let ctx;
let A; // web
let B; // web + phone
let C; // classmate who never set up encrypted chat
let convAB;
let convAC;

const cls = { department: 'CSE', section: 'B', year: 2, semester: 3 };

async function addDevice(who, platform) {
  const key = await generateDeviceKey();
  const res = await ctx.request('POST', '/chat/e2e/devices', { token: who.token, body: { publicKey: key.publicKey, platform } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const device = { deviceId: res.body.deviceId, ...key };
  who.devices.push(device);
  return device;
}

before(async () => {
  ctx = await startServer();
  const [ua, ub, uc] = await Promise.all([
    ctx.createUser({ name: 'Anu', ...cls }),
    ctx.createUser({ name: 'Bharath', ...cls }),
    ctx.createUser({ name: 'Chaitra', ...cls }),
  ]);
  A = { user: ua, devices: [], ...(await ctx.loginWeb(ua)) };
  B = { user: ub, devices: [], ...(await ctx.loginMobile(ub)) };
  C = { user: uc, devices: [], ...(await ctx.loginWeb(uc)) };
  B.socket = await ctx.connect(B.token);
  convAB = (await ctx.request('POST', '/chat/conversations', { token: A.token, body: { participantIds: [String(B.user._id)] } })).body._id;
  convAC = (await ctx.request('POST', '/chat/conversations', { token: A.token, body: { participantIds: [String(C.user._id)] } })).body._id;
});
after(async () => {
  await ctx.stop();
});

test('device registration: P-256 keys only, idempotent per key', async () => {
  const bad = await ctx.request('POST', '/chat/e2e/devices', { token: A.token, body: { publicKey: 'A'.repeat(80), platform: 'web' } });
  assert.equal(bad.status, 422);
  const dev = await addDevice(A, 'web');
  const again = await ctx.request('POST', '/chat/e2e/devices', { token: A.token, body: { publicKey: dev.publicKey, platform: 'web' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.deviceId, dev.deviceId);
  await addDevice(B, 'android');
  await addDevice(B, 'web');
});

test('conversation keys: members only, complete once everyone has a device', async () => {
  const keys = await ctx.request('GET', `/chat/conversations/${convAB}/e2e-keys`, { token: A.token });
  assert.equal(keys.status, 200);
  assert.equal(keys.body.complete, true);
  assert.equal(keys.body.devices.length, 3);
  const outsider = await ctx.request('GET', `/chat/conversations/${convAB}/e2e-keys`, { token: C.token });
  assert.equal(outsider.status, 403);
  const partial = await ctx.request('GET', `/chat/conversations/${convAC}/e2e-keys`, { token: A.token });
  assert.equal(partial.body.complete, false, 'Chaitra has no device yet');
});

test('an end-to-end message is stored and relayed as ciphertext only, and every device of the recipient reads it', async () => {
  const text = 'Exam hall changed to C-204 🙂';
  const { body: keys } = await ctx.request('GET', `/chat/conversations/${convAB}/e2e-keys`, { token: A.token });
  const e2e = await encryptMessage(convAB, text, keys.devices);
  const live = nextEvent(B.socket, 'chat:message', (p) => p.conversationId === convAB);
  const sent = await ctx.request('POST', `/chat/conversations/${convAB}/messages`, { token: A.token, body: { e2e } });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  const got = (await live).message;
  assert.ok(!got.body.includes('C-204'), 'apps without end-to-end support only see a placeholder');
  for (const d of B.devices) assert.equal(await decryptMessage(convAB, got.e2e, d), text);
  assert.equal(await decryptMessage(convAB, sent.body.e2e, A.devices[0]), text, 'the sender can read it back');

  const stored = await ctx.models.Message.findById(sent.body._id).lean();
  assert.equal(stored.body, undefined);
  assert.ok(!JSON.stringify(stored).includes('C-204'), 'no plaintext in the database');
  const conv = await ctx.models.Conversation.findById(convAB).lean();
  assert.ok(conv.lastMessage.e2e && !conv.lastMessage.body, 'the chat list preview is end-to-end encrypted too');

  // History is trimmed to the reader's own devices, and still opens there.
  const history = await ctx.request('GET', `/chat/conversations/${convAB}/messages`, { token: B.token });
  const mine = history.body.messages.find((m) => m._id === sent.body._id);
  assert.deepEqual(mine.e2e.keys.map((k) => k.d).sort(), B.devices.map((d) => d.deviceId).sort());
  assert.equal(await decryptMessage(convAB, mine.e2e, B.devices[1]), text);

  // The server cannot search what it cannot read.
  const search = await ctx.request('GET', '/chat/search?q=C-204', { token: B.token });
  assert.equal(search.body.length, 0);
});

test('a message that leaves out a device is refused so the sender re-encrypts (409)', async () => {
  const { body: keys } = await ctx.request('GET', `/chat/conversations/${convAB}/e2e-keys`, { token: A.token });
  const e2e = await encryptMessage(convAB, 'hi', keys.devices.slice(1));
  const res = await ctx.request('POST', `/chat/conversations/${convAB}/messages`, { token: A.token, body: { e2e } });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'E2E_DEVICES_CHANGED');

  const garbage = await ctx.request('POST', `/chat/conversations/${convAB}/messages`, {
    token: A.token,
    body: { e2e: { ...e2e, keys: [{ d: 'x', iv: 'short', wk: 'bad' }] } },
  });
  assert.equal(garbage.status, 422);
});

test('without a device on every side, plain messages still work (encrypted at rest)', async () => {
  const { body: keys } = await ctx.request('GET', `/chat/conversations/${convAC}/e2e-keys`, { token: A.token });
  const e2e = await encryptMessage(convAC, 'hi', keys.devices);
  const refused = await ctx.request('POST', `/chat/conversations/${convAC}/messages`, { token: A.token, body: { e2e } });
  assert.equal(refused.status, 409, 'Chaitra could not read it');
  const plain = await ctx.request('POST', `/chat/conversations/${convAC}/messages`, { token: A.token, body: { body: 'hi Chaitra' } });
  assert.equal(plain.status, 201);
  assert.equal(plain.body.body, 'hi Chaitra');
});

test('a removed device cannot come back with its old key', async () => {
  const lost = B.devices[1];
  const del = await ctx.request('DELETE', `/chat/e2e/devices/${lost.deviceId}`, { token: B.token });
  assert.equal(del.status, 204);
  const back = await ctx.request('POST', '/chat/e2e/devices', { token: B.token, body: { publicKey: lost.publicKey, platform: 'web' } });
  assert.equal(back.status, 410);
  assert.equal(back.body.code, 'E2E_DEVICE_REVOKED');
  const keys = await ctx.request('GET', `/chat/conversations/${convAB}/e2e-keys`, { token: A.token });
  assert.ok(!keys.body.devices.some((d) => d.deviceId === lost.deviceId), 'no longer receives messages');
});
