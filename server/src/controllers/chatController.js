import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Subject from '../models/Subject.js';
import User, { PUBLIC_USER_FIELDS } from '../models/User.js';
import { ApiError, asyncHandler, paginate, pageMeta } from '../utils/http.js';
import { emitToUsers, isUserOnline } from '../config/socket.js';
import { sameId } from '../utils/permissions.js';
import { logActivity } from '../utils/activity.js';
import { notifyRoles, notifyUsers } from '../utils/notify.js';
import { open, seal } from '../utils/cipher.js';
import { markConversationRead } from '../services/chatService.js';
import { sendPushToUsers } from '../services/pushService.js';

const CHAT_USER_FIELDS = `${PUBLIC_USER_FIELDS} lastSeenAt`;
const isParticipant = (conv, userId) => conv.participants.some((p) => sameId(p._id || p, userId));
const participantIds = (conv) => conv.participants.map((p) => String(p._id || p));
const STUDENT_ROLES = ['student', 'club_admin'];
// Who may start a group / class channel at all. Students only have private chats.
const GROUP_CREATORS = ['admin', 'hod', 'faculty'];
// Faculty-created class groups wait for an admin; admin and HOD groups start at once.
const NEEDS_APPROVAL = ['faculty'];
// How many recent messages a text search scans (bodies are encrypted, so it runs in memory).
const SEARCH_WINDOW = 3000;

const unreadFor = (conv, userId) => {
  const counts = conv.unreadCounts;
  if (!counts) return 0;
  return (typeof counts.get === 'function' ? counts.get(String(userId)) : counts[String(userId)]) || 0;
};

const plainOf = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/** Decrypt a message (and the message it replies to) for an authorised reader. */
function openMsg(doc) {
  const m = plainOf(doc);
  if (!m) return m;
  const out = { ...m, body: open(m.body) };
  if (m.replyTo && typeof m.replyTo === 'object') out.replyTo = { ...m.replyTo, body: open(m.replyTo.body) };
  return out;
}

