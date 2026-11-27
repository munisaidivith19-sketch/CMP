import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localAi } from './config.js';
import { abortAll } from './localModelClient.js';

/**
 * Emergency stop for the self-hosted Study Doubts model.
 *
 * The stop is a lock file on the server's disk, so it survives API restarts
 * and deploys. Nothing in the web app can remove it: AI comes back only when
 * someone with terminal access on the server runs `npm run ai:resume`.
 *
 * While the file exists:
 *   - every AI Doubts request is refused (router gate),
 *   - answers that were being generated are cancelled (nothing half-written is saved),
 *   - the model is unloaded from memory.
 * A stop made from the terminal (`npm run ai:stop`) is picked up by the
 * running API within a few seconds.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const STOP_FILE = path.resolve(process.env.LOCAL_AI_STOP_FILE || path.join(here, '.emergency-stop.json'));

/** The stop record, or null when AI is not stopped. */
export function stopState() {
  try {
    const raw = fs.readFileSync(STOP_FILE, 'utf8');
    try {
      return JSON.parse(raw);
    } catch {
      return { stoppedAt: null, reason: 'Stop file present (unreadable contents)' };
    }
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    // Can't tell (permissions etc.) → fail closed: treat as stopped.
    return { stoppedAt: null, reason: 'Stop file could not be read' };
  }
}

export const isStopped = () => stopState() !== null;

/** Ask every Ollama instance to drop the models from memory right now (best effort). */
export async function unloadModel() {
  const models = [...new Set([localAi.model, localAi.fallbackModel].filter(Boolean))];
  const one = async (url, model) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
  const results = await Promise.all(localAi.urls.flatMap((url) => models.map((m) => one(url, m))));
  return results.length > 0 && results.some(Boolean);
}

/** Cancel everything in progress and free the model's memory. */
async function terminate() {
  const { aborted, queued } = abortAll();
  const unloaded = await unloadModel();
  return { aborted, queued, unloaded };
}

/**
 * Write the stop file and terminate AI. Idempotent: stopping again keeps the
 * first record (who stopped it and why) and just terminates again.
 */
export async function emergencyStop({ by, reason, source = 'console' }) {
  let record = stopState();
  const alreadyStopped = Boolean(record);
  if (!record) {
    record = { stoppedAt: new Date().toISOString(), source, by, reason };
    fs.mkdirSync(path.dirname(STOP_FILE), { recursive: true });
    // 'wx' = create only; a concurrent stop just keeps the first record.
    try {
      fs.writeFileSync(STOP_FILE, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      record = stopState();
    }
  }
  const result = await terminate();
  return { record, alreadyStopped, ...result };
}

/** Terminal only (ai/aictl.mjs). Returns the record that was removed, or null. */
export function clearStop() {
  const record = stopState();
  try {
    fs.unlinkSync(STOP_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return record;
}

// A stop made from the terminal (another process) still terminates
// in-flight answers in this API process within a few seconds.
let wasStopped = isStopped();
const watcher = setInterval(() => {
  const now = isStopped();
  if (now && !wasStopped) terminate().catch(() => {});
  wasStopped = now;
}, 3000);
watcher.unref?.();
