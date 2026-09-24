import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { MessageCircle, Plus, Users } from 'lucide-react-native';
import { Avatar, Button, EmptyState, ErrorState, Header, IconButton, IconTile, Input, Loading, Screen, T } from '../../../components/ui';
import { useGetConversationsQuery } from '../../../services/api';
import { useSocketEvent } from '../../../services/socket';
import { selectUser } from '../../../store/authSlice';
import { colors, fonts, gradients } from '../../../theme';
import { listTime, sameId } from '../../../utils/format';
import { describeConversation } from '../../../utils/chat';

export default function ChatList() {
  const me = useSelector(selectUser);
  const [search, setSearch] = useState('');
  const [presence, setPresence] = useState({});
  const [typing, setTyping] = useState({});
  const { data, isLoading, isFetching, error, refetch } = useGetConversationsQuery(search ? { search } : undefined);

  useSocketEvent('presence:update', ({ userId, online }) => setPresence((p) => ({ ...p, [userId]: online })));
  useSocketEvent('chat:typing', ({ conversationId, isTyping }) => setTyping((t) => ({ ...t, [conversationId]: isTyping })));
  useSocketEvent('chat:message', ({ conversationId }) => setTyping((t) => ({ ...t, [conversationId]: false })));

  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, paddingBottom: 8, gap: 12 }}>
        <Header title="Messages" right={<IconButton icon={Plus} label="New message" onPress={() => router.push('/chat/new')} color={colors.primary} />} />
        <Input placeholder="Search chats" value={search} onChangeText={setSearch} accessibilityLabel="Search chats" />
      </View>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <View style={{ padding: 16 }}>
          <ErrorState error={error} onRetry={refetch} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => c._id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30 }}
          ListEmptyComponent={
            <EmptyState icon={MessageCircle} title={search ? 'No chats found' : 'No conversations yet'} text="Message a classmate or faculty member — chats sync live with the web app." action={!search && <Button title="New message" icon={Plus} onPress={() => router.push('/chat/new')} />} />
          }
          renderItem={({ item: c }) => {
            const d = describeConversation(c, me);
            const online = d.other ? presence[d.other._id] ?? d.other.online : false;
            return (
              <Pressable onPress={() => router.push(`/chat/${c._id}`)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20, backgroundColor: pressed ? 'rgba(255,255,255,0.8)' : 'transparent' })}>
                {d.group ? <IconTile icon={Users} gradient={gradients.hero} size={48} /> : <Avatar user={d.other} size={48} online={online} />}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <T v="strong" numberOfLines={1} style={{ flex: 1, fontFamily: c.unreadCount ? fonts.extrabold : fonts.bold }}>
                      {d.title}
                    </T>
                    <T v="small" style={{ color: colors.muted }}>
                      {listTime(c.lastMessage?.sentAt || c.updatedAt)}
                    </T>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <T v="small" numberOfLines={1} style={{ flex: 1, color: typing[c._id] ? colors.primary : colors.soft }}>
                      {typing[c._id] ? 'typing…' : c.lastMessage?.body ? `${sameId(c.lastMessage.sender, me) ? 'You: ' : ''}${c.lastMessage.body}` : 'No messages yet'}
                    </T>
                    {c.unreadCount > 0 ? (
                      <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                        <T v="small" style={{ color: '#fff', fontSize: 10, fontFamily: fonts.bold }}>
                          {c.unreadCount > 99 ? '99+' : c.unreadCount}
                        </T>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}
