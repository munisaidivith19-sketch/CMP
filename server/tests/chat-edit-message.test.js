import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, nextEvent, emitAck } from './helpers.js';

let ctx;
let admin, userA, userB, userC;
let privateConvId, groupConvId;

before(async () => {
  ctx = await startServer();
  const cls = { department: 'CSE', section: 'A', year: 3, semester: 5 };
  const [uAdmin, ua, ub, uc] = await Promise.all([
    ctx.createUser({ role: 'admin', name: 'Admin User' }),
    ctx.createUser({ name: 'Alice', ...cls }),
    ctx.createUser({ name: 'Bala', ...cls }),
    ctx.createUser({ name: 'Chitra', ...cls }),
  ]);
  admin = { user: uAdmin, ...(await ctx.loginWeb(uAdmin)) };
  userA = { user: ua, ...(await ctx.loginWeb(ua)) };
  userB = { user: ub, ...(await ctx.loginWeb(ub)) };
  userC = { user: uc, ...(await ctx.loginWeb(uc)) };

  admin.socket = await ctx.connect(admin.token);
  userA.socket = await ctx.connect(userA.token);
  userB.socket = await ctx.connect(userB.token);

  // Create private conversation between Alice and Bala
  const pRes = await ctx.request('POST', '/chat/conversations', {
    token: userA.token,
    body: { participantIds: [String(userB.user._id)] },
  });
  privateConvId = pRes.body._id;

  // Create group conversation with Alice, Bala, and Admin
  const gRes = await ctx.request('POST', '/chat/conversations', {
    token: admin.token,
    body: {
      type: 'group',
      name: 'Test Group Chat',
      participantIds: [String(userA.user._id), String(userB.user._id)],
    },
  });
  groupConvId = gRes.body._id;

  // Join group socket room
  await emitAck(admin.socket, 'chat:join', groupConvId);
  await emitAck(userA.socket, 'chat:join', groupConvId);
  await emitAck(userB.socket, 'chat:join', groupConvId);
});

after(async () => {
  await ctx.stop();
});

test('Message deletion is completely disabled for all users in private chats', async () => {
  const sent = await ctx.request('POST', `/chat/conversations/${privateConvId}/messages`, {
    token: userA.token,
    body: { body: 'Private message to test delete prevention' },
  });
  assert.equal(sent.status, 201);
  const msgId = sent.body._id;

  // Recipient cannot delete
  const recDel = await ctx.request('DELETE', `/chat/conversations/${privateConvId}/messages/${msgId}`, {
    token: userB.token,
  });
  assert.equal(recDel.status, 403);
  assert.equal(recDel.body.message, 'Message deletion is not allowed');

  // Sender cannot delete
  const senderDel = await ctx.request('DELETE', `/chat/conversations/${privateConvId}/messages/${msgId}`, {
    token: userA.token,
  });
  assert.equal(senderDel.status, 403);
  assert.equal(senderDel.body.message, 'Message deletion is not allowed');
});

test('Message deletion is completely disabled for all users in group chats', async () => {
  const sent = await ctx.request('POST', `/chat/conversations/${groupConvId}/messages`, {
    token: userA.token,
    body: { body: 'Group message to test delete prevention' },
  });
  assert.equal(sent.status, 201);
  const msgId = sent.body._id;

  // Group member cannot delete
  const memberDel = await ctx.request('DELETE', `/chat/conversations/${groupConvId}/messages/${msgId}`, {
    token: userB.token,
  });
  assert.equal(memberDel.status, 403);
  assert.equal(memberDel.body.message, 'Message deletion is not allowed');

  // Group admin cannot delete member message
  const adminDel = await ctx.request('DELETE', `/chat/conversations/${groupConvId}/messages/${msgId}`, {
    token: admin.token,
  });
  assert.equal(adminDel.status, 403);
  assert.equal(adminDel.body.message, 'Message deletion is not allowed');

  // Sender cannot delete
  const senderDel = await ctx.request('DELETE', `/chat/conversations/${groupConvId}/messages/${msgId}`, {
    token: userA.token,
  });
  assert.equal(senderDel.status, 403);
  assert.equal(senderDel.body.message, 'Message deletion is not allowed');
});

test('Private chats do NOT allow editing messages', async () => {
  const sent = await ctx.request('POST', `/chat/conversations/${privateConvId}/messages`, {
    token: userA.token,
    body: { body: 'Private message cannot be edited' },
  });
  assert.equal(sent.status, 201);
  const msgId = sent.body._id;

  const editRes = await ctx.request('PATCH', `/chat/conversations/${privateConvId}/messages/${msgId}`, {
    token: userA.token,
    body: { body: 'Attempted edit in private chat' },
  });
  assert.equal(editRes.status, 403);
  assert.equal(editRes.body.message, 'Messages cannot be edited in private chats');
});

