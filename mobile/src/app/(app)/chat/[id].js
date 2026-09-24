import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSelector } from 'react-redux';
import { Check, CheckCheck, CornerUpLeft, Send, Users, X } from 'lucide-react-native';
import { isSameDay, isToday, isYesterday, format } from 'date-fns';
import { Avatar, ErrorState, Header, IconTile, Loading, Screen, T } from '../../../components/ui';
import { errMsg, useDeleteMessageMutation, useGetConversationQuery, useGetMessagesQuery, useLazyGetMessagesQuery, useSendMessageMutation } from '../../../services/api';
import { emit, emitWithAck, useSocketEvent, useSocketRoom } from '../../../services/socket';
import { selectUser } from '../../../store/authSlice';
import { colors, fonts, gradients } from '../../../theme';
import { fmtTime, sameId, timeAgo } from '../../../utils/format';
import { describeConversation } from '../../../utils/chat';

const dayLabel = (d) => {
  const date = new Date(d);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEE, dd MMM yyyy');
};

export default function Thread() {
  const { id } = useLocalSearchParams();
  const me = useSelector(selectUser);
  const { data: conv, error: convError, refetch } = useGetConversationQuery(id);
  const { data: first, isLoading } = useGetMessagesQuery({ id, limit: 40 }, { refetchOnMountOrArgChange: true });
  const [loadOlder, { isFetching: loadingOlder }] = useLazyGetMessagesQuery();
  const [send, { isLoading: sending }] = useSendMessageMutation();
  const [remove] = useDeleteMessageMutation();
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [typingIds, setTypingIds] = useState([]);
  const [online, setOnline] = useState(null);
  const typingSent = useRef(false);
  const typingTimer = useRef(null);

  useSocketRoom('chat:join', 'chat:leave', id);

  useEffect(() => {
    if (first) {
      setMessages(first.messages);
      setHasMore(first.pagination.total > first.messages.length);
    }
  }, [first]);

  const markRead = useCallback(() => emitWithAck('chat:read', { conversationId: id }), [id]);
  useEffect(() => {
    markRead();
  }, [markRead, first]);

  useSocketEvent('chat:message', ({ conversationId, message }) => {
    if (conversationId !== id) return;
    setMessages((prev) => (prev.some((m) => m._id === message._id) ? prev : [...prev, message]));
    setTypingIds((t) => t.filter((u) => !sameId(u, message.sender)));
    if (!sameId(message.sender, me)) markRead();
  });
  useSocketEvent('chat:messageDeleted', ({ conversationId, messageId }) => {
    if (conversationId === id) setMessages((prev) => prev.map((m) => (m._id === messageId ? { ...m, body: 'This message was deleted', deletedAt: new Date().toISOString(), replyTo: null } : m)));
  });
  useSocketEvent('chat:read', ({ conversationId, userId }) => {
    if (conversationId !== id || sameId(userId, me)) return;
    setMessages((prev) => prev.map((m) => (sameId(m.sender, me) && !m.readBy?.some((r) => sameId(r, userId)) ? { ...m, readBy: [...(m.readBy || []), userId] } : m)));
  });
  useSocketEvent('chat:typing', ({ conversationId, userId, isTyping }) => {
    if (conversationId !== id) return;
    setTypingIds((t) => (isTyping ? [...new Set([...t, userId])] : t.filter((u) => u !== userId)));
  });
  useSocketEvent('presence:update', ({ userId, online: on }) => {
    const d = describeConversation(conv, me);
    if (d.other && sameId(d.other, userId)) setOnline(on);
  });

  const stopTyping = () => {
    clearTimeout(typingTimer.current);
    if (typingSent.current) emit('chat:typing', { conversationId: id, isTyping: false });
    typingSent.current = false;
  };
  useEffect(() => stopTyping, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onType = (v) => {
    setText(v);
    if (!typingSent.current && v.trim()) {
      emit('chat:typing', { conversationId: id, isTyping: true });
      typingSent.current = true;
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 2500);
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    stopTyping();
    try {
      const msg = await send({ id, body, replyTo: replyTo?._id }).unwrap();
      setMessages((prev) => (prev.some((m) => m._id === msg._id) ? prev : [...prev, msg]));
      setText('');
      setReplyTo(null);
    } catch (e) {
      Alert.alert('Message not sent', errMsg(e));
    }
  };

  const older = async () => {
    if (!messages[0] || loadingOlder) return;
    const res = await loadOlder({ id, before: messages[0].createdAt, limit: 40 }).unwrap().catch(() => null);
    if (!res) return;
    setMessages((prev) => [...res.messages.filter((m) => !prev.some((p) => p._id === m._id)), ...prev]);
    setHasMore(res.pagination.total > res.messages.length);
  };

  const onLongPress = (m) => {
    if (m.deletedAt) return;
    const mine = sameId(m.sender, me);
    Alert.alert('Message', m.body.slice(0, 80), [
      { text: 'Reply', onPress: () => setReplyTo(m) },
      ...(mine ? [{ text: 'Delete', style: 'destructive', onPress: () => remove({ id, msgId: m._id }).unwrap().catch((e) => Alert.alert('Could not delete', errMsg(e))) }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (convError) {
    return (
      <Screen>
        <Header back title="Chat" />
        <ErrorState error={convError} onRetry={refetch} />
      </Screen>
    );
  }

  const d = describeConversation(conv, me);
  const others = conv?.participants.filter((p) => !sameId(p, me)) || [];
  const isOnline = online ?? d.other?.online;
  const typingNames = typingIds.map((u) => conv?.participants.find((p) => sameId(p, u))?.name?.split(' ')[0]).filter(Boolean);
  const status = typingNames.length
    ? `${typingNames.join(', ')} typing…`
    : d.group
      ? `${conv.participants.length} members`
      : isOnline
        ? 'Online'
        : d.other?.lastSeenAt
          ? `Last seen ${timeAgo(d.other.lastSeenAt)}`
          : '';
  const reversed = [...messages].reverse();

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderColor: 'rgba(108,93,211,0.08)' }}>
          <View style={{ flex: 1 }}>
            <Header back title={d.title || 'Chat'} subtitle={status} right={d.group ? <IconTile icon={Users} gradient={gradients.hero} size={40} /> : <Avatar user={d.other} size={40} online={isOnline} />} />
          </View>
        </View>

        {isLoading ? (
          <Loading />
        ) : (
          <FlatList
            data={reversed}
            inverted
            keyExtractor={(m) => m._id}
            contentContainerStyle={{ padding: 12, gap: 6 }}
            onEndReached={() => hasMore && older()}
            onEndReachedThreshold={0.2}
            ListFooterComponent={loadingOlder ? <Loading /> : null}
            ListEmptyComponent={<T v="small" style={{ textAlign: 'center', padding: 30, transform: [{ scaleY: -1 }] }}>Say hello 👋</T>}
            renderItem={({ item: m, index }) => {
              const mine = sameId(m.sender, me);
              const prev = reversed[index + 1];
              const newDay = !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));
              const read = mine && others.length && others.every((o) => m.readBy?.some((r) => sameId(r, o)));
              return (
                <View>
                  {newDay ? (
                    <T v="small" style={{ textAlign: 'center', marginVertical: 8, color: colors.muted }}>
                      {dayLabel(m.createdAt)}
                    </T>
                  ) : null}
                  <Pressable onLongPress={() => onLongPress(m)} delayLongPress={300} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                    {!mine && d.group && (!prev || !sameId(prev.sender, m.sender) || newDay) ? (
                      <T v="small" style={{ color: colors.primary, marginLeft: 10, marginBottom: 2 }}>
                        {m.sender?.name}
                      </T>
                    ) : null}
                    <View style={{ maxWidth: '82%', borderRadius: 22, borderBottomRightRadius: mine ? 6 : 22, borderBottomLeftRadius: mine ? 22 : 6, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: mine ? colors.primary : '#fff', opacity: m.deletedAt ? 0.6 : 1 }}>
                      {m.replyTo && !m.deletedAt ? (
                        <View style={{ borderLeftWidth: 3, borderColor: mine ? 'rgba(255,255,255,0.7)' : colors.primary400, paddingLeft: 8, marginBottom: 4 }}>
                          <T v="small" style={{ color: mine ? '#fff' : colors.primary, fontFamily: fonts.bold }}>
                            {m.replyTo.sender?.name || 'Message'}
                          </T>
                          <T v="small" numberOfLines={2} style={{ color: mine ? 'rgba(255,255,255,0.85)' : colors.soft }}>
                            {m.replyTo.body}
                          </T>
                        </View>
                      ) : null}
                      <T v="body" style={{ color: mine ? '#fff' : colors.ink, fontStyle: m.deletedAt ? 'italic' : 'normal' }}>
                        {m.body}
                      </T>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 }}>
                        <T v="small" style={{ fontSize: 10, color: mine ? 'rgba(255,255,255,0.75)' : colors.muted }}>
                          {fmtTime(m.createdAt)}
                        </T>
                        {mine && !m.deletedAt ? read ? <CheckCheck size={13} color="#fff" /> : <Check size={13} color="rgba(255,255,255,0.75)" /> : null}
                      </View>
                    </View>
                  </Pressable>
                </View>
              );
            }}
          />
        )}

        <View style={{ padding: 10, borderTopWidth: 1, borderColor: 'rgba(108,93,211,0.08)', backgroundColor: 'rgba(255,255,255,0.7)' }}>
          {replyTo ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primarySoft, borderRadius: 14, padding: 8, marginBottom: 8 }}>
              <CornerUpLeft size={14} color={colors.primary} />
              <T v="small" numberOfLines={1} style={{ flex: 1 }}>
                Replying to {sameId(replyTo.sender, me) ? 'yourself' : replyTo.sender?.name}: {replyTo.body}
              </T>
              <Pressable onPress={() => setReplyTo(null)} accessibilityLabel="Cancel reply" hitSlop={8}>
                <X size={16} color={colors.soft} />
              </Pressable>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <TextInput
              value={text}
              onChangeText={onType}
              placeholder="Type a message…"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={5000}
              accessibilityLabel="Message"
              style={{ flex: 1, maxHeight: 120, backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15, color: colors.ink }}
            />
            <Pressable onPress={submit} disabled={!text.trim() || sending} accessibilityLabel="Send" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() ? colors.primary : colors.primary300, alignItems: 'center', justifyContent: 'center' }}>
              <Send size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
