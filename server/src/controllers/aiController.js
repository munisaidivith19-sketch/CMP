import { asyncHandler } from '../utils/http.js';
import * as assistant from '../services/ai/studyAssistantService.js';

/**
 * JNN Study Assistant endpoints. All AI work lives in services/ai — this
 * layer only adapts HTTP (JSON or Server-Sent Events) to the service.
 */

const chatArgs = (req) => ({
  user: req.user,
  conversationId: req.body.conversationId || undefined,
  message: req.body.message,
  useStudyMaterials: req.body.useStudyMaterials,
  useWebSearch: req.body.useWebSearch,
});

/**
 * POST /ai/study-assistant/chat
 * `stream: true` → text/event-stream with `delta` events then one `done`
 * (the persisted message, whose content replaces the streamed text) or
 * `error`. Otherwise a plain JSON response. Errors raised before the first
 * streamed token are ordinary JSON errors with the right status code.
 */
export const chat = asyncHandler(async (req, res) => {
  if (req.body.stream !== true) {
    const result = await assistant.askAssistant(chatArgs(req));
    return res.json({ success: true, ...result });
  }

  let open = false;
  let clientGone = false;
  res.on('close', () => {
    clientGone = true;
  });
  const send = (event, data) => {
    if (clientGone) return;
    if (!open) {
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      open = true;
    }
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.flush?.(); // compression middleware buffers otherwise
  };

  try {
    // If the student closes the tab mid-answer, generation still completes and
    // is saved, so the full answer is there when they come back.
    const result = await assistant.askAssistant({ ...chatArgs(req), onDelta: (text) => send('delta', { text }) });
    send('done', { success: true, ...result });
  } catch (err) {
    if (!open) throw err; // nothing streamed yet → normal JSON error response
    const status = Number.isInteger(err.status) && err.status < 600 ? err.status : 500;
    if (status === 500) console.error('[ai] chat stream failed:', err?.name || 'error');
    send('error', { success: false, status, message: status === 500 ? 'Something went wrong. Please try again.' : err.message });
  }
  if (!clientGone) res.end();
});

export const listConversations = asyncHandler(async (req, res) => {
  res.json({ items: await assistant.listConversations(req.user) });
});

export const getConversation = asyncHandler(async (req, res) => {
  res.json(await assistant.getConversation(req.user, req.params.id));
});

export const deleteConversation = asyncHandler(async (req, res) => {
  await assistant.deleteConversation(req.user, req.params.id);
  res.json({ success: true, message: 'Conversation deleted' });
});
