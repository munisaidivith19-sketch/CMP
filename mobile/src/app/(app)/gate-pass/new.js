import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Chip, Header, Input, Screen, T } from '../../../components/ui';
import DateField from '../../../components/DateField';
import PickerField from '../../../components/PickerField';
import { errMsg, useCreateGatePassMutation } from '../../../services/api';
import { GATE_PASS_REGARDING, INDIAN_STATES } from '../../../theme';

export default function NewGatePass() {
  const [create, { isLoading }] = useCreateGatePassMutation();
  const [regarding, setRegarding] = useState('outing');
  const [description, setDescription] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [state, setState] = useState('');
  const [district, setDistrict] = useState('');
  const [area, setArea] = useState('');
  const [fromDate, setFromDate] = useState(() => new Date());
  const [toDate, setToDate] = useState(() => new Date());
  const [errors, setErrors] = useState({});

  const submit = async () => {
    const e = {};
    if (description.trim().length < 5) e.description = 'Please describe the reason (5+ characters)';
    if (parentPhone.trim().length < 6) e.parentPhone = "Enter a valid parent's mobile number";
    if (!state) e.state = 'Select a state';
    if (!district.trim()) e.district = 'Required';
    if (!area.trim()) e.area = 'Required';
    if (toDate < fromDate) e.toDate = 'Cannot be before the departure date';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await create({
        regarding,
        description: description.trim(),
        parentPhone: parentPhone.trim(),
        destination: { state, district: district.trim(), area: area.trim() },
        fromDate: fromDate.toISOString().slice(0, 10),
        toDate: toDate.toISOString().slice(0, 10),
      }).unwrap();
      Alert.alert('Request sent', 'Your class faculty has been notified.');
      router.back();
    } catch (err) {
      Alert.alert('Could not submit', errMsg(err));
    }
  };

  return (
    <Screen>
      <Header back title="Request gate pass" subtitle="Goes to your class faculty, then HOD, then the principal." />
      <Card style={{ gap: 14 }}>
        <View style={{ gap: 6 }}>
          <T v="label">Regarding</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {Object.entries(GATE_PASS_REGARDING).map(([value, label]) => (
              <Chip key={value} label={label} active={regarding === value} onPress={() => setRegarding(value)} />
            ))}
          </View>
        </View>
        <Input label="Description" value={description} onChangeText={setDescription} multiline maxLength={500} placeholder="Why do you need to leave campus?" error={errors.description} />
        <Input label="Parent's mobile number" value={parentPhone} onChangeText={setParentPhone} keyboardType="phone-pad" maxLength={20} error={errors.parentPhone} />
        <DateField label="From date" value={fromDate} onChange={setFromDate} minimumDate={new Date()} error={errors.fromDate} />
        <DateField label="To date (return by)" value={toDate} onChange={setToDate} minimumDate={fromDate} error={errors.toDate} />
        <PickerField label="State" value={state} onChange={setState} options={INDIAN_STATES} placeholder="Select state" error={errors.state} />
        <Input label="District" value={district} onChangeText={setDistrict} maxLength={80} error={errors.district} />
        <Input label="Village / area" value={area} onChangeText={setArea} maxLength={120} error={errors.area} />
        <Button title="Submit request" onPress={submit} loading={isLoading} />
      </Card>
    </Screen>
  );
}
