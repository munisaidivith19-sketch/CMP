import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { localAi } from './config.js';
import { REFUSALS, STRIKE_CATEGORIES, checkConversation, looksLikeInjection, normalizeForCheck, scrubOutput } from './scopeGuard.js';
import { activity, chat, LocalAIError } from './localModelClient.js';
import { CANARY, REFUSAL_LINE, createLeakDetector, leaksPrompt, systemPrompt } from './prompt.js';
import { createLoopDetector, createOutputMonitor, inspectOutput } from './outputGuard.js';
import { emergencyStop } from './killSwitch.js';
import { addStrike, assertNotBlocked } from './strikes.js';
import * as credits from './credits.js';
import { digestFor, loadAttachable, materialVersion, parseReference, retrieveFromMaterial } from './materials.js';
import LocalAIConversation from './LocalAIConversation.js';
import { LocalAIAnswerCache } from './models.js';
import { logAudit } from '../src/utils/auditLog.js';
// Read-only reuse of the existing, already-authorized retrieval. These modules
// are not modified; they only ever return materials the user may read.
import StudyMaterial from '../src/models/StudyMaterial.js';
import { materialReadFilter } from '../src/utils/studyMaterialScope.js';
import { gatherContext } from '../src/services/ai/sources/index.js';
import { contextBlock, retrievalQuery } from '../src/services/ai/prompts.js';

/**
 * Self-hosted Study Doubts assistant — separate from the Groq Study Assistant.
 *
 *   question → blocked? → one question at a time → chat not full →
 *   strict input guard (single + multi-turn; misuse = strike) →
 *   authorized retrieval (all the student's materials, or the ONE material
 *   they attached) → shared answer cache → credits reserved →
 *   local model in a fair queue (no tools, no DB, no web) →
 *   output guards (prompt leak, tripwire → emergency stop, sexual content) →
 *   scrub → credits settled by answer size → saved to the student's own chat
 *
 * Saved chats: at most `maxConversations` per user, each deleted
 * `retentionHours` after it was started, at most `maxQuestionsPerConversation`
 * questions each. The model only "remembers" the last `memoryMinutes`.
 */

// "explain … in Telugu": small models often ignore this unless it's said plainly.
const LANGUAGES = { telugu: 'Telugu (తెలుగు script)', hindi: 'Hindi (देवनागरी script)', tamil: 'Tamil (தமிழ் script)', kannada: 'Kannada (ಕನ್ನಡ script)', malayalam: 'Malayalam (മലയാളം script)', marathi: 'Marathi', bengali: 'Bengali', urdu: 'Urdu', english: 'English' };
export function requestedLanguage(text) {
  const m = /\b(?:in|into|using|use)\s+(telugu|hindi|tamil|kannada|malayalam|marathi|bengali|urdu|english)\b/i.exec(text) || /\b(telugu|hindi|tamil|kannada|malayalam)\s+(?:lo|me|mein|language|translation)\b/i.exec(text);
  return m ? LANGUAGES[m[1].toLowerCase()] : null;
}

/**
 * Exam answers: "explain … for 13 marks", "16M", "2 mark question", "long answer",
 * or a Part A / B / C question of the attached material. Returns the marks, or null.
 */
export function examMarks(text, ref = parseReference(text)) {
  const t = String(text || '');
  const m = /\b(\d{1,2})\s*-?\s*(?:marks?|mks?|m)\b/i.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 20) return Number(m[1]);
  if (/\b(?:long|big|essay|descriptive)[\s-]*(?:type\s*)?(?:answer|question)s?\b|\bessay\b/i.test(t)) return 13;
  if (/\bshort[\s-]*(?:answer|note)s?\b/i.test(t)) return 2;
  if (ref?.part) return { A: 2, B: 13, C: 15 }[ref.part] || null;
  return null;
}

// "continue" after an answer that reached the length limit.
const CONTINUE = /^\s*(?:please\s+|pls\s+|ok\s+)?(?:continue|go on|keep going|carry on|cont|continue (?:the |your )?(?:answer|rest)|(?:give|show|write) (?:me )?the rest|rest of (?:the )?answer)\s*(?:please|pls)?\s*[.!]*\s*$/i;
export const isContinue = (text) => CONTINUE.test(String(text || ''));

