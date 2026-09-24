/**
 * Live cross-client check against a RUNNING server (default http://localhost:5000):
 * a "web" user (cookie session) and an "Android" user (mobile session, refresh
 * token in the body) exchange chat messages over REST + Socket.io.
 *
 *   node scripts/realtime-smoke.mjs [baseUrl] [webEmail] [mobileEmail] [password]
 *
 * It creates one private conversation between the two accounts and deletes it
 * (with its messages) at the end. Uses the demo accounts by default.
 */
import mongoose from 'mongoose';
import { io } from 'socket.io-client';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
const [base = 'http://localhost:5000', webEmail = 'student@campus.edu', mobileEmail = 'arjun@campus.edu', password = 'Password@123'] = process.argv.slice(2);

const call = async (path, { token, body, headers = {}, method = body ? 'POST' : 'GET' } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.message}`);
  return json;
};
const next = (socket, event, pred = () => true, ms = 4000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no "${event}" within ${ms}ms`)), ms);
    const fn = (p) => {
      if (!pred(p)) return;
      clearTimeout(t);
      socket.off(event, fn);
      resolve(p);
    };
    socket.on(event, fn);
  });
const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(base, { transports: ['websocket'], auth: { token }, reconnection: false });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
const ok = (msg) => console.log(`  ✔ ${msg}`);

const web = await call('/auth/login', { body: { email: webEmail, password } });
const phone = await call('/auth/login', {
  body: { email: mobileEmail, password },
  headers: { 'x-client-platform': 'mobile', 'x-device-name': 'Smoke-test Android', 'user-agent': 'okhttp/4.12' },
});
if (!phone.refreshToken) throw new Error('mobile login did not return a refresh token');
ok(`web signed in as ${web.user.name}; Android signed in as ${phone.user.name} (refresh token in body)`);

const webSocket = await connect(web.accessToken);
const phoneSocket = await connect(phone.accessToken);
ok('both clients connected to the same Socket.io server');

const conv = await call('/chat/conversations', { token: web.accessToken, body: { participantIds: [phone.user._id] } });
await new Promise((r) => webSocket.emit('chat:join', conv._id, r));
await new Promise((r) => phoneSocket.emit('chat:join', conv._id, r));

let t0 = Date.now();
const onPhone = next(phoneSocket, 'chat:message', (p) => p.conversationId === conv._id);
const m1 = await call(`/chat/conversations/${conv._id}/messages`, { token: web.accessToken, body: { body: 'Hello from the browser 👋' } });
await onPhone;
ok(`Browser → Android delivered live in ${Date.now() - t0} ms`);

t0 = Date.now();
const onWeb = next(webSocket, 'chat:message', (p) => p.conversationId === conv._id);
const typing = next(webSocket, 'chat:typing', (p) => p.conversationId === conv._id);
phoneSocket.emit('chat:typing', { conversationId: conv._id, isTyping: true });
await typing;
ok('Android typing indicator shown on web');
const m2 = await call(`/chat/conversations/${conv._id}/messages`, {
  token: phone.accessToken,
  headers: { 'x-client-platform': 'mobile' },
  body: { body: 'Hi from Android 📱', replyTo: m1._id },
});
await onWeb;
ok(`Android → Browser delivered live in ${Date.now() - t0} ms`);

const receipt = next(phoneSocket, 'chat:read', (p) => p.conversationId === conv._id);
webSocket.emit('chat:read', { conversationId: conv._id });
await receipt;
ok('read receipt from web reached Android');

// Persistence: read straight from MongoDB, then refetch history like a reload would.
await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cmp');
const stored = await mongoose.connection.db.collection('messages').find({ conversation: new mongoose.Types.ObjectId(conv._id) }).sort({ createdAt: 1 }).toArray();
if (stored.map((m) => m.body).join('|') !== 'Hello from the browser 👋|Hi from Android 📱') throw new Error('MongoDB does not hold both messages');
ok('both messages are persisted in MongoDB');
const history = await call(`/chat/conversations/${conv._id}/messages`, { token: phone.accessToken });
if (history.messages.length !== 2 || String(history.messages[1].replyTo?._id) !== String(m1._id)) throw new Error('history after reload is wrong');
ok('history after "refresh" is complete and ordered (reply link intact)');

// Mobile refresh-token rotation works against the live server.
const rotated = await call('/auth/refresh', { headers: { 'x-client-platform': 'mobile' }, body: { refreshToken: phone.refreshToken } });
if (!rotated.refreshToken || rotated.refreshToken === phone.refreshToken) throw new Error('mobile refresh did not rotate');
ok('Android refresh token rotated');

// Clean up the smoke-test data and both test sessions.
await mongoose.connection.db.collection('messages').deleteMany({ conversation: new mongoose.Types.ObjectId(conv._id) });
await mongoose.connection.db.collection('conversations').deleteOne({ _id: new mongoose.Types.ObjectId(conv._id) });
await call('/auth/logout', { headers: { 'x-client-platform': 'mobile' }, body: { refreshToken: rotated.refreshToken } });
await mongoose.disconnect();
webSocket.disconnect();
phoneSocket.disconnect();
void m2;
console.log('\nWeb ↔ Android real-time smoke test passed; test conversation removed.');
