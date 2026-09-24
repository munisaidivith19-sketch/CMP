import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Chip, Header, Input, Screen, T } from '../../../components/ui';
import { errMsg, useCreateDiscussionMutation } from '../../../services/api';
import { titleCase } from '../../../utils/format';

const CATEGORIES = ['general', 'academics', 'placements', 'events', 'clubs', 'help', 'other'];

export default function NewDiscussion() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [create, { isLoading }] = useCreateDiscussionMutation();

  const submit = async () => {
    if (title.trim().length < 5) return Alert.alert('Title must be at least 5 characters');
    if (body.trim().length < 10) return Alert.alert('Please add a bit more detail (10+ characters)');
    try {
      const d = await create({ title: title.trim(), body: body.trim(), category }).unwrap();
      router.replace(`/discussions/${d._id}`);
    } catch (e) {
      Alert.alert('Could not post', errMsg(e));
    }
  };

  return (
    <Screen>
      <Header back title="Start a discussion" />
      <Card style={{ gap: 14 }}>
        <Input label="Title" value={title} onChangeText={setTitle} maxLength={160} />
        <View style={{ gap: 6 }}>
          <T v="label">Category</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {CATEGORIES.map((c) => (
              <Chip key={c} label={titleCase(c)} active={category === c} onPress={() => setCategory(c)} />
            ))}
          </View>
        </View>
        <Input label="Details" value={body} onChangeText={setBody} multiline maxLength={5000} />
        <Button title="Post" onPress={submit} loading={isLoading} />
      </Card>
    </Screen>
  );
}