test('Group chats: sender can edit message within 5 minutes and edits broadcast in real time', async () => {
  const sent = await ctx.request('POST', `/chat/conversations/${groupConvId}/messages`, {
    token: userA.token,
    body: { body: 'Original group message text' },
  });
  assert.equal(sent.status, 201);
  const msgId = sent.body._id;

  // Listen for socket broadcast to other members
  const socketEditedEvent = nextEvent(userB.socket, 'chat:messageEdited', (p) => p.conversationId === groupConvId && p.message._id === msgId);

  const editRes = await ctx.request('PATCH', `/chat/conversations/${groupConvId}/messages/${msgId}`, {
    token: userA.token,
    body: { body: 'Edited group message text' },
  });
  assert.equal(editRes.status, 200);
  assert.equal(editRes.body.body, 'Edited group message text');
  assert.ok(editRes.body.editedAt, 'editedAt must be populated');

  // Verify socket event payload
  const evt = await socketEditedEvent;
  assert.equal(evt.message._id, msgId);
  assert.equal(evt.message.body, 'Edited group message text');
  assert.ok(evt.message.editedAt);

  // Verify conversation lastMessage updated
  const conv = await ctx.request('GET', `/chat/conversations/${groupConvId}`, { token: userA.token });
  assert.equal(conv.body.lastMessage.body, 'Edited group message text');

  // Verify message list returns updated body and editedAt
  const list = await ctx.request('GET', `/chat/conversations/${groupConvId}/messages`, { token: userB.token });
  const fetchedMsg = list.body.messages.find((m) => m._id === msgId);
  assert.ok(fetchedMsg);
  assert.equal(fetchedMsg.body, 'Edited group message text');
  assert.ok(fetchedMsg.editedAt);
});

test('Group chats: non-sender cannot edit someone else message', async () => {
  const sent = await ctx.request('POST', `/chat/conversations/${groupConvId}/messages`, {
    token: userA.token,
    body: { body: 'Alice message' },
  });
  assert.equal(sent.status, 201);
  const msgId = sent.body._id;

  // Bala tries to edit Alice's message
  const editRes = await ctx.request('PATCH', `/chat/conversations/${groupConvId}/messages/${msgId}`, {
    token: userB.token,
    body: { body: 'Bala tampering with Alice message' },
  });
  assert.equal(editRes.status, 403);
  assert.equal(editRes.body.message, 'You can only edit your own messages');
});

test('Group chats: sender cannot edit message after 5 minutes have elapsed', async () => {
  const sent = await ctx.request('POST', `/chat/conversations/${groupConvId}/messages`, {
    token: userA.token,
    body: { body: 'Old message to be expired' },
  });
  assert.equal(sent.status, 201);
  const msgId = sent.body._id;

  // Fast forward createdAt in database to 6 minutes ago via raw collection to bypass Mongoose timestamp overwrite
  const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
  await ctx.models.Message.collection.updateOne(
    { _id: new ctx.models.Message.base.Types.ObjectId(msgId) },
    { $set: { createdAt: sixMinutesAgo } }
  );

  // Alice tries to edit after 5 minutes
  const editRes = await ctx.request('PATCH', `/chat/conversations/${groupConvId}/messages/${msgId}`, {
    token: userA.token,
    body: { body: 'Trying to edit after 5 minutes' },
  });
  assert.equal(editRes.status, 403);
  assert.equal(editRes.body.message, 'Messages can only be edited within 5 minutes of sending');
});

test('Editing validation: empty or overly long message bodies are rejected', async () => {
  const sent = await ctx.request('POST', `/chat/conversations/${groupConvId}/messages`, {
    token: userA.token,
    body: { body: 'Valid message' },
  });
  assert.equal(sent.status, 201);
  const msgId = sent.body._id;

  // Empty string
  const emptyRes = await ctx.request('PATCH', `/chat/conversations/${groupConvId}/messages/${msgId}`, {
    token: userA.token,
    body: { body: '   ' },
  });
  assert.equal(emptyRes.status, 422);

  // Over 5000 characters
  const longRes = await ctx.request('PATCH', `/chat/conversations/${groupConvId}/messages/${msgId}`, {
    token: userA.token,
    body: { body: 'a'.repeat(5001) },
  });
  assert.equal(longRes.status, 422);
});
