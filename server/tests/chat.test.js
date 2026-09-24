import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, nextEvent, noEvent, emitAck } from './helpers.js';

let ctx;
let A; // student on the web
let B; // student on Android (mobile protocol)
let C; // unrelated student
let convId;

before(async () => {
  ctx = await startServer();
  const [ua, ub, uc] = await Promise.all([ctx.createUser({ name: 'Alice' }), ctx.createUser({ name: 'Bala' }), ctx.createUser({ name: 'Chitra' })]);
  A = { user: ua, ...(await ctx.loginWeb(ua)) };
  B = { user: ub, ...(await ctx.loginMobile(ub)) };
  C = { user: uc, ...(await ctx.loginWeb(uc)) };
  A.socket = await ctx.connect(A.token);
  B.socket = await ctx.connect(B.token);
  C.socket = await ctx.connect(C.token);
});
after(async () => {
  await ctx.stop();
});

test('starting a private chat is idempotent and notifies the other side live', async () => {
  const live = nextEvent(B.socket, 'chat:conversation');
  const res = await ctx.request('POST', '/chat/conversations', { token: A.token, body: { participantIds: [String(B.user._id)] } });
  assert.equal(res.status, 201);
  convId = res.body._id;
  assert.equal((await live).conversationId, convId);

  const again = await ctx.request('POST', '/chat/conversations', { token: B.token, body: { participantIds: [String(A.user._id)] } });
  assert.equal(again.status, 200);
  assert.equal(again.body._id, convId);
});

test('invalid participants are rejected', async () => {
  const self = await ctx.request('POST', '/chat/conversations', { token: A.token, body: { participantIds: [String(A.user._id)] } });
  assert.equal(self.status, 422);
  const ghost = await ctx.request('POST', '/chat/conversations', { token: A.token, body: { participantIds: ['64b000000000000000000000'] } });
  assert.equal(ghost.status, 404);
  const channel = await ctx.request('POST', '/chat/conversations', {
    token: A.token,
    body: { type: 'class', name: 'CSE-A', participantIds: [String(B.user._id)] },
  });
  assert.equal(channel.status, 403, 'students cannot create class channels');
});

test('web → Android: message is persisted and delivered live', async () => {
  const onPhone = nextEvent(B.socket, 'chat:message', (p) => p.conversationId === convId);
  const sent = await ctx.request('POST', `/chat/conversations/${convId}/messages`, { token: A.token, body: { body: 'Hi from the browser' } });
  assert.equal(sent.status, 201);
  const got = await onPhone;
  assert.equal(got.message.body, 'Hi from the browser');
  assert.equal(got.message.sender.name, 'Alice');

  const stored = await ctx.models.Message.findById(sent.body._id).lean();
  assert.equal(stored.body, 'Hi from the browser');
});

test('Android → web: reply-to, unread counts and history after "refresh"', async () => {
  const history = await ctx.request('GET', `/chat/conversations/${convId}/messages`, { token: B.token });
  const first = history.body.messages[0];
  const onWeb = nextEvent(A.socket, 'chat:message', (p) => p.conversationId === convId);
  const sent = await ctx.request('POST', `/chat/conversations/${convId}/messages`, {
    token: B.token,
    body: { body: 'Hello from Android', replyTo: first._id },
  });
  assert.equal(sent.status, 201);
  const got = await onWeb;
  assert.equal(got.message.replyTo.body, 'Hi from the browser');

  const unread = await ctx.request('GET', '/chat/unread', { token: A.token });
  assert.equal(unread.body.total, 1);

  // Fresh fetch (like reloading either app) returns the full ordered history.
  const reload = await ctx.request('GET', `/chat/conversations/${convId}/messages`, { token: A.token });
  assert.deepEqual(reload.body.messages.map((m) => m.body), ['Hi from the browser', 'Hello from Android']);
});

