import { useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { Check, Users } from 'lucide-react-native';
import { Avatar, Button, Chip, EmptyState, Header, Input, Loading, Screen, T } from '../../../components/ui';
import { errMsg, useCreateConversationMutation, useGetUsersQuery } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { GROUP_CREATORS, ROLE_LABELS, colors } from '../../../theme';
import { sameId } from '../../../utils/format';

const GROUP_SCOPE = {
  admin: 'Add anyone on campus.',
  hod: 'Add students and staff of your department.',
  faculty: 'Add students of your sections. An admin approves the group before it goes live.',
};

export default function NewChat() {
  const me = useSelector(selectUser);
  const canGroup = GROUP_CREATORS.includes(me.role);
  const [group, setGroup] = useState(false);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState('');
  // Group members must come from the creator's own department (admins: anyone).
  const scope = group && me.role !== 'admin' && me.department ? { department: me.department } : {};
  const { data, isFetching } = useGetUsersQuery({ q: q || undefined, limit: 30, ...scope });
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

  const createGroup = async () => {
    try {
      const conv = await create({ type: 'group', name: name.trim(), participantIds: picked.map((u) => u._id) }).unwrap();
      if (conv.pending) {
        Alert.alert('Request sent', 'Your group goes live as soon as an admin approves it. You’ll get a notification.');
        router.back();
        return;
      }
      router.replace(`/chat/${conv._id}`);
    } catch (e) {
      Alert.alert('Could not create group', errMsg(e));
    }
  };

  const toggle = (u) => setPicked((p) => (p.some((x) => sameId(x, u)) ? p.filter((x) => !sameId(x, u)) : [...p, u]));

  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, gap: 12 }}>
        <Header back title={group ? 'New group' : 'New message'} subtitle={group ? GROUP_SCOPE[me.role] : 'Start a private chat with anyone on campus.'} />
        {canGroup ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="Private" active={!group} onPress={() => setGroup(false)} />
            <Chip label="Group" active={group} onPress={() => setGroup(true)} />
          </View>
        ) : null}
        {group ? (
          <>
            <Input placeholder="Group name, e.g. CSE-A Mini project" value={name} onChangeText={setName} maxLength={100} />
            {picked.length ? (
              <T v="small" numberOfLines={2}>
                {picked.length} selected: {picked.map((u) => u.name.split(' ')[0]).join(', ')}
              </T>
            ) : null}
            <Button
              title={me.role === 'faculty' ? 'Request group' : 'Create group'}
              icon={Users}
              onPress={createGroup}
              loading={isLoading}
              disabled={!picked.length || name.trim().length < 2}
            />
          </>
        ) : null}
        <Input placeholder="Search by name, department or skill" value={q} onChangeText={setQ} autoFocus={!group} />
      </View>
      {isFetching && !people.length ? (
        <Loading />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(u) => u._id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30 }}
          ListEmptyComponent={<EmptyState title="No people found" />}
          renderItem={({ item: u }) => {
            const on = picked.some((x) => sameId(x, u));
            return (
              <Pressable
                disabled={isLoading}
                onPress={() => (group ? toggle(u) : start(u))}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18, backgroundColor: on ? colors.primarySoft : pressed ? 'rgba(255,255,255,0.8)' : 'transparent' })}
              >
                <Avatar user={u} size={44} />
                <View style={{ flex: 1 }}>
                  <T v="strong">{u.name}</T>
                  <T v="small">
                    {ROLE_LABELS[u.role]}
                    {u.department ? ` · ${u.department}` : ''}
                    {u.section ? ` · Sec ${u.section}` : ''}
                  </T>
                </View>
                {group && on ? <Check size={20} color={colors.primary} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}
