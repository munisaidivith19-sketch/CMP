import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { emitToUsers } from '../config/socket.js';

/**
 * Mark every message in a conversation as read by `userId`, reset their unread
 * counter and tell the other participants (read receipts). Returns false when
 * the user is not a participant.
 */
export async function markConversationRead(userId, conversationId) {
  const conv = await Conversation.findOneAndUpdate(
    { _id: conversationId, participants: userId, isActive: true },
    { $set: { [`unreadCounts.${userId}`]: 0 } },
    { new: true, projection: { participants: 1 } }
  ).lean();
  if (!conv) return false;

  const readAt = new Date();
  const result = await Message.updateMany(
    { conversation: conversationId, sender: { $ne: userId }, readBy: { $ne: userId }, deletedAt: null },
    { $addToSet: { readBy: userId } }
  );
  emitToUsers(conv.participants, 'chat:read', {
    conversationId: String(conversationId),
    userId: String(userId),
    readAt,
    updated: result.modifiedCount,
  });
  return true;
}