/** Output tokens for an exam answer of this many marks. */
function examTokens(marks) {
  const want = marks <= 2 ? localAi.shortOutputTokens : marks <= 6 ? 600 : marks <= 10 ? 1000 : localAi.examOutputTokens;
  return Math.min(want, localAi.examOutputTokens);
}

/**
 * An answer that hit the token limit stops mid-sentence. Cut it back to the
 * last complete line or sentence and tell the student how to get the rest.
 */
export const CONTINUE_NOTE = '\n\n*(This answer reached its length limit. Type **continue** to get the rest.)*';
export function endCleanly(text) {
  const t = String(text || '').replace(/\s+$/, '');
  const line = t.lastIndexOf('\n');
  const sentence = Math.max(...['. ', '! ', '? ', '.\n', '!\n', '?\n'].map((p) => t.lastIndexOf(p)));
  // Keep a complete last line if it ends a sentence; otherwise the last full stop or line break.
  if (/[.!?:)|*`]$/.test(t)) return t;
  const cut = Math.max(line, sentence >= 0 ? sentence + 1 : -1);
  return cut > t.length * 0.5 ? t.slice(0, cut).replace(/\s+$/, '') : t;
}

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code, expose: true });
const live = (user) => ({ user: user._id, expiresAt: { $gt: new Date() } });
const MODES = new Set(['short', 'detailed']); // 'exam' is chosen by the server from the question
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// One question at a time per student (a second tab waits for the first).
const answering = new Set();

async function loadConversation(user, conversationId) {
  if (!conversationId) return null;
  if (!mongoose.isValidObjectId(conversationId)) throw httpError(400, 'Invalid chat id');
  const convo = await LocalAIConversation.findOne({ _id: conversationId, ...live(user) }).lean();
  if (!convo) throw httpError(404, 'This chat has expired or was deleted. Please start a new chat.');
  return convo;
}

const questionCount = (messages = []) => messages.filter((m) => m.role === 'user').length;

/** Messages from the last `memoryMinutes` — older ones are not shown to the model. */
export function recentMessages(messages = [], now = Date.now()) {
  const since = now - localAi.memoryMinutes * 60 * 1000;
  return messages.filter((m) => new Date(m.createdAt || 0).getTime() >= since);
}

/**
 * Earlier messages the model may see. Refused exchanges are dropped entirely
 * (the question and the refusal), so an out-of-scope request can never be
 * smuggled in as "context". Old [S#] tags are removed — they pointed at an
 * earlier turn's excerpts.
 */
export function modelHistory(messages, keep = localAi.historyMessages) {
  const out = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.refused) continue;
    if (m.role === 'user' && messages[i + 1]?.refused) continue;
    out.push({ role: m.role, content: String(m.content).replace(/ ?\[S\d+\]/g, '').slice(0, 2000) });
  }
  return keep > 0 ? out.slice(-keep) : [];
}

async function saveTurn(user, convo, question, answer, { mode, material } = {}) {
  const now = new Date();
  const msgs = [
    { role: 'user', content: question, mode: mode === 'short' ? undefined : mode, material: material ? { id: material._id, title: String(material.title || '').slice(0, 200) } : undefined, createdAt: now },
    { role: 'assistant', ...answer, createdAt: new Date(now.getTime() + 1) },
  ];
  if (convo) {
    const saved = await LocalAIConversation.findOneAndUpdate(
      { _id: convo._id, ...live(user) },
      { $push: { messages: { $each: msgs, $slice: -(localAi.maxQuestionsPerConversation * 2 + 10) } } },
      { returnDocument: 'after' }
    ).lean();
    if (!saved) throw httpError(404, 'This chat has expired or was deleted. Please start a new chat.');
    return saved;
  }
  const created = (
    await LocalAIConversation.create({
      user: user._id,
      title: question.replace(/\s+/g, ' ').slice(0, 80),
      messages: msgs,
      expiresAt: new Date(now.getTime() + localAi.retentionHours * 3600 * 1000),
    })
  ).toObject();
  // Keep only the newest N chats: drop the least recently used beyond the cap.
  const extra = await LocalAIConversation.find({ user: user._id }).sort({ updatedAt: -1, _id: -1 }).skip(localAi.maxConversations).select('_id').lean();
  if (extra.length) await LocalAIConversation.deleteMany({ user: user._id, _id: { $in: extra.map((x) => x._id) } });
  return created;
}

const result = (saved) => ({
  conversationId: String(saved._id),
  title: saved.title,
  expiresAt: saved.expiresAt,
  questionsLeft: Math.max(0, localAi.maxQuestionsPerConversation - questionCount(saved.messages)),
  message: saved.messages[saved.messages.length - 1],
});

// ── Shared answer cache ──────────────────────────────────────────────

const normalizeQuestion = (q) =>
  normalizeForCheck(q)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function cacheKey({ text, mode, prompt, model, items }) {
  const evidence = items.map((it) => it.id || sha(`${it.source.materialId}|${it.source.page}|${it.text}`));
  return sha(JSON.stringify({ v: 1, q: normalizeQuestion(text), mode, model, p: sha(prompt.split(CANARY).join('')), e: evidence }));
}

async function cachedAnswer(user, key) {
  if (!localAi.answerCacheHours) return null;
  const hit = await LocalAIAnswerCache.findOne({ key, expiresAt: { $gt: new Date() } }).lean();
  if (!hit) return null;
  // Re-check access: every material behind the answer must still be readable by THIS student.
  const ids = [...new Set((hit.materialIds || []).map(String))];
  if (ids.length) {
    const readable = await StudyMaterial.countDocuments({ _id: { $in: ids }, ...materialReadFilter(user) });
    if (readable !== ids.length) return null;
  }
  LocalAIAnswerCache.updateOne({ _id: hit._id }, { $inc: { hits: 1 } }).catch(() => {});
  return hit;
}

function storeAnswer({ key, content, sources, mode, material, items }) {
  if (!localAi.answerCacheHours) return;
  const materialIds = [...new Set(items.map((it) => String(it.source.materialId)).filter((id) => mongoose.isValidObjectId(id)))];
  LocalAIAnswerCache.updateOne(
    { key },
    { $set: { content, sources, mode, material: material?._id, materialIds, expiresAt: new Date(Date.now() + localAi.answerCacheHours * 3600 * 1000) }, $setOnInsert: { key, hits: 0 } },
    { upsert: true }
  ).catch((err) => console.warn('[local-ai] answer cache write failed:', err.message));
}

// ── Tripwire ─────────────────────────────────────────────────────────

async function tripwire(user, kind, req) {
  console.error(`[local-ai] TRIPWIRE (${kind}) — model output contained ${kind}; switching AI Doubts off (user ${user._id})`);
  const result = await emergencyStop({
    by: { id: 'system', role: 'tripwire', name: 'Automatic tripwire' },
    reason: `Automatic stop: the model's answer contained ${kind.replace(/_/g, ' ')} (question from user ${user._id}).`,
    source: 'tripwire',
  }).catch((err) => {
    console.error('[local-ai] tripwire could not write the stop file:', err.message);
    return null;
  });
  await logAudit(req, 'AI_TRIPWIRE', { actor: user, target: user, outcome: 'denied', reason: `Model output contained ${kind}`, details: { kind, aborted: result?.aborted, modelUnloaded: result?.unloaded } });
  await addStrike(user, 'tripwire', req).catch(() => {});
}

