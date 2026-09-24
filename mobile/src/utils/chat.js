import { sameId } from './format';

/** Title and "other person" of a conversation from the viewer's side. */
export function describeConversation(conv, me) {
  if (!conv) return {};
  if (conv.type === 'private') {
    const other = conv.participants.find((p) => !sameId(p, me)) || conv.participants[0];
    return { title: other?.name, other };
  }
  return { title: conv.name, group: true };
}
