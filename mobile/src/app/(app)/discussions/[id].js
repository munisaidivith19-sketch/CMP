import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useDispatch } from 'react-redux';
import { Lock, Send, ThumbsUp } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, ErrorState, Header, Input, Loading, Screen, SectionTitle, T } from '../../../components/ui';
import { api, errMsg, useAddReplyMutation, useGetDiscussionQuery, useUpvoteDiscussionMutation } from '../../../services/api';
import { useSocketEvent, useSocketRoom } from '../../../services/socket';
import { colors } from '../../../theme';
import { timeAgo } from '../../../utils/format';

export default function DiscussionDetail() {
  const { id } = useLocalSearchParams();
  const dispatch = useDispatch();
  const { data: d, isLoading, error, refetch, isFetching } = useGetDiscussionQuery(id);
  const [upvote] = useUpvoteDiscussionMutation();
  const [reply, { isLoading: posting }] = useAddReplyMutation();
  const [text, setText] = useState('');

  // Live replies from web or other phones (the server checks access on join).
  useSocketRoom('discussion:join', 'discussion:leave', id);
  useSocketEvent('discussion:reply', ({ discussionId }) => {
    if (discussionId === id) dispatch(api.util.invalidateTags([{ type: 'Discussion', id }]));
  });

  if (isLoading) return <Screen><Header back title="Discussion" /><Loading /></Screen>;
  if (error) return <Screen><Header back title="Discussion" /><ErrorState error={error} onRetry={refetch} /></Screen>;

  const send = async () => {
    if (!text.trim()) return;
    try {
      await reply({ id, body: text.trim() }).unwrap();
      setText('');
    } catch (e) {
      Alert.alert('Reply not posted', errMsg(e));
    }
  };

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <Header back title="Discussion" />
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Badge label={d.category} color="neutral" />
          {d.isLocked ? <Badge label="Locked" color="warning" /> : null}
        </View>
        <T v="h2">{d.title}</T>
        <T v="body">{d.body}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Avatar user={d.author} size={28} />
          <T v="small" style={{ flex: 1 }}>
            {d.author?.name} · {timeAgo(d.createdAt)}
          </T>
          <Pressable onPress={() => upvote(id)} accessibilityLabel="Upvote" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: d.hasUpvoted ? colors.primary : colors.primarySoft }}>
            <ThumbsUp size={14} color={d.hasUpvoted ? '#fff' : colors.primary} />
            <T v="small" style={{ color: d.hasUpvoted ? '#fff' : colors.primary }}>{d.upvoteCount}</T>
          </Pressable>
        </View>
      </Card>

      <SectionTitle title={`${d.replies.length} replies`} />
      {d.replies.map((r) => (
        <Card key={r._id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Avatar user={r.author} size={26} />
            <T v="strong" style={{ flex: 1 }}>{r.author?.name}</T>
            <T v="small" style={{ color: colors.muted }}>{timeAgo(r.createdAt)}</T>
          </View>
          <T v="body">{r.body}</T>
        </Card>
      ))}

      {d.isLocked ? (
        <Card style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Lock size={16} color={colors.soft} />
          <T v="small">This discussion is locked.</T>
        </Card>
      ) : (
        <Card style={{ gap: 10 }}>
          <Input placeholder="Write a reply…" value={text} onChangeText={setText} multiline maxLength={3000} />
          <Button title="Reply" icon={Send} onPress={send} loading={posting} disabled={!text.trim()} />
        </Card>
      )}
    </Screen>
  );
}