/**
 * @param {object} o
 * @param {object} o.user      authenticated user (req.user) — the ONLY input to retrieval scope
 * @param {string} [o.conversationId]
 * @param {string} o.message
 * @param {'short'|'detailed'} [o.mode]   short first; "Explain in detail" sends detailed; marks in the question → exam
 * @param {string} [o.materialId]  study material the student attached
 * @param {Function} [o.onDelta]   streamed answer text
 * @param {Function} [o.onEvent]   (name, data): 'queue' {position}, 'cached'
 * @param {object} [o.req]         for audit records
 */
export async function askLocal({ user, conversationId, message, mode = 'short', materialId, onDelta, onEvent, signal, req }) {
  const text = String(message || '').trim();
  if (!text) throw httpError(422, 'Please type a question');
  if (text.length > localAi.maxMessageLength) throw httpError(422, `Questions can be at most ${localAi.maxMessageLength} characters`);
  if (!MODES.has(mode)) throw httpError(422, 'Unknown answer mode');

  await assertNotBlocked(user);
  const who = String(user._id);
  if (answering.has(who)) throw httpError(409, 'Your previous question is still being answered. Please wait for it to finish.', 'AI_BUSY');
  answering.add(who);
  try {
    return await answer({ user, conversationId, text, mode, materialId, onDelta, onEvent, signal, req });
  } finally {
    answering.delete(who);
  }
}

