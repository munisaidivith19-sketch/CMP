import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import User, { PUBLIC_USER_FIELDS } from '../models/User.js';
import { ApiError, asyncHandler, paginate, pageMeta, escapeRegex } from '../utils/http.js';
import { emitToUsers, isUserOnline } from '../config/socket.js';
import { sameId } from '../utils/permissions.js';
import { logActivity } from '../utils/activity.js';
import { markConversationRead } from '../services/chatService.js';
import { sendPushToUsers } from '../services/pushService.js';

const CHAT_USER_FIELDS = `${PUBLIC_USER_FIELDS} lastSeenAt`;
const isParticipant = (conv, userId) => conv.participants.some((p) => sameId(p._id || p, userId));
const participantIds = (conv) => conv.participants.map((p) => String(p._id || p));
// Class / club channels are created by staff or club admins; anyone may DM or form a group.
const CHANNEL_CREATORS = ['faculty', 'admin', 'club_admin'];

const unreadFor = (conv, userId) => {
  const counts = conv.unreadCounts;
  if (!counts) return 0;
  return (typeof counts.get === 'function' ? counts.get(String(userId)) : counts[String(userId)]) || 0;
};

function withPresence(conv, userId) {
  const plain = typeof conv.toObject === 'function' ? conv.toObject() : conv;
  const { unreadCounts: _counts, ...rest } = plain; // per-user counters stay private
  return {
    ...rest,
    unreadCount: unreadFor(conv, userId),
    participants: (plain.participants || []).map((p) => ({ ...p, online: isUserOnline(p._id) })),
  };
}

const populateMessage = (query) =>
  query
    .populate('sender', 'name avatar role')
    .populate({ path: 'replyTo', select: 'body sender deletedAt', populate: { path: 'sender', select: 'name' } });

async function loadMemberConversation(id, user) {
  const conv = await Conversation.findById(id);
  if (!conv || !conv.isActive) throw new ApiError(404, 'Conversation not found');
  if (!isParticipant(conv, user._id)) throw new ApiError(403, 'Not a member of this conversation');
  return conv;
}

// ── List conversations ─────────────────────────────────────────────

export const listConversations = asyncHandler(async (req, res) => {
  const conversations = await Conversation.find({ participants: req.user._id, isActive: true })
    .populate('participants', CHAT_USER_FIELDS)
    .populate('lastMessage.sender', 'name avatar')
    .sort({ 'lastMessage.sentAt': -1, updatedAt: -1 })
    .lean();

  let result = conversations.map((c) => withPresence(c, req.user._id));
  const q = String(req.query.search || '').trim().toLowerCase();
  if (q) {
    result = result.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.participants.some((p) => !sameId(p, req.user) && p.name?.toLowerCase().includes(q))
    );
  }
  res.json(result);
});

/** Total unread messages across all conversations (sidebar / tab badge). */
export const getUnreadTotal = asyncHandler(async (req, res) => {
  const convs = await Conversation.find({ participants: req.user._id, isActive: true }).select('unreadCounts').lean();
  const total = convs.reduce((sum, c) => sum + unreadFor(c, req.user._id), 0);
  res.json({ total, conversations: convs.filter((c) => unreadFor(c, req.user._id) > 0).length });
});

// ── Create or find a conversation ──────────────────────────────────

export const createConversation = asyncHandler(async (req, res) => {
  const { type = 'private', participantIds: requested = [], name, description } = req.body;
  const others = [...new Set(requested.map(String))].filter((id) => !sameId(id, req.user));

  if (type === 'private') {
    if (others.length !== 1) throw new ApiError(422, 'Choose one person to start a private chat');
  } else if (!others.length) {
    throw new ApiError(422, 'Add at least one other member');
  }
  if (['class', 'club'].includes(type) && !CHANNEL_CREATORS.includes(req.user.role)) {
    throw new ApiError(403, 'Only faculty, admins and club admins can create class or club channels');
  }

  // Every participant must be a real, active account (ids from the client are not trusted).
  const found = await User.find({ _id: { $in: others }, isActive: true }).distinct('_id');
  if (found.length !== others.length) throw new ApiError(404, 'One or more users could not be found');

  if (type === 'private') {
    const otherId = others[0];
    const existing = await Conversation.findOne({
      type: 'private',
      participants: { $all: [req.user._id, otherId], $size: 2 },
      isActive: true,
    }).populate('participants', CHAT_USER_FIELDS);
    if (existing) return res.json(withPresence(existing, req.user._id));

    const conv = await Conversation.create({
      type: 'private',
      participants: [req.user._id, otherId],
      createdBy: req.user._id,
    });
    const populated = await Conversation.findById(conv._id).populate('participants', CHAT_USER_FIELDS);
    emitToUsers(participantIds(conv), 'chat:conversation', { conversationId: String(conv._id) });
    return res.status(201).json(withPresence(populated, req.user._id));
  }

  if (!name?.trim()) throw new ApiError(422, 'Group conversations need a name');
  const conv = await Conversation.create({
    type,
    name: name.trim(),
    description: description?.trim(),
    participants: [req.user._id, ...others],
    admins: [req.user._id],
    createdBy: req.user._id,
  });
  logActivity(req, 'chat.group_create', { entityType: 'conversation', entityId: conv._id, summary: conv.name });
  const populated = await Conversation.findById(conv._id).populate('participants', CHAT_USER_FIELDS);
  emitToUsers(participantIds(conv), 'chat:conversation', { conversationId: String(conv._id) });
  res.status(201).json(withPresence(populated, req.user._id));
});

