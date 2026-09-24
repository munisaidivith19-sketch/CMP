import { useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { Avatar, EmptyState, Header, Input, Loading, Screen, T } from '../../../components/ui';
import { errMsg, useCreateConversationMutation, useGetUsersQuery } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { ROLE_LABELS } from '../../../theme';
import { sameId } from '../../../utils/format';

export default function NewChat() {
  const me = useSelector(selectUser);
  const [q, setQ] = useState('');
  const { data, isFetching } = useGetUsersQuery({ q: q || undefined, limit: 30 });
  const [create, { isLoading }] = useCreateConversationMutation();
  const people = (data?.items || []).filter((u) => !sameId(u, me));

  const start = async (u) => {
    try {
      const conv = await create({ type: 'private', participantIds: [u._id] }).unwrap();
      router.replace(`/chat/${conv._id}`);
    } catch (e) {
      Alert.alert('Could not start chat', errMsg(e));
    }
  };

  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, gap: 12 }}>
        <Header back title="New message" subtitle="Start a private chat with anyone on campus." />
        <Input placeholder="Search by name, department or skill" value={q} onChangeText={setQ} autoFocus />
      </View>
      {isFetching && !people.length ? (
        <Loading />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(u) => u._id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30 }}
          ListEmptyComponent={<EmptyState title="No people found" />}
          renderItem={({ item: u }) => (
            <Pressable disabled={isLoading} onPress={() => start(u)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18, backgroundColor: pressed ? 'rgba(255,255,255,0.8)' : 'transparent' })}>
              <Avatar user={u} size={44} />
              <View style={{ flex: 1 }}>
                <T v="strong">{u.name}</T>
                <T v="small">
                  {ROLE_LABELS[u.role]}
                  {u.department ? ` · ${u.department}` : ''}
                </T>
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
