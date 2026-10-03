import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { Check, Send, Users } from 'lucide-react-native';
import { Avatar, Button, Chip, EmptyState, Header, Input, Loading, Screen, T } from '../../../components/ui';
import { errMsg, useCreateConversationMutation, useGetGroupClassQuery, useGetPeopleFiltersQuery, useGetUsersQuery } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { GROUP_CREATORS, ROLE_LABELS, STUDENT_ROLES, YEAR_LABELS, colors } from '../../../theme';
import { sameId } from '../../../utils/format';

const GROUP_SCOPE = {
  admin: 'Add anyone on campus.',
  hod: 'Sent to the principal for approval, with your reason.',
  faculty: 'Add students of your sections. An admin approves the group before it goes live.',
};
/** Who a private chat can reach — the server enforces exactly this. */
const PRIVATE_SCOPE = {
  student: 'Your classmates, and faculty, HODs, principal, chairman, dean and AO.',
  club_admin: 'Your classmates, and faculty, HODs, principal, chairman, dean and AO.',
  faculty: 'Students of your classes, and campus staff.',
  hod: 'Your department’s students, classes you handle, and campus staff.',
};
// CUSTOM: own-department students from several classes; ACADEMICS: one class;
// FACULTY: faculty from anywhere on campus. The server enforces the same rules.
const CATEGORIES = [
  ['custom', 'CUSTOM'],
  ['academic', 'ACADEMICS'],
  ['faculty', 'FACULTY'],
];
const STAFF = ['faculty', 'hod'];

export default function NewChat() {
  const me = useSelector(selectUser);
  const isHod = me.role === 'hod';
  const canGroup = GROUP_CREATORS.includes(me.role);
  const [group, setGroup] = useState(false);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('custom');
  const [year, setYear] = useState('');
  const [section, setSection] = useState('');
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState('');
  // Faculty group members come from their own department (admins: anyone).
  const scope = group && me.role === 'faculty' && me.department ? { department: me.department } : {};
  // 'picker' is scoped by the server's chat rules: a student only ever finds
  // their classmates and the academic staff.
  const hodBuilder = group && isHod;
  // HOD builder: Custom searches students (own department, by the server's
  // scope), Faculty searches faculty; Academics works from the class list only.
  const role = hodBuilder && category === 'custom' ? { role: 'student' } : {};
  const { data, isFetching } = useGetUsersQuery({ q: q || undefined, limit: 30, context: 'picker', ...scope, ...role });
  const { data: filters } = useGetPeopleFiltersQuery(undefined, { skip: !hodBuilder });
  const { data: cls } = useGetGroupClassQuery({ year, section }, { skip: !hodBuilder || category === 'faculty' || !year || !section });
  const [create, { isLoading }] = useCreateConversationMutation();

  const classList = cls?.students || [];
  const people = useMemo(() => {
    const all = (data?.items || []).filter((u) => !sameId(u, me));
    if (!hodBuilder) return all;
    if (category === 'faculty') return all.filter((u) => STAFF.includes(u.role));
    if (category === 'academic') return classList;
    // Custom: the chosen class's students, or a student search across the department.
    return q.trim() ? all.filter((u) => STUDENT_ROLES.includes(u.role)) : classList;
  }, [data, me, hodBuilder, category, classList, q]);

  const isPicked = (u) => picked.some((x) => sameId(x, u));
  const toggle = (u) => setPicked((p) => (p.some((x) => sameId(x, u)) ? p.filter((x) => !sameId(x, u)) : [...p, u]));
  const classStudents = classList;
  const allOfClass = classStudents.length > 0 && classStudents.every(isPicked);
  const toggleClass = () =>
    setPicked((p) => (allOfClass ? p.filter((u) => !classStudents.some((s) => sameId(s, u))) : [...p, ...classStudents.filter((s) => !p.some((x) => sameId(x, s)))]));
  const pickClass = (y, s) => {
    setYear(y);
    setSection(s);
    // An academic group is one class: another class replaces the students.
    if (category === 'academic') setPicked([]);
  };
  const pickCategory = (c) => {
    setCategory(c);
    setQ('');
    if (c === 'faculty') setPicked((p) => p.filter((u) => STAFF.includes(u.role)));
    else if (c === 'custom') setPicked((p) => p.filter((u) => STUDENT_ROLES.includes(u.role)));
    else setPicked([]);
  };

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
      const conv = await create({
        type: 'group',
        name: name.trim(),
        participantIds: picked.map((u) => u._id),
        ...(isHod ? { category, reason: reason.trim() } : {}),
      }).unwrap();
      if (conv.pending) {
        Alert.alert('Request sent', `Your group goes live as soon as ${isHod ? 'the principal' : 'an admin'} approves it. You’ll get a notification.`);
        router.back();
        return;
      }
      router.replace(`/chat/${conv._id}`);
    } catch (e) {
      Alert.alert('Could not create group', errMsg(e));
    }
  };

  const ready = picked.length > 0 && name.trim().length >= 2 && (!isHod || reason.trim().length >= 5);

  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, gap: 10 }}>
        <Header back title={group ? 'New group' : 'New message'} subtitle={group ? GROUP_SCOPE[me.role] : PRIVATE_SCOPE[me.role] || 'Start a private chat with anyone on campus.'} />
        {canGroup ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="Private" active={!group} onPress={() => setGroup(false)} />
            <Chip label="Group" active={group} onPress={() => setGroup(true)} />
          </View>
        ) : null}
        {group ? (
          <>
            <Input placeholder="Group name" value={name} onChangeText={setName} maxLength={100} />
            {hodBuilder ? (
              <>
                <T v="label">Group type</T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {CATEGORIES.map(([v, l]) => (
                    <Chip key={v} label={l} active={category === v} onPress={() => pickCategory(v)} />
                  ))}
                </View>
                <Input placeholder="Reason for the principal" value={reason} onChangeText={setReason} maxLength={500} multiline />
                {category !== 'faculty' ? (
                  <>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {(filters?.years || [1, 2, 3, 4]).map((y) => (
                        <Chip key={y} label={YEAR_LABELS[y] || `Year ${y}`} active={String(year) === String(y)} onPress={() => pickClass(String(y), section)} />
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {(filters?.sections || []).map((s) => (
                        <Chip key={s} label={`Sec ${s}`} active={section === s} onPress={() => pickClass(year, s)} />
                      ))}
                    </View>
                    {classStudents.length ? (
                      <Button
                        title={allOfClass ? 'Unselect this section' : `Select all ${classStudents.length} students`}
                        variant="soft"
                        small
                        icon={Check}
                        onPress={toggleClass}
                      />
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            {picked.length ? (
              <T v="small" numberOfLines={2}>
                {picked.length} selected member{picked.length === 1 ? '' : 's'}: {picked.map((u) => u.name.split(' ')[0]).join(', ')}
              </T>
            ) : null}
            <Button
              title={isHod ? 'Send request to Principal' : me.role === 'faculty' ? 'Request group' : 'Create group'}
              icon={isHod ? Send : Users}
              onPress={createGroup}
              loading={isLoading}
              disabled={!ready}
            />
          </>
        ) : null}
        {hodBuilder && category === 'academic' ? null : (
          <Input
            placeholder={hodBuilder ? (category === 'faculty' ? 'Search faculty on campus' : 'Search students of your department') : 'Search by name, department or skill'}
            value={q}
            onChangeText={setQ}
            autoFocus={!group}
          />
        )}
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
            const on = isPicked(u);
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
