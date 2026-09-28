import mongoose from 'mongoose';
import AIConversation from '../../models/AIConversation.js';
import AIUsageLog from '../../models/AIUsageLog.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/http.js';
import { AIServiceError, chat } from './groqService.js';
import { gatherContext } from './sources/index.js';
import { buildHistory, contextBlock, retrievalQuery, shouldOfferWebSearch, systemPrompt } from './prompts.js';

/**
 * JNN Study Assistant orchestration:
 *   conversation (owned by the authenticated user) → authorized retrieval
 *   (study materials + approved datasets) → prompt with fenced context →
 *   Groq (optionally with browser_search) → verified sources → persist → log.
 *
 * The assistant is read-only: it has no tools that write anything except the
 * user's own conversation record.
 */

export const BOTH_SOURCES_FAILED = "I couldn't retrieve the required resources right now. Please try again later.";

const NOTICES = {
  webFailed: 'Web research was unavailable for this answer, so it is based on JNN materials and general knowledge.',
  materialsFailed: 'JNN study materials could not be searched right now, so this answer uses web research and general knowledge.',
};

/** Belt-and-braces: never let anything shaped like a Groq key leave the server. */
function redactSecrets(text) {
  let out = text.replace(/gsk_[A-Za-z0-9]{16,}/g, '[redacted]');
  const key = env.ai.groqApiKey;
  if (key && key.length >= 8) out = out.split(key).join('[redacted]');
  return out;
}

const dedupeKey = (s) => [s.type, s.url || '', s.title, s.page ?? ''].join('|');

/**
 * Only sources that were actually retrieved/returned are ever attached.
 * Study materials/datasets: the ones the model cited with [S#]; if it cited
 * none, the top few that were retrieved (and actually given to it). Web: the
 * results Groq's browser_search returned.
 */
