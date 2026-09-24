/**
 * Integration-test harness: a real Express + Socket.io server on a random port,
 * backed by a throw-away MongoDB database (never the development database).
 */
import http from 'node:http';
import { io as ioClient } from 'socket.io-client';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/cmp_test';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_access_secret_'.padEnd(48, 'x');
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_'.padEnd(48, 'y');
process.env.SMTP_HOST = '';

const { default: mongoose } = await import('mongoose');
const { connectDB } = await import('../src/config/db.js');
const { initSocket } = await import('../src/config/socket.js');
const { createApp } = await import('../src/app.js');
const { default: User } = await import('../src/models/User.js');

export const PASSWORD = 'Password@123';

export async function startServer() {
  if (!/_test$/.test(mongoose.connection?.name || process.env.MONGO_URI.split('/').pop().split('?')[0])) {
    throw new Error('Refusing to run tests against a non-test database');
  }
  await connectDB(process.env.MONGO_URI);
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];

  const ctx = {
    base,
    models: mongoose.models,
    async stop() {
      sockets.forEach((s) => s.disconnect());
      await new Promise((resolve) => server.close(resolve));
      await mongoose.connection.db.dropDatabase();
      await mongoose.disconnect();
    },

    async createUser(overrides = {}) {
      const n = Math.random().toString(36).slice(2, 8);
      return User.create({ name: `User ${n}`, email: `u${n}@test.edu`, password: PASSWORD, role: 'student', ...overrides });
    },

    /** Raw JSON request. Returns { status, body, headers }. */
    async request(method, path, { token, body, headers = {}, cookie } = {}) {
      const res = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'user-agent': headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: res.status, body: json, headers: res.headers };
    },

    /** Sign in as a web browser: refresh token arrives as an httpOnly cookie. */
    async loginWeb(user) {
      const res = await ctx.request('POST', '/auth/login', { body: { email: user.email, password: PASSWORD } });
      if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
      const setCookie = res.headers.get('set-cookie') || '';
      const cookie = setCookie.split(';')[0];
      return { token: res.body.accessToken, user: res.body.user, cookie };
    },

    /** Sign in as the Android app: refresh token arrives in the body. */
    async loginMobile(user) {
      const res = await ctx.request('POST', '/auth/login', {
        body: { email: user.email, password: PASSWORD },
        headers: { 'x-client-platform': 'mobile', 'x-device-name': 'Pixel 8', 'user-agent': 'okhttp/4.12.0' },
      });
      if (res.status !== 200) throw new Error(`mobile login failed ${res.status} ${JSON.stringify(res.body)}`);
      return { token: res.body.accessToken, user: res.body.user, refreshToken: res.body.refreshToken };
    },

    /** Connect a Socket.io client exactly like the web / Android apps do. */
    async connect(token, { expectFail = false } = {}) {
      const socket = ioClient(base, { transports: ['websocket'], auth: { token }, reconnection: false, forceNew: true });
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('socket connect timeout')), 4000);
        socket.once('connect', () => {
          clearTimeout(t);
          expectFail ? reject(new Error('expected connection to be refused')) : resolve();
        });
        socket.once('connect_error', (err) => {
          clearTimeout(t);
          expectFail ? resolve(err) : reject(err);
        });
      });
      return socket;
    },
  };
  return ctx;
}

/** Resolve with the next `event` payload (optionally matching a predicate), or reject after a timeout. */
export function nextEvent(socket, event, predicate = () => true, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeout);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(t);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

/** Resolve true if `event` does NOT arrive within `ms`. */
export function noEvent(socket, event, ms = 600) {
  return new Promise((resolve) => {
    let got = false;
    const handler = () => {
      got = true;
    };
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve(!got);
    }, ms);
  });
}

export const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, (ack) => resolve(ack)));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