// ── Get conversation ───────────────────────────────────────────────

export const getConversation = asyncHandler(async (req, res) => {
  const conv = await loadMemberConversation(req.params.id, req.user);
  await conv.populate('participants', CHAT_USER_FIELDS);
  res.json(withPresence(conv, req.user._id));
});

// ── Send message ───────────────────────────────────────────────────

export const sendMessage = asyncHandler(async (req, res) => {
  const conv = await loadMemberConversation(req.params.id, req.user);

  if (req.body.replyTo) {
    const parent = await Message.exists({ _id: req.body.replyTo, conversation: conv._id });
    if (!parent) throw new ApiError(422, 'You can only reply to a message in this conversation');
  }

  const msg = await Message.create({
    conversation: conv._id,
    sender: req.user._id,
    body: req.body.body,
    replyTo: req.body.replyTo || undefined,
    attachment: req.body.attachment?.url ? req.body.attachment : undefined,
    readBy: [req.user._id],
  });

  const recipients = participantIds(conv).filter((id) => !sameId(id, req.user));
  const unreadInc = Object.fromEntries(recipients.map((id) => [`unreadCounts.${id}`, 1]));
  await Conversation.updateOne(
    { _id: conv._id },
    {
      $set: {
        lastMessage: { body: msg.body.slice(0, 200), sender: req.user._id, sentAt: msg.createdAt },
        [`unreadCounts.${req.user._id}`]: 0,
      },
      $inc: unreadInc,
    }
  );

  const populated = await populateMessage(Message.findById(msg._id));
  emitToUsers(participantIds(conv), 'chat:message', { conversationId: String(conv._id), message: populated });

  // Android devices that are not connected get a push notification.
  const offline = recipients.filter((id) => !isUserOnline(id));
  if (offline.length) {
    sendPushToUsers(offline, {
      title: conv.type === 'private' ? req.user.name : `${req.user.name} · ${conv.name}`,
      body: msg.body,
      data: { type: 'chat', conversationId: String(conv._id), link: `/chat/${conv._id}` },
    });
  }

  res.status(201).json(populated);
});

// ── Get messages (history + search) ────────────────────────────────

export const getMessages = asyncHandler(async (req, res) => {
  const conv = await loadMemberConversation(req.params.id, req.user);

  const { page, limit, skip } = paginate(req, 40, 100);
  const filter = { conversation: conv._id };
  const q = String(req.query.q || '').trim();
  if (q) {
    filter.body = { $regex: escapeRegex(q), $options: 'i' };
    filter.deletedAt = null;
  }
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (!Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
  }

  const [messages, total] = await Promise.all([
    populateMessage(Message.find(filter)).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Message.countDocuments(filter),
  ]);

  res.json({ messages: messages.reverse(), pagination: pageMeta(total, page, limit) });
});

/** Search messages across every conversation the user belongs to. */
export const searchMessages = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const mine = await Conversation.find({ participants: req.user._id, isActive: true }).distinct('_id');
  const messages = await Message.find({
    conversation: { $in: mine },
    deletedAt: null,
    body: { $regex: escapeRegex(q), $options: 'i' },
  })
    .populate('sender', 'name avatar')
    .populate('conversation', 'type name')
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();
  res.json(messages);
});

// ── Delete message ─────────────────────────────────────────────────