async function answer({ user, conversationId, text, mode, materialId, onDelta, onEvent, signal, req }) {
  const convo = await loadConversation(user, conversationId);
  const history = convo?.messages || [];
  if (questionCount(history) >= localAi.maxQuestionsPerConversation) {
    throw httpError(409, `This chat has reached its limit of ${localAi.maxQuestionsPerConversation} questions. Please start a new chat.`, 'AI_CHAT_FULL');
  }
  const material = await loadAttachable(user, materialId);
  const recent = recentMessages(history);

  // 1) Strict scope — checked alone and together with the student's recent
  //    accepted questions (attacks split over several innocent-looking
  //    messages). Already-refused messages were dealt with when they were sent.
  const scope = checkConversation(
    text,
    recent.filter((m, i) => m.role === 'user' && !recent[i + 1]?.refused).map((m) => m.content)
  );
  if (!scope.allowed) {
    let reply = scope.reply;
    if (STRIKE_CATEGORIES.has(scope.category)) {
      const s = await addStrike(user, scope.category, req);
      if (s.blocked) reply += `\n\nBecause of repeated requests like this, AI Doubts is paused for your account for ${localAi.blockHours} hours.`;
      else if (s.strikes >= localAi.strikesToBlock - 1) reply += '\n\nWarning: one more request like this will pause AI Doubts for your account.';
    }
    onDelta?.(reply);
    // Greetings / "what can you do" / support messages are friendly replies, not refusals. All are free.
    const fixed = scope.refused === false ? { content: reply, cost: 0 } : { content: reply, refused: true, cost: 0 };
    // A refused (or small-talk) first message does not start — or push out — a saved chat.
    if (!convo) return { conversationId: null, message: { _id: `fixed-${Date.now()}`, role: 'assistant', ...fixed, createdAt: new Date() } };
    return result(await saveTurn(user, convo, text, fixed, { mode, material }));
  }

  // 2) Retrieval, scoped to this user: the attached material only, or all their materials.
  //    Short follow-ups ("give an example") are expanded with the previous question.
  //    "continue" after an answer that hit the length limit carries on that answer.
  const lastAnswer = [...recent].reverse().find((m) => m.role === 'assistant');
  const lastQuestion = [...recent].reverse().find((m) => m.role === 'user');
  const continuing = isContinue(text) && !!lastAnswer?.truncated && !!lastQuestion;
  if (isContinue(text) && lastAnswer?.mode === 'exam' && !lastAnswer.truncated) {
    // The exam answer already ended with its conclusion — asking the model to "continue" only makes it repeat.
    const done = { content: 'That answer is already complete — it ends with the conclusion. 🙂 Ask me to explain any point in more depth, give another example, or write it for a different number of marks.', cost: 0 };
    onDelta?.(done.content);
    return result(await saveTurn(user, convo, text, done, { mode: 'short', material }));
  }
  const asked = continuing ? lastQuestion.content : text; // what the student actually wants answered
  const marks = continuing ? lastAnswer.marks || null : examMarks(text);
  if (marks) mode = 'exam';
  let earlier = modelHistory(recent, mode === 'exam' ? 2 : undefined);
  if (continuing) {
    earlier = [
      { role: 'user', content: String(asked).slice(0, 1500) },
      { role: 'assistant', content: `…${String(lastAnswer.content).replace(CONTINUE_NOTE, '').replace(/ ?\[S\d+\]/g, '').slice(-2500)}` },
    ];
  }
  const query = retrievalQuery(asked, continuing ? [] : earlier);
  let items;
  let note = continuing ? '\n\n(Note for the assistant: continue your previous answer exactly where it stopped. Do not repeat anything already written and do not start again with an introduction. Finish with the conclusion.)' : '';
  if (material) {
    let reference;
    let found;
    ({ items, reference, found } = await retrieveFromMaterial(material, query, undefined, { question: asked, refChars: mode === 'exam' ? 4500 : 3000 }));
    if (reference && !found) {
      const label = [reference.unit && `Unit ${reference.unit}`, reference.part && `Part ${reference.part}`, reference.question && `Question ${reference.question}`].filter(Boolean).join(', ');
      note = `\n\n(Note for the assistant: the student refers to ${label} of the attached material, but that part was not found in the excerpts. Say so politely and ask them to paste the question text. Do not refuse.)`;
    }
    const overview = await digestFor(material);
    if (overview) items.unshift({ id: `digest:${materialVersion(material)}`, text: `Overview of the whole material:\n${overview}`, source: { type: 'study_material', title: material.file?.name || material.title, publisher: [material.title, material.subjectCode].filter(Boolean).join(' · ') || undefined, url: material.file?.url, materialId: material._id } });
  } else {
    const found = await gatherContext({ user, query, allow: { study_material: true, dataset: false }, limits: { study_material: localAi.ragChunks } });
    items = found.items.filter((it) => it.source.type === 'study_material' && !looksLikeInjection(it.text));
  }
  const context = contextBlock(items);
  const language = requestedLanguage(asked);
  const langNote = language && !/^English/.test(language) ? `\n\n(Write the whole answer in ${language}. Keep technical terms in English in brackets.)` : '';

  // 3) Busy? Use the faster model / shorter answers so the queue keeps moving.
  const busy = activity().queued >= localAi.fallbackQueueThreshold;
  const model = busy && localAi.fallbackModel ? localAi.fallbackModel : localAi.model;
  let maxTokens = localAi.shortOutputTokens;
  if (mode === 'detailed') maxTokens = busy ? Math.min(localAi.busyOutputTokens, localAi.maxOutputTokens) : localAi.maxOutputTokens;
  // Exam answers keep their size when busy (a cut-off exam answer is useless); "continue" covers the rest.
  if (mode === 'exam') maxTokens = examTokens(marks);
  const prompt = systemPrompt({ mode, busy, materialTitle: material?.title, marks: marks || undefined });

  // 4) Same question + same excerpts asked before (by anyone)? Serve the saved answer.
  const canCache = earlier.length === 0;
  const key = canCache ? cacheKey({ text, mode, prompt: systemPrompt({ mode, materialTitle: material?.title, marks: marks || undefined }), model: localAi.model, items }) : null;
  const hit = key ? await cachedAnswer(user, key) : null;

  const reservation = await credits.reserve(user, mode);
  try {
    if (hit) {
      onEvent?.('cached', {});
      onDelta?.(hit.content);
      const { cost } = await credits.settle(user, reservation, 'cached', { mode, conversationId: convo?._id, materialId: material?._id });
      return result(await saveTurn(user, convo, text, { content: hit.content, sources: hit.sources, mode, cached: true, cost, ...(marks ? { marks } : {}) }, { mode, material }));
    }

    // 5) Local model, with this chat's recent (in-scope) messages. Always streamed
    //    internally so the guards can cut the answer off mid-sentence.
    const generate = async (userNote) => {
      const leak = createLeakDetector(prompt);
      const watch = createOutputMonitor([text, ...recent.filter((m) => m.role === 'user').map((m) => m.content)]);
      const loop = createLoopDetector();
      const stop = new AbortController();
      signal?.addEventListener('abort', () => stop.abort(), { once: true });
      let reply = null;
      try {
        reply = await chat({
          model,
          maxTokens,
          queueKey: String(user._id),
          onQueue: (position) => onEvent?.('queue', { position }),
          messages: [{ role: 'system', content: prompt }, ...earlier, { role: 'user', content: `${text}${userNote}${context ? `\n\n${context}` : ''}` }],
          onDelta: (delta) => {
            if (watch.push(delta).tripwire || watch.unsafe || leak.push(delta) || loop.push(delta)) return stop.abort();
            return onDelta?.(delta);
          },
          signal: stop.signal,
        });
      } catch (err) {
        if (!leak.leaked && !watch.unsafe && !loop.looped) throw err;
      }
      return { leak, watch, loop, truncated: !loop.looped && !!reply?.truncated, full: loop.looped ? loop.cleanText : reply?.content || '' };
    };

    let { leak, watch, loop, truncated, full } = await generate(note + langNote);
    let prefix = '';
    if (loop.looped) {
      console.warn(`[local-ai] the model started repeating itself (user ${user._id})${language ? ` — answer in ${language} replaced by English` : ''}`);
      if (langNote && !watch.unsafe && !leak.leaked) {
        // The model can't write this language well: answer in simple English instead.
        onEvent?.('restart', {});
        prefix = `Sorry — I can't write a good answer in ${language.replace(/ \(.*\)$/, '')} yet, so here it is in simple English:\n\n`;
        onDelta?.(prefix);
        ({ leak, watch, loop, truncated, full } = await generate(note));
      }
      if (!full.trim()) full = 'Sorry, I could not write a clear answer to that. Please try asking it in a different way.';
    }
    full = prefix + full;
    const verdict = watch.verdict.tripwire ? watch.verdict : inspectOutput(full, [text]);
    if (localAi.tripwireEnabled && verdict.tripwire) {
      await credits.settle(user, reservation, 'error');
      await tripwire(user, verdict.tripwire, req);
      throw new LocalAIError('stopped');
    }
    if (leak.leaked || leaksPrompt(full, prompt)) {
      console.warn(`[local-ai] blocked an answer that repeated the hidden prompt (user ${user._id})`);
      await credits.settle(user, reservation, 'refused');
      return result(await saveTurn(user, convo, text, { content: REFUSAL_LINE, refused: true, cost: 0 }, { mode, material }));
    }
    if (watch.verdict.sexual || verdict.sexual) {
      console.warn(`[local-ai] blocked an answer with sexual content (user ${user._id})`);
      await credits.settle(user, reservation, 'refused');
      return result(await saveTurn(user, convo, text, { content: REFUSALS.sexual, refused: true, cost: 0 }, { mode, material }));
    }

    // 6) Output scrub + only sources that were actually given to the model.
    let content = scrubOutput(full);
    if (content.replace(/[\s"'.]+$/g, '').replace(/^["'\s]+/, '') === REFUSAL_LINE.replace(/\.$/, '')) {
      // The model itself judged it out of scope: a refusal (free, not cached).
      await credits.settle(user, reservation, 'refused');
      return result(await saveTurn(user, convo, text, { content: REFUSAL_LINE, refused: true, cost: 0 }, { mode, material }));
    }
    // Reached the length limit: end at a complete sentence and offer "continue".
    if (truncated) content = endCleanly(content) + CONTINUE_NOTE;
    const extra = { ...(marks ? { marks } : {}), ...(truncated ? { truncated: true } : {}) };
    const cited = new Set([...content.matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1]) - 1));
    const sources = (cited.size ? items.filter((_, i) => cited.has(i)) : items.slice(0, 3)).map((it) => it.source);
    const { cost } = await credits.settle(user, reservation, credits.sizeOf(content), { mode, conversationId: convo?._id, materialId: material?._id });
    // Answers made with the busy-time model / limits are not cached.
    if (key && !busy && !truncated) storeAnswer({ key, content, sources, mode, material, items });
    return result(await saveTurn(user, convo, text, { content, sources, mode, cost, ...extra }, { mode, material }));
  } catch (err) {
    await credits.settle(user, reservation, 'error').catch(() => {});
    throw err;
  }
}

