#!/usr/bin/env node
/**
 * Terminal control for the self-hosted AI Doubts model. Run on the server:
 *
 *   npm run ai:status            is AI running, switched off in .env, or emergency-stopped?
 *   npm run ai:stop -- "reason"  emergency stop from the terminal
 *   npm run ai:resume            turn AI back on after an emergency stop
 *                                (asks for confirmation; add -- --yes to skip)
 *
 * Turning AI back on is ONLY possible here — the web app has no resume button.
 */
import os from 'node:os';
import readline from 'node:readline/promises';
import { localAi } from './config.js';
import { STOP_FILE, clearStop, emergencyStop, stopState } from './killSwitch.js';

const [cmd = 'status', ...rest] = process.argv.slice(2);
const yes = rest.includes('--yes') || rest.includes('-y');
const reasonArg = rest.filter((a) => !a.startsWith('-')).join(' ').trim();

const red = (t) => `\x1b[31m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;

function describe(stop) {
  const by = stop.by ? [stop.by.name, stop.by.email || stop.by.user, stop.by.role].filter(Boolean).join(', ') : 'unknown';
  return [`  Stopped at : ${stop.stoppedAt ? new Date(stop.stoppedAt).toLocaleString() : 'unknown'}`, `  Stopped by : ${by} (${stop.source || 'unknown'})`, `  Reason     : ${stop.reason || '—'}`].join('\n');
}

async function ollamaUp() {
  try {
    const res = await fetch(`${localAi.url}/api/ps`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { up: false };
    const data = await res.json();
    return { up: true, loaded: (data.models || []).map((m) => m.name) };
  } catch {
    return { up: false };
  }
}

async function status() {
  const stop = stopState();
  const o = await ollamaUp();
  console.log(`AI Doubts (model "${localAi.model}")`);
  if (stop) {
    console.log(red('  State      : EMERGENCY STOPPED'));
    console.log(describe(stop));
    console.log(`  Turn back on: ${yellow('npm run ai:resume')}`);
  } else if (!localAi.enabled) {
    console.log(yellow('  State      : OFF in server/.env (LOCAL_AI_ENABLED is not true)'));
  } else {
    console.log(green('  State      : ON'));
  }
  console.log(`  .env switch: LOCAL_AI_ENABLED=${localAi.enabled ? 'true' : 'false'}`);
  console.log(`  Ollama     : ${o.up ? `running at ${localAi.url}, loaded: ${o.loaded.join(', ') || 'none'}` : red(`not reachable at ${localAi.url}`)}`);
  console.log(`  Stop file  : ${STOP_FILE}${stop ? '' : ' (absent)'}`);
}

async function stop() {
  const reason = reasonArg || 'Stopped from the server terminal';
  const by = { user: os.userInfo().username, host: os.hostname(), role: 'terminal' };
  const r = await emergencyStop({ by, reason, source: 'terminal' });
  console.log(red(r.alreadyStopped ? 'AI Doubts was already emergency-stopped.' : 'AI Doubts EMERGENCY STOPPED.'));
  console.log(describe(r.record));
  console.log(`  Model unloaded from memory: ${r.unloaded ? 'yes' : 'no (Ollama not reachable or model not loaded)'}`);
  console.log('  The running API refuses AI requests now and cancels answers in progress within a few seconds.');
  console.log(`  Turn back on: ${yellow('npm run ai:resume')}`);
}

async function resume() {
  const stop = stopState();
  if (!stop) {
    console.log(green('AI Doubts is not emergency-stopped — nothing to resume.'));
    if (!localAi.enabled) console.log(yellow('Note: it is OFF in server/.env. Set LOCAL_AI_ENABLED=true and restart the API to turn it on.'));
    return;
  }
  console.log(red('AI Doubts is EMERGENCY STOPPED:'));
  console.log(describe(stop));
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.log('Not an interactive terminal. Re-run with --yes to confirm: npm run ai:resume -- --yes');
      process.exitCode = 1;
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('Turn AI Doubts back on? Type "yes" to confirm: ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'yes') {
      console.log('Cancelled. AI stays stopped.');
      return;
    }
  }
  clearStop();
  console.log(green('AI Doubts is back ON.') + ' Students can ask questions again; the model loads on the first question.');
  if (!localAi.enabled) console.log(yellow('Note: LOCAL_AI_ENABLED is not true in server/.env, so AI stays off until you set it and restart the API.'));
  const o = await ollamaUp();
  if (!o.up) console.log(yellow(`Warning: Ollama is not reachable at ${localAi.url}. Start it with: sudo systemctl start ollama`));
}

const commands = { status, stop, resume };
if (!commands[cmd]) {
  console.log('Usage: npm run ai:status | npm run ai:stop -- "reason" | npm run ai:resume');
  process.exitCode = 1;
} else {
  await commands[cmd]();
}
