import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { selectUser } from '../../../store/authSlice';
import { Button, Card, Chip, Header, Input, Screen, T } from '../../../components/ui';
import DateField from '../../../components/DateField';
import PickerField from '../../../components/PickerField';
import AttachDocument from '../../../components/AttachDocument';
import { errMsg, useCreateDayScholarOutingMutation, useCreateGatePassMutation } from '../../../services/api';
import { GATE_PASS_REGARDING, INDIAN_STATES } from '../../../theme';
import { EmergencyRequestForm } from '../../../components/EmergencyGatePass';
import { dateKey } from '../../../utils/dates';

/**
 * Day scholar Outing: today only (the server sets the date), no destination
 * and no return check-in — it completes when security records the exit.
 */
function OutingForm() {
  const me = useSelector(selectUser);
  const [create, { isLoading }] = useCreateDayScholarOutingMutation();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [doc, setDoc] = useState(null);
  const [errors, setErrors] = useState({});

  const submit = async () => {
    const e = {};
    if (subject.trim().length < 2) e.subject = 'At least 2 characters';
    if (description.trim().length < 5) e.description = 'At least 5 characters';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await create({ subject: subject.trim(), description: description.trim(), ...(doc ? { supportingDocument: doc } : {}) }).unwrap();
      Alert.alert('Outing requested', 'Your class faculty has been notified.');
      router.back();
    } catch (err) {
      Alert.alert('Could not submit', errMsg(err));
    }
  };

  return (
    <Card style={{ gap: 14 }}>
      <Input label="Subject" value={subject} onChangeText={setSubject} maxLength={120} placeholder="e.g. Doctor appointment" error={errors.subject} />
      <Input label="Description" value={description} onChangeText={setDescription} multiline maxLength={500} placeholder="Why do you need to go out today?" error={errors.description} />
      <Input label="Parent's mobile number (registered)" value={me?.parentPhone || 'Not on file — ask the administrator'} editable={false} hint="The parent verification OTP is sent to this registered number." />
      <AttachDocument value={doc} onChange={setDoc} />
      <T v="small">For today only. No return check-in is needed — the pass is complete once security records your exit.</T>
      <Button title="Request outing" onPress={submit} loading={isLoading} />
    </Card>
  );
}

export default function NewGatePass() {
  const me = useSelector(selectUser);
  // Day scholars see Outing instead of the multi-day pass; hostelers are unchanged.
  const isDayScholar = me?.stayType === 'day_scholar';
  const [type, setType] = useState(isDayScholar ? 'outing' : 'normal');
  const [create, { isLoading }] = useCreateGatePassMutation();
  const [regarding, setRegarding] = useState('outing');
  const [description, setDescription] = useState('');
  // The parent OTP always goes to the number the administrator registered.
  const [state, setState] = useState('');
  const [district, setDistrict] = useState('');
  const [area, setArea] = useState('');
  const [fromDate, setFromDate] = useState(() => new Date());
  const [toDate, setToDate] = useState(() => new Date());
  const [errors, setErrors] = useState({});

  const submit = async () => {
    const e = {};
    if (description.trim().length < 5) e.description = 'Please describe the reason (5+ characters)';
    if (!state) e.state = 'Select a state';
    if (!district.trim()) e.district = 'Required';
    if (!area.trim()) e.area = 'Required';
    if (dateKey(toDate) < dateKey(fromDate)) e.toDate = 'Cannot be before the departure date';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await create({
        regarding,
        description: description.trim(),
        destination: { state, district: district.trim(), area: area.trim() },
        fromDate: dateKey(fromDate),
        toDate: dateKey(toDate),
      }).unwrap();
      Alert.alert('Request sent', 'Your class faculty has been notified.');
      router.back();
    } catch (err) {
      Alert.alert('Could not submit', errMsg(err));
    }
  };

  return (
    <Screen>
      <Header
        back
        title={isDayScholar ? 'Request an outing' : 'Request gate pass'}
        subtitle={
          type === 'emergency'
            ? 'Goes straight to the authority you choose — no faculty, HOD or parent OTP.'
            : type === 'outing'
              ? 'For today only. Class faculty (parent OTP) → HOD → principal.'
              : 'Goes to your class faculty, then HOD, then the principal.'
        }
      />
      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
        {isDayScholar ? (
          <Chip label="Outing" active={type === 'outing'} onPress={() => setType('outing')} />
        ) : (
          <Chip label="Normal gate pass" active={type === 'normal'} onPress={() => setType('normal')} />
        )}
        <Chip label="Emergency gate pass" active={type === 'emergency'} onPress={() => setType('emergency')} />
      </View>
      {type === 'emergency' ? (
        <Card>
          <EmergencyRequestForm onSubmitted={() => router.back()} />
        </Card>
      ) : type === 'outing' ? (
        <OutingForm />
      ) : (
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
        <Input label="Parent's mobile number (registered)" value={me?.parentPhone || 'Not on file — ask the administrator'} editable={false} />
        <DateField label="From date" value={fromDate} onChange={setFromDate} minimumDate={new Date()} error={errors.fromDate} />
        <DateField label="To date (return by)" value={toDate} onChange={setToDate} minimumDate={fromDate} error={errors.toDate} />
        <PickerField label="State" value={state} onChange={setState} options={INDIAN_STATES} placeholder="Select state" error={errors.state} />
        <Input label="District" value={district} onChangeText={setDistrict} maxLength={80} error={errors.district} />
        <Input label="Village / area" value={area} onChangeText={setArea} maxLength={120} error={errors.area} />
        <Button title="Submit request" onPress={submit} loading={isLoading} />
      </Card>
      )}
    </Screen>
  );
}