// ── Saved chats (always scoped to the owner) ─────────────────────────

export async function listConversations(user) {
  const items = await LocalAIConversation.find(live(user))
    .sort({ updatedAt: -1 })
    .limit(localAi.maxConversations)
    .select('title createdAt updatedAt expiresAt messages.role')
    .lean();
  return items.map(({ messages, ...c }) => ({ ...c, messageCount: messages.length, questionCount: questionCount(messages) }));
}

export async function getConversation(user, id) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid chat id');
  const convo = await LocalAIConversation.findOne({ _id: id, ...live(user) }).select('-user').lean();
  if (!convo) throw httpError(404, 'This chat has expired or was deleted.');
  return { ...convo, questionsLeft: Math.max(0, localAi.maxQuestionsPerConversation - questionCount(convo.messages)) };
}

export async function renameConversation(user, id, title) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid chat id');
  const clean = typeof title === 'string' ? title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!clean || clean.length > 80) throw httpError(422, 'Chat names must be 1–80 characters');
  const convo = await LocalAIConversation.findOneAndUpdate(
    { _id: id, ...live(user) },
    { $set: { title: clean } },
    { returnDocument: 'after', timestamps: false } // renaming doesn't count as "recently used"
  )
    .select('title createdAt updatedAt expiresAt')
    .lean();
  if (!convo) throw httpError(404, 'This chat has expired or was deleted.');
  return convo;
}

export async function deleteConversation(user, id) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid chat id');
  const { deletedCount } = await LocalAIConversation.deleteOne({ _id: id, user: user._id });
  if (!deletedCount) throw httpError(404, 'Chat not found');
}

export { LocalAIError };