test('outsiders can neither read, post, join the room nor see typing', async () => {
  assert.equal((await ctx.request('GET', `/chat/conversations/${convId}/messages`, { token: C.token })).status, 403);
  assert.equal((await ctx.request('POST', `/chat/conversations/${convId}/messages`, { token: C.token, body: { body: 'let me in' } })).status, 403);
  assert.equal((await ctx.request('GET', `/chat/conversations/${convId}`, { token: C.token })).status, 403);

  const joined = await emitAck(C.socket, 'chat:join', convId);
  assert.equal(joined.ok, false);
  const silent = noEvent(C.socket, 'chat:typing');
  const silentMsg = noEvent(C.socket, 'chat:message');
  C.socket.emit('chat:typing', { conversationId: convId, isTyping: true }); // not a member → dropped
  await ctx.request('POST', `/chat/conversations/${convId}/messages`, { token: A.token, body: { body: 'private' } });
  assert.ok(await silent);
  assert.ok(await silentMsg, 'private messages never reach non-members');
});

test('typing indicator is relayed only inside the joined room', async () => {
  assert.equal((await emitAck(A.socket, 'chat:join', convId)).ok, true);
  assert.equal((await emitAck(B.socket, 'chat:join', convId)).ok, true);
  const typing = nextEvent(A.socket, 'chat:typing');
  B.socket.emit('chat:typing', { conversationId: convId, isTyping: true });
  const t = await typing;
  assert.equal(t.userId, String(B.user._id));
  assert.equal(t.isTyping, true);
});

test('read receipts reset unread and notify the sender', async () => {
  const receipt = nextEvent(B.socket, 'chat:read', (p) => p.userId === String(A.user._id));
  const ack = await emitAck(A.socket, 'chat:read', { conversationId: convId });
  assert.equal(ack.ok, true);
  await receipt;
  assert.equal((await ctx.request('GET', '/chat/unread', { token: A.token })).body.total, 0);
  const msgs = await ctx.request('GET', `/chat/conversations/${convId}/messages`, { token: B.token });
  const mine = msgs.body.messages.find((m) => m.body === 'Hello from Android');
  assert.ok(mine.readBy.map(String).includes(String(A.user._id)));
});

test('presence: contacts see each other online', async () => {
  const online = await ctx.request('GET', '/chat/users/online', { token: A.token });
  assert.ok(online.body.includes(String(B.user._id)));
  assert.ok(!online.body.includes(String(C.user._id)), 'presence limited to people you chat with');
  const list = await ctx.request('GET', '/chat/conversations', { token: A.token });
  assert.equal(list.body[0].participants.find((p) => p._id === String(B.user._id)).online, true);
});

test('replying to a message from another conversation is rejected', async () => {
  const other = await ctx.request('POST', '/chat/conversations', { token: A.token, body: { participantIds: [String(C.user._id)] } });
  const m = await ctx.request('POST', `/chat/conversations/${other.body._id}/messages`, { token: A.token, body: { body: 'hey C' } });
  const bad = await ctx.request('POST', `/chat/conversations/${convId}/messages`, { token: A.token, body: { body: 'x', replyTo: m.body._id } });
  assert.equal(bad.status, 422);
});

test('only the sender can delete; deletion is pushed live', async () => {
  const sent = await ctx.request('POST', `/chat/conversations/${convId}/messages`, { token: A.token, body: { body: 'oops' } });
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${convId}/messages/${sent.body._id}`, { token: B.token })).status, 403);
  const gone = nextEvent(B.socket, 'chat:messageDeleted', (p) => p.messageId === sent.body._id);
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${convId}/messages/${sent.body._id}`, { token: A.token })).status, 200);
  await gone;
});

test('message search is limited to your own conversations', async () => {
  const mine = await ctx.request('GET', '/chat/search?q=browser', { token: B.token });
  assert.equal(mine.body.length, 1);
  const theirs = await ctx.request('GET', '/chat/search?q=browser', { token: C.token });
  assert.equal(theirs.body.length, 0);
});

test('groups: members added live, non-admins cannot add', async () => {
  const g = await ctx.request('POST', '/chat/conversations', {
    token: A.token,
    body: { type: 'group', name: 'Project team', participantIds: [String(B.user._id)] },
  });
  assert.equal(g.status, 201);
  assert.equal((await ctx.request('POST', `/chat/conversations/${g.body._id}/members`, { token: B.token, body: { userIds: [String(C.user._id)] } })).status, 403);
  const added = nextEvent(C.socket, 'chat:conversation', (p) => p.conversationId === g.body._id);
  assert.equal((await ctx.request('POST', `/chat/conversations/${g.body._id}/members`, { token: A.token, body: { userIds: [String(C.user._id)] } })).status, 200);
  await added;
});
