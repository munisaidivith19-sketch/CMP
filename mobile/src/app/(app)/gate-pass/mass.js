import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { CheckCircle2, DoorOpen } from 'lucide-react-native';
import { Button, Card, Chip, EmptyState, Header, Input, Screen, T } from '../../../components/ui';
import DateTimeField from '../../../components/DateTimeField';
import { errMsg, useGetGateDashboardQuery, useMassApproveGatePassMutation } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';

/**
 * Principal only (enforced by the API): pre-approved gate passes for every
 * hosteler inside campus at once — no student request needed.
 */
export default function MassOutpass() {
  const me = useSelector(selectUser);
  const { data: dash } = useGetGateDashboardQuery(undefined, { skip: me.role !== 'principal' });
  const [massApprove, { isLoading }] = useMassApproveGatePassMutation();
  const [fromDate, setFromDate] = useState(() => new Date());
  const [toDate, setToDate] = useState(() => new Date(Date.now() + 3 * 86400000));
  const [regarding, setRegarding] = useState('home');
  const [area, setArea] = useState('Home / Native');
  const [district, setDistrict] = useState('');
  const [state, setState] = useState('Tamil Nadu');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState({});

  if (me.role !== 'principal') {
    return (
      <Screen>
        <Header back title="Mass outpass" />
        <Card>
          <EmptyState icon={DoorOpen} title="Only the principal can authorise a mass outpass" />
        </Card>
      </Screen>
    );
  }

  const summary = dash?.hostelSummary;
  const submit = () => {
    const e = {};
    if (description.trim().length < 3) e.description = 'At least 3 characters';
    if (toDate <= fromDate) e.toDate = 'Return must be after departure';
    if (toDate - fromDate > 30 * 86400000) e.toDate = 'A gate pass can cover at most 30 days';
    if (!area.trim()) e.area = 'Required';
    setErrors(e);
    if (Object.keys(e).length) return;
    Alert.alert('Authorise mass outpass?', `Every eligible hosteler inside campus${summary ? ` (${summary.inside})` : ''} gets an approved gate pass. Their pending requests are replaced.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Authorise',
        onPress: async () => {
          try {
            const res = await massApprove({
              fromDate: fromDate.toISOString(),
              toDate: toDate.toISOString(),
              regarding,
              description: description.trim(),
              destination: { area: area.trim(), district: district.trim(), state: state.trim() },
            }).unwrap();
            Alert.alert('Done', res.message || `Authorised ${res.count} outpass(es).`);
            router.back();
          } catch (err) {
            Alert.alert('Could not authorise', errMsg(err));
          }
        },
      },
    ]);
  };

  return (
    <Screen>
      <Header back title="Mass outpass" subtitle="Pre-approved passes for hostelers — no student request needed." />
      {summary ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            ['Inside', summary.inside],
            ['Outside', summary.outside],
            ['Hostelers', summary.total],
          ].map(([k, v]) => (
            <Card key={k} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <T v="label">{k}</T>
              <T v="h2">{v ?? 0}</T>
            </Card>
          ))}
        </View>
      ) : null}
      <Card style={{ gap: 14 }}>
        <DateTimeField label="Departure" value={fromDate} onChange={setFromDate} minimumDate={new Date()} />
        <DateTimeField label="Return due" value={toDate} onChange={setToDate} minimumDate={fromDate} error={errors.toDate} />
        <View style={{ gap: 6 }}>
          <T v="label">Regarding</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="Home / Vacation" active={regarding === 'home'} onPress={() => setRegarding('home')} />
            <Chip label="Outing / Event" active={regarding === 'outing'} onPress={() => setRegarding('outing')} />
          </View>
        </View>
        <Input label="Destination area" value={area} onChangeText={setArea} maxLength={120} error={errors.area} />
        <Input label="District" value={district} onChangeText={setDistrict} maxLength={120} placeholder="Optional" />
        <Input label="State" value={state} onChangeText={setState} maxLength={120} />
        <Input label="Purpose" value={description} onChangeText={setDescription} multiline maxLength={500} placeholder="e.g. Pongal festival holidays" error={errors.description} />
        <Button title={`Authorise mass outpass${summary ? ` (${summary.inside} eligible)` : ''}`} icon={CheckCircle2} loading={isLoading} onPress={submit} />
      </Card>
    </Screen>
  );
}