function withPresence(conv, userId) {
  const plain = plainOf(conv);
  const { unreadCounts: _counts, ...rest } = plain; // per-user counters stay private
  return {
    ...rest,
    lastMessage: plain.lastMessage ? { ...plain.lastMessage, body: open(plain.lastMessage.body) } : plain.lastMessage,
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

/** Sections a faculty member is responsible for: their mentor section + sections they teach. */
async function facultySections(user) {
  const subjects = await Subject.find({ faculty: user._id, isActive: true }).select('sections department').lean();
  const sections = new Set(subjects.flatMap((s) => (s.sections || []).map((x) => String(x).toUpperCase())));
  if (user.section) sections.add(String(user.section).toUpperCase());
  return sections;
}

/**
 * Enforce who may be put in a group:
 *  - admin: anyone;
 *  - HOD: students and staff of their own department;
 *  - faculty: students of their own class(es) and staff of their department.
 */
async function assertMembersAllowed(user, memberIds) {
  if (user.role === 'admin' || !memberIds.length) return;
  const members = await User.find({ _id: { $in: memberIds } }).select('role department section name').lean();
  if (!user.department) throw new ApiError(422, 'Your account has no department — ask an admin to set it');
  const outsiders = members.filter((m) => m.department !== user.department);
  if (outsiders.length) {
    throw new ApiError(403, `Groups can only include your own department (${outsiders[0].name} is not in ${user.department})`);
  }
  if (user.role === 'faculty') {
    const sections = await facultySections(user);
    const notMine = members.filter((m) => STUDENT_ROLES.includes(m.role) && !sections.has(String(m.section || '').toUpperCase()));
    if (notMine.length) {
      throw new ApiError(403, `Faculty groups can only include students of your own class (${notMine[0].name} is not in your sections)`);
    }
  }
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
  } else {
    if (!GROUP_CREATORS.includes(req.user.role)) {
      throw new ApiError(403, 'Only admins, HODs and faculty can create group chats');
    }
    if (!others.length) throw new ApiError(422, 'Add at least one other member');
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
  await assertMembersAllowed(req.user, others);

  const pending = NEEDS_APPROVAL.includes(req.user.role);
  const conv = await Conversation.create({
    // Faculty groups are always class groups; HOD groups are department groups.
    type: req.user.role === 'faculty' ? 'class' : type,
    name: name.trim(),
    description: description?.trim(),
    participants: [req.user._id, ...others],
    admins: [req.user._id],
    createdBy: req.user._id,
    linkedDepartment: req.user.role === 'admin' ? undefined : req.user.department,
    status: pending ? 'pending' : 'active',
    isActive: !pending,
  });

  if (pending) {
    logActivity(req, 'chat.group_request', { entityType: 'conversation', entityId: conv._id, summary: conv.name });
    notifyRoles(['admin'], {
      type: 'chat',
      title: 'Group chat awaiting approval',
      message: `${req.user.name} wants to create "${conv.name}" with ${others.length} member${others.length === 1 ? '' : 's'}`,
      link: '/admin/chat-requests',
    });
    const populated = await Conversation.findById(conv._id).populate('participants', CHAT_USER_FIELDS);
    return res.status(202).json({ ...withPresence(populated, req.user._id), pending: true });
  }

  logActivity(req, 'chat.group_create', { entityType: 'conversation', entityId: conv._id, summary: conv.name });
  const populated = await Conversation.findById(conv._id).populate('participants', CHAT_USER_FIELDS);
  emitToUsers(participantIds(conv), 'chat:conversation', { conversationId: String(conv._id) });
  res.status(201).json(withPresence(populated, req.user._id));
});

// ── Group approval (admin) ─────────────────────────────────────────

/** Admin: every group request. Everyone else: the requests they made. */
export const listGroupRequests = asyncHandler(async (req, res) => {
  const filter = { status: { $in: ['pending', 'rejected'] } };
  if (req.user.role !== 'admin') filter.createdBy = req.user._id;
  else if (req.query.status !== 'all') filter.status = 'pending';
  const requests = await Conversation.find(filter)
    .populate('createdBy', 'name role department avatar')
    .populate('participants', 'name role department section rollNo avatar')
    .populate('reviewedBy', 'name')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.json(requests.map(({ unreadCounts: _c, lastMessage: _l, ...r }) => r));
});

export const reviewGroupRequest = asyncHandler(async (req, res) => {
  const { action, reason } = req.body; // 'approve' | 'reject'
  const approve = action === 'approve';
  const conv = await Conversation.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    {
      $set: {
        status: approve ? 'active' : 'rejected',
        isActive: approve,
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        ...(approve ? {} : { rejectReason: reason || '' }),
      },
    },
    { new: true }
  );
  if (!conv) throw new ApiError(404, 'This request was not found or has already been reviewed');

  logActivity(req, `chat.group_${approve ? 'approved' : 'rejected'}`, { entityType: 'conversation', entityId: conv._id, summary: conv.name });
  notifyUsers([conv.createdBy], {
    type: 'chat',
    title: approve ? `Group "${conv.name}" approved` : `Group "${conv.name}" was not approved`,
    message: approve ? 'Your group chat is now live.' : reason || 'An administrator rejected the request.',
    link: approve ? `/chat/${conv._id}` : '/chat',
  });
  if (approve) {
    const members = participantIds(conv).filter((id) => !sameId(id, conv.createdBy));
    notifyUsers(members, { type: 'chat', title: `You were added to "${conv.name}"`, link: `/chat/${conv._id}` });
    emitToUsers(participantIds(conv), 'chat:conversation', { conversationId: String(conv._id) });
  }
  res.json({ _id: conv._id, status: conv.status });
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

  const text = String(req.body.body);
  const msg = await Message.create({
    conversation: conv._id,
    sender: req.user._id,
    body: seal(text),
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
        lastMessage: { body: seal(text.slice(0, 200)), sender: req.user._id, sentAt: msg.createdAt },
        [`unreadCounts.${req.user._id}`]: 0,
      },
      $inc: unreadInc,
    }
  );

  const populated = openMsg(await populateMessage(Message.findById(msg._id)));
  emitToUsers(participantIds(conv), 'chat:message', { conversationId: String(conv._id), message: populated });

  // Android devices that are not connected get a push notification.
  const offline = recipients.filter((id) => !isUserOnline(id));
  if (offline.length) {
    sendPushToUsers(offline, {
      title: conv.type === 'private' ? req.user.name : `${req.user.name} · ${conv.name}`,
      body: text,
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
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (!Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
  }

  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) {
    // Bodies are encrypted at rest, so matching happens after decryption.
    const recent = await populateMessage(Message.find({ ...filter, deletedAt: null }))
      .sort({ createdAt: -1 })
      .limit(SEARCH_WINDOW)
      .lean();
    const hits = recent.map(openMsg).filter((m) => String(m.body).toLowerCase().includes(q));
    return res.json({ messages: hits.slice(skip, skip + limit).reverse(), pagination: pageMeta(hits.length, page, limit) });
  }

  const [messages, total] = await Promise.all([
    populateMessage(Message.find(filter)).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Message.countDocuments(filter),
  ]);

  res.json({ messages: messages.map(openMsg).reverse(), pagination: pageMeta(total, page, limit) });
});

/** Search messages across every conversation the user belongs to. */
export const searchMessages = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const mine = await Conversation.find({ participants: req.user._id, isActive: true }).distinct('_id');
  const recent = await Message.find({ conversation: { $in: mine }, deletedAt: null })
    .populate('sender', 'name avatar')
    .populate('conversation', 'type name')
    .sort({ createdAt: -1 })
    .limit(SEARCH_WINDOW)
    .lean();
  res.json(recent.map(openMsg).filter((m) => String(m.body).toLowerCase().includes(q)).slice(0, 30));
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
  res.json(openMsg(msg));
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
  await assertMembersAllowed(req.user, valid);

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