function pickSources(items, content, webSources) {
  const cited = new Set([...content.matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1]) - 1));
  const provided = cited.size ? items.filter((_, i) => cited.has(i)) : items.filter((it) => it.source.type === 'study_material').slice(0, 3);
  const seen = new Set();
  return [...provided.map((it) => it.source), ...webSources].filter((s) => {
    const k = dedupeKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function loadConversation(user, conversationId) {
  if (!conversationId) return null;
  if (!mongoose.isValidObjectId(conversationId)) throw new ApiError(400, 'Invalid conversation id');
  // Ownership is part of the query — another user's id is simply "not found".
  const convo = await AIConversation.findOne({ _id: conversationId, user: user._id }).lean();
  if (!convo) throw new ApiError(404, 'Conversation not found');
  return convo;
}

function logUsage(entry) {
  AIUsageLog.create(entry).catch(() => {});
}

/**
 * Answer one student message.
 * @param {object} o
 * @param {object} o.user               authenticated user (req.user)
 * @param {string} [o.conversationId]
 * @param {string} o.message
 * @param {boolean} [o.useStudyMaterials]  client may only switch sources OFF
 * @param {boolean} [o.useWebSearch]
 * @param {Function} [o.onDelta]         stream answer text as it arrives
 */
export async function askAssistant({ user, conversationId, message, useStudyMaterials, useWebSearch, onDelta, signal }) {
  const startedAt = Date.now();
  const text = String(message || '').trim();
  if (!text) throw new ApiError(422, 'Please type a question');
  if (text.length > env.ai.maxMessageLength) throw new ApiError(422, `Questions can be at most ${env.ai.maxMessageLength} characters`);

  const convo = await loadConversation(user, conversationId);
  const history = convo?.messages || [];

  // ── Retrieval (authorization derived from req.user only) ──
  const allowMaterials = useStudyMaterials !== false;
  const { items, failed } = await gatherContext({
    user,
    query: retrievalQuery(text, history),
    allow: { study_material: allowMaterials, dataset: allowMaterials },
    limits: { study_material: env.ai.ragChunks, dataset: 2 },
  });
  const materialsFailed = failed.includes('study_material');
  const hasMaterialContext = items.some((it) => it.source.type === 'study_material');

  const webSearch = env.ai.webSearchEnabled && useWebSearch !== false && (materialsFailed || shouldOfferWebSearch({ message: text, hasMaterialContext }));

  const context = contextBlock(items);
  const messages = [
    { role: 'system', content: systemPrompt({ webSearchAllowed: webSearch }) },
    ...buildHistory(history, env.ai.historyMessages),
    { role: 'user', content: context ? `${text}\n\n${context}` : text },
  ];

  let result;
  try {
    result = await chat({ messages, webSearch, onDelta, signal });
  } catch (err) {
    logUsage({
      user: user._id,
      model: env.ai.model,
      requestedAt: new Date(startedAt),
      durationMs: Date.now() - startedAt,
      success: false,
      streamed: Boolean(onDelta),
      sourceTypes: [...new Set(items.map((i) => i.source.type))],
      webSearchUsed: webSearch,
      errorCategory: err instanceof AIServiceError ? err.category : 'internal',
    });
    if (err instanceof AIServiceError) throw err;
    throw new ApiError(500, 'Something went wrong. Please try again.');
  }

  // Both the study-material search and web research failed → be honest.
  if (materialsFailed && webSearch && result.webSearchFailed) {
    logUsage({ user: user._id, model: env.ai.model, requestedAt: new Date(startedAt), durationMs: Date.now() - startedAt, success: false, errorCategory: 'sources_unavailable' });
    throw new ApiError(503, BOTH_SOURCES_FAILED);
  }

  const content = redactSecrets(result.content);
  const sources = pickSources(items, content, result.webSources);
  const notices = [];
  if (result.webSearchFailed) notices.push(NOTICES.webFailed);
  if (materialsFailed) notices.push(NOTICES.materialsFailed);

  const now = new Date();
  const userMsg = { role: 'user', content: text, sources: [], createdAt: now };
  const assistantMsg = { role: 'assistant', content, sources, ...(notices.length ? { notices } : {}), createdAt: new Date(now.getTime() + 1) };

  // Persist only once the full answer exists — an interrupted request never
  // leaves a half-written message behind. $slice caps the stored history.
  let saved;
  const push = { messages: { $each: [userMsg, assistantMsg], $slice: -env.ai.maxConversationMessages } };
  if (convo) {
    saved = await AIConversation.findOneAndUpdate({ _id: convo._id, user: user._id }, { $push: push }, { new: true }).lean();
    if (!saved) throw new ApiError(404, 'This conversation was cleared. Please ask again.');
  } else {
    saved = (
      await AIConversation.create({
        user: user._id,
        title: text.replace(/\s+/g, ' ').slice(0, 80),
        messages: [userMsg, assistantMsg].slice(-env.ai.maxConversationMessages),
      })
    ).toObject();
  }

  logUsage({
    user: user._id,
    model: result.model,
    requestedAt: new Date(startedAt),
    durationMs: Date.now() - startedAt,
    success: true,
    streamed: Boolean(onDelta),
    sourceTypes: [...new Set(sources.map((s) => s.type))],
    webSearchUsed: result.webSearchUsed,
    promptTokens: result.usage?.promptTokens ?? undefined,
    completionTokens: result.usage?.completionTokens ?? undefined,
    totalTokens: result.usage?.totalTokens ?? undefined,
  });

  const last = saved.messages[saved.messages.length - 1];
  return { conversationId: String(saved._id), title: saved.title, message: last };
}

// ── Conversations (always scoped to the owner) ───────────────────────

export async function listConversations(user) {
  return AIConversation.aggregate([
    { $match: { user: user._id } },
    { $sort: { updatedAt: -1 } },
    { $limit: 50 },
    { $project: { title: 1, createdAt: 1, updatedAt: 1, messageCount: { $size: '$messages' } } },
  ]);
}

export async function getConversation(user, id) {
  const convo = await AIConversation.findOne({ _id: id, user: user._id }).select('-user').lean();
  if (!convo) throw new ApiError(404, 'Conversation not found');
  return convo;
}

export async function deleteConversation(user, id) {
  const { deletedCount } = await AIConversation.deleteOne({ _id: id, user: user._id });
  if (!deletedCount) throw new ApiError(404, 'Conversation not found');
}