export const deleteMessage = asyncHandler(async (req, res) => {
  const conv = await loadMemberConversation(req.params.id, req.user);
  const msg = await Message.findOne({ _id: req.params.msgId, conversation: conv._id });
  if (!msg) throw new ApiError(404, 'Message not found');
  if (msg.deletedAt) return res.json({ message: 'Message deleted' });

  if (!sameId(msg.sender, req.user) && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only delete your own messages');
  }

  msg.deletedAt = new Date();
  msg.deletedBy = req.user._id;
  msg.body = 'This message was deleted';
  msg.attachment = undefined;
  await msg.save();

  if (conv.lastMessage?.sentAt && conv.lastMessage.sentAt.getTime() === msg.createdAt.getTime()) {
    await Conversation.updateOne({ _id: conv._id }, { $set: { 'lastMessage.body': msg.body } });
  }
  emitToUsers(participantIds(conv), 'chat:messageDeleted', {
    conversationId: String(conv._id),
    messageId: String(msg._id),
  });
  res.json({ message: 'Message deleted' });
});

// ── Pin / unpin message ────────────────────────────────────────────

export const togglePinMessage = asyncHandler(async (req, res) => {
  const conv = await loadMemberConversation(req.params.id, req.user);
  const msg = await Message.findOne({ _id: req.params.msgId, conversation: conv._id, deletedAt: null });
  if (!msg) throw new ApiError(404, 'Message not found');

  if (msg.pinnedBy) {
    msg.pinnedBy = undefined;
    msg.pinnedAt = undefined;
    await Conversation.updateOne({ _id: conv._id }, { $pull: { pinnedMessages: msg._id } });
  } else {
    msg.pinnedBy = req.user._id;
    msg.pinnedAt = new Date();
    await Conversation.updateOne({ _id: conv._id }, { $addToSet: { pinnedMessages: msg._id } });
  }
  await msg.save();
  emitToUsers(participantIds(conv), 'chat:messagePinned', {
    conversationId: String(conv._id),
    messageId: String(msg._id),
    pinned: Boolean(msg.pinnedBy),
  });
  res.json(msg);
});

// ── Mark conversation as read ──────────────────────────────────────

export const markRead = asyncHandler(async (req, res) => {
  const ok = await markConversationRead(req.user._id, req.params.id);
  if (!ok) throw new ApiError(404, 'Conversation not found');
  res.json({ message: 'Marked as read' });
});

// ── Online users (only people you share a conversation with) ───────

export const getOnlineUsers = asyncHandler(async (req, res) => {
  const contacts = await Conversation.find({ participants: req.user._id, isActive: true }).distinct('participants');
  res.json(contacts.map(String).filter((id) => !sameId(id, req.user) && isUserOnline(id)));
});

// ── Add / remove members (groups) ──────────────────────────────────

export const addMembers = asyncHandler(async (req, res) => {
  const conv = await loadMemberConversation(req.params.id, req.user);
  if (conv.type === 'private') throw new ApiError(422, 'Cannot add members to a private conversation');
  if (!conv.admins.some((a) => sameId(a, req.user)) && req.user.role !== 'admin') {
    throw new ApiError(403, 'Only group admins can add members');
  }

  const requested = [...new Set(req.body.userIds.map(String))];
  const valid = await User.find({ _id: { $in: requested }, isActive: true }).distinct('_id');
  if (!valid.length) throw new ApiError(404, 'No valid users to add');

  await Conversation.updateOne({ _id: conv._id }, { $addToSet: { participants: { $each: valid } } });
  const updated = await Conversation.findById(conv._id).populate('participants', CHAT_USER_FIELDS);
  emitToUsers(participantIds(updated), 'chat:conversation', { conversationId: String(conv._id) });
  res.json(withPresence(updated, req.user._id));
});

export const removeMember = asyncHandler(async (req, res) => {
  const conv = await loadMemberConversation(req.params.id, req.user);
  if (conv.type === 'private') throw new ApiError(422, 'Cannot remove members from a private conversation');

  const targetId = req.params.userId;
  // Anyone can leave; group admins (or a site admin) can remove others.
  if (!sameId(targetId, req.user) && !conv.admins.some((a) => sameId(a, req.user)) && req.user.role !== 'admin') {
    throw new ApiError(403, 'Only group admins can remove members');
  }

  const before = participantIds(conv);
  await Conversation.updateOne(
    { _id: conv._id },
    {
      $pull: { participants: targetId, admins: targetId },
      $unset: { [`unreadCounts.${targetId}`]: '' },
    }
  );
  emitToUsers(before, 'chat:conversation', { conversationId: String(conv._id), removed: String(targetId) });
  res.json({ message: 'Member removed' });
});
