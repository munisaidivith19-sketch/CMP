import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { env } from './env.js';
import { authenticateAccessToken } from '../middleware/auth.js';
import Conversation from '../models/Conversation.js';
import Discussion from '../models/Discussion.js';
import User from '../models/User.js';
import { markConversationRead } from '../services/chatService.js';

let io = null;

// userId -> number of live sockets (a user can be on web and Android at once).
const online = new Map();

export const isUserOnline = (userId) => (online.get(String(userId)) || 0) > 0;
export const onlineUserIds = () => [...online.keys()];

/** Everyone who shares at least one conversation with the user (presence audience). */
async function contactsOf(userId) {
  const ids = await Conversation.find({ participants: userId, isActive: true }).distinct('participants');
  return ids.map(String).filter((id) => id !== String(userId));
}

async function broadcastPresence(userId, isOnline) {
  try {
    const contacts = await contactsOf(userId);
    const payload = { userId: String(userId), online: isOnline, lastSeenAt: isOnline ? null : new Date() };
    contacts.forEach((id) => emitTo(`user:${id}`, 'presence:update', payload));
  } catch (err) {
    console.error('[socket] presence broadcast failed:', err.message);
  }
}

const ack = (cb, payload) => (typeof cb === 'function' ? cb(payload) : undefined);

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    // CORS only constrains browsers; the Android app is a native client and is
    // admitted by the same token check below.
    cors: { origin: env.clientUrls, credentials: true },
  });

  // Every socket must present a valid access token bound to a live session.
  io.use(async (socket, next) => {
    try {
      const { user, sessionId } = await authenticateAccessToken(socket.handshake.auth?.token);
      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      socket.data.sessionId = sessionId;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role, sessionId } = socket.data;
    socket.join([`user:${userId}`, `session:${sessionId}`, `role:${role}`]);

    const count = (online.get(userId) || 0) + 1;
    online.set(userId, count);
    if (count === 1) broadcastPresence(userId, true);

    socket.on('disconnect', () => {
      const left = (online.get(userId) || 1) - 1;
      if (left > 0) {
        online.set(userId, left);
        return;
      }
      online.delete(userId);
      User.updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
      broadcastPresence(userId, false);
    });

    // ── Discussions (public threads; hidden ones only for moderators) ──
    socket.on('discussion:join', async (id, cb) => {
      if (!mongoose.isValidObjectId(id)) return ack(cb, { ok: false });
      const d = await Discussion.findById(id).select('isHidden').lean().catch(() => null);
      if (!d || (d.isHidden && !['admin', 'faculty'].includes(role))) return ack(cb, { ok: false });
      socket.join(`discussion:${id}`);
      return ack(cb, { ok: true });
    });
    socket.on('discussion:leave', (id) => {
      if (mongoose.isValidObjectId(id)) socket.leave(`discussion:${id}`);
    });

    // ── Chat: a room is joined only after membership is checked in MongoDB ──
    socket.on('chat:join', async (conversationId, cb) => {
      if (!mongoose.isValidObjectId(conversationId)) return ack(cb, { ok: false, error: 'invalid' });
      const member = await Conversation.exists({ _id: conversationId, participants: userId, isActive: true }).catch(() => null);
      if (!member) return ack(cb, { ok: false, error: 'forbidden' });
      socket.join(`chat:${conversationId}`);
      return ack(cb, { ok: true });
    });
    socket.on('chat:leave', (conversationId) => {
      if (mongoose.isValidObjectId(conversationId)) socket.leave(`chat:${conversationId}`);
    });
    socket.on('chat:typing', (data = {}) => {
      const { conversationId, isTyping } = data;
      // Only relayed inside a room this socket was authorised to join.
      if (!mongoose.isValidObjectId(conversationId) || !socket.rooms.has(`chat:${conversationId}`)) return;
      socket.to(`chat:${conversationId}`).emit('chat:typing', {
        conversationId,
        userId,
        isTyping: Boolean(isTyping),
      });
    });
    socket.on('chat:read', async (data = {}, cb) => {
      const { conversationId } = data;
      if (!mongoose.isValidObjectId(conversationId)) return ack(cb, { ok: false });
      const ok = await markConversationRead(userId, conversationId).catch(() => false);
      return ack(cb, { ok });
    });
  });

  console.log('[socket] Socket.io ready');
  return io;
}

export const getIO = () => io;

export function emitTo(room, event, payload) {
  if (io) io.to(room).emit(event, payload);
}

export function emitToUsers(userIds, event, payload) {
  if (!io) return;
  const rooms = [...new Set((userIds || []).map((id) => `user:${String(id?._id || id)}`))];
  if (rooms.length) io.to(rooms).emit(event, payload);
}

export function emitToRoles(roles, event, payload) {
  if (io) io.to(roles.map((r) => `role:${r}`)).emit(event, payload);
}

/** Broadcast to every signed-in client (all sockets are authenticated). Never send private data here. */
export function broadcast(event, payload) {
  if (io) io.emit(event, payload);
}

/** Force-disconnect every socket belonging to the given sessions (logout / revoke). */
export function disconnectSessions(sessionIds = []) {
  if (!io || !sessionIds.length) return;
  io.in(sessionIds.map((id) => `session:${String(id)}`)).disconnectSockets(true);
}
