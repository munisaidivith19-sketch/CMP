import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Chip, Header, Input, Screen, T } from '../../../components/ui';
import DateTimeField from '../../../components/DateTimeField';
import { errMsg, useCreateGatePassMutation } from '../../../services/api';
import { titleCase } from '../../../utils/format';

const REASONS = ['medical', 'family_emergency', 'personal', 'official', 'outing', 'other'];

export default function NewGatePass() {
  const [create, { isLoading }] = useCreateGatePassMutation();
  const [reason, setReason] = useState('personal');
  const [description, setDescription] = useState('');
  const [destination, setDestination] = useState('');
  const [exit, setExit] = useState(() => new Date(Date.now() + 15 * 60000));
  const [ret, setRet] = useState(() => new Date(Date.now() + 3.25 * 3600000));
  const [errors, setErrors] = useState({});

  const submit = async () => {
    const e = {};
    if (description.trim().length < 5) e.description = 'Please describe the reason (5+ characters)';
    if (exit < new Date(Date.now() - 15 * 60000)) e.exit = 'Exit time cannot be in the past';
    if (ret <= exit) e.ret = 'Return must be after exit';
    else if (ret - exit > 7 * 86400000) e.ret = 'A pass can cover at most 7 days';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await create({ reason, description: description.trim(), destination: destination.trim() || undefined, expectedExit: exit.toISOString(), expectedReturn: ret.toISOString() }).unwrap();
      Alert.alert('Request sent', 'You’ll be notified as soon as it’s reviewed.');
      router.back();
    } catch (err) {
      Alert.alert('Could not submit', errMsg(err));
    }
  };

  return (
    <Screen>
      <Header back title="Request gate pass" subtitle="Faculty or an administrator reviews every request." />
      <Card style={{ gap: 14 }}>
        <View style={{ gap: 6 }}>
          <T v="label">Reason</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {REASONS.map((r) => (
              <Chip key={r} label={titleCase(r)} active={reason === r} onPress={() => setReason(r)} />
            ))}
          </View>
        </View>
        <Input label="Details" value={description} onChangeText={setDescription} multiline maxLength={500} placeholder="Why do you need to leave campus?" error={errors.description} />
        <Input label="Destination (optional)" value={destination} onChangeText={setDestination} maxLength={160} placeholder="e.g. City hospital" />
        <DateTimeField label="Leaving at" value={exit} onChange={setExit} minimumDate={new Date()} error={errors.exit} />
        <DateTimeField label="Returning by" value={ret} onChange={setRet} minimumDate={exit} error={errors.ret} />
        <Button title="Submit request" onPress={submit} loading={isLoading} />
      </Card>
    </Screen>
  );
}
