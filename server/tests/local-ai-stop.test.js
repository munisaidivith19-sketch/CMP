/**
 * AI Doubts emergency stop (server/ai/killSwitch.js): IT support only,
 * password re-entry, audited, cancels answers in progress, survives as a
 * lock file, and can only be undone from the terminal (no resume endpoint).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STOP_FILE = path.join(os.tmpdir(), `ai-stop-test-${process.pid}-${Date.now()}.json`);
process.env.LOCAL_AI_STOP_FILE = STOP_FILE;
process.env.LOCAL_AI_RATE_PER_MINUTE = '50';

const { startServer, PASSWORD, sleep } = await import('./helpers.js');
const { localAi } = await import('../ai/config.js');
const local = await import('../ai/localModelClient.js');
const kill = await import('../ai/killSwitch.js');

let ctx, sa, student, faculty;
let unloadCalls = 0;
let hold = false; // when true the fake model waits until aborted

function fakeOllama(url, init) {
  if (url.endsWith('/api/generate')) {
    unloadCalls += 1;
    return Promise.resolve(new Response('{}', { status: 200 }));
  }
  if (hold) {
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  }
  return Promise.resolve(new Response(JSON.stringify({ message: { content: 'Layer 3 routes packets.' }, done: true }), { status: 200 }));
}

const req = (method, url, who, body) => ctx.request(method, url, { token: who?.token, body });
const ask = (who, message, conversationId) => req('POST', '/ai/study-doubts/chat', who, { message, conversationId });
const stop = (who, reason = 'Model giving harmful answers') => req('POST', '/console/ai-doubts/emergency-stop', who, { reason });

before(async () => {
  ctx = await startServer();
  localAi.enabled = true;
  local.setLocalFetch(fakeOllama);
  // killSwitch.unloadModel uses the global fetch — route it to the fake too.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => (String(url).startsWith(localAi.url) ? fakeOllama(String(url), init) : realFetch(url, init));
  const mk = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginWeb(u)) };
  };
  sa = await mk({ role: 'super_admin', name: 'IT Owner' });
  student = await mk({ name: 'Stop Student', department: 'CSE', section: 'A', semester: 5, rollNo: 'ST-1' });
  faculty = await mk({ role: 'faculty', name: 'Stop Fac', department: 'CSE', employeeId: 'E-ST' });
});

after(async () => {
  local.setLocalFetch(null);
  fs.rmSync(STOP_FILE, { force: true });
  await ctx.stop();
});

test('only IT support can see AI status or press the emergency stop', async () => {
  assert.equal((await req('GET', '/console/ai-doubts/status', student)).status, 403);
  assert.equal((await req('GET', '/console/ai-doubts/status', faculty)).status, 403);
  assert.equal((await stop(student)).status, 403);
  assert.equal((await stop(faculty)).status, 403);
  const s = await req('GET', '/console/ai-doubts/status', sa);
  assert.equal(s.status, 200);
  assert.equal(s.body.running, true);
  assert.equal(s.body.stopped, false);
  assert.equal(fs.existsSync(STOP_FILE), false);
});

test('emergency stop needs the password re-entered and a reason', async () => {
  const r = await stop(sa);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'REAUTH_REQUIRED');
  assert.equal(fs.existsSync(STOP_FILE), false);
  assert.equal((await req('POST', '/console/reauth', sa, { password: PASSWORD })).status, 200);
  assert.equal((await stop(sa, 'no')).status, 422);
  assert.equal(fs.existsSync(STOP_FILE), false);
});

test('stop cancels an answer in progress, writes the lock file, unloads the model and is audited', async () => {
  const first = await ask(student, 'Explain the network layer');
  assert.equal(first.status, 200);
  const convoId = first.body.conversationId;

  hold = true;
  const pending = ask(student, 'Explain routing tables in detail', convoId);
  await sleep(150);
  unloadCalls = 0;
  const res = await stop(sa);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.stopped, true);
  assert.equal(res.body.aborted, 1);
  assert.equal(res.body.modelUnloaded, true);
  assert.equal(unloadCalls, 1);
  assert.match(res.body.resumeCommand, /npm run ai:resume/);

  const cancelled = await pending;
  hold = false;
  assert.equal(cancelled.status, 503);
  assert.match(cancelled.body.message, /switched off by IT support/);
  // The cancelled answer was not saved half-written.
  const convo = await ctx.models.LocalAIConversation.findById(convoId).lean();
  assert.equal(convo.messages.length, 2);

  const record = JSON.parse(fs.readFileSync(STOP_FILE, 'utf8'));
  assert.equal(record.by.id, String(sa.u._id));
  assert.equal(record.reason, 'Model giving harmful answers');
  await sleep(100);
  const audit = await ctx.models.AuditLog.findOne({ action: 'AI_EMERGENCY_STOP' }).lean();
  assert.ok(audit, 'audit record written');
  assert.equal(String(audit.actor), String(sa.u._id));
});

test('while stopped, every AI Doubts route is refused — the Groq assistant route is unaffected', async () => {
  const r = await ask(student, 'Explain the network layer');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'AI_STOPPED');
  assert.equal((await req('GET', '/ai/study-doubts/conversations', student)).status, 503);
  const s = await req('GET', '/console/ai-doubts/status', sa);
  assert.equal(s.body.stopped, true);
  assert.equal(s.body.running, false);
  assert.equal(s.body.stop.reason, 'Model giving harmful answers');
  // The existing Study Assistant is a different feature and keeps its own behaviour.
  assert.notEqual((await req('POST', '/ai/study-assistant/chat', student, { message: '' })).body.code, 'AI_STOPPED');
});

test('there is no way to resume from the web app', async () => {
  for (const p of ['/console/ai-doubts/resume', '/console/ai-doubts/start', '/console/ai-doubts/emergency-stop']) {
    const r = await req('DELETE', p, sa);
    assert.ok([404, 405].includes(r.status), `${p} → ${r.status}`);
  }
  assert.ok(fs.existsSync(STOP_FILE));
  // Pressing stop again keeps the original record.
  const again = await stop(sa, 'Pressed a second time');
  assert.equal(again.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(STOP_FILE, 'utf8')).reason, 'Model giving harmful answers');
});

test('the terminal resume (clearStop) turns AI back on without a restart', async () => {
  const removed = kill.clearStop();
  assert.equal(removed.reason, 'Model giving harmful answers');
  assert.equal(fs.existsSync(STOP_FILE), false);
  const r = await ask(student, 'Explain the network layer');
  assert.equal(r.status, 200);
});

test('an unreadable stop file fails closed (AI stays off)', async () => {
  fs.writeFileSync(STOP_FILE, 'not json');
  assert.equal((await ask(student, 'Explain the network layer')).status, 503);
  kill.clearStop();
});

test('LOCAL_AI_ENABLED=false in .env switches AI off', async () => {
  localAi.enabled = false;
  const r = await ask(student, 'Explain the network layer');
  localAi.enabled = true;
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'AI_DISABLED');
});
