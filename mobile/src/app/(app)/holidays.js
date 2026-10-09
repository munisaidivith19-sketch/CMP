import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useSelector } from 'react-redux';
import { CalendarOff, Plus, Trash2 } from 'lucide-react-native';
import { Button, Card, Chip, EmptyState, ErrorState, Header, IconButton, Input, Loading, Screen, T } from '../../components/ui';
import DateField from '../../components/DateField';
import PickerField from '../../components/PickerField';
import { fmtHolidayDates } from '../../components/HolidayCard';
import { errMsg, useCreateHolidayMutation, useDeleteHolidayMutation, useGetHolidaysQuery } from '../../services/api';
import { selectUser } from '../../store/authSlice';
import { ACADEMIC_YEARS, DEPARTMENTS, SECTIONS, colors } from '../../theme';
import { dateKey } from '../../utils/dates';

const ALL = 'All departments';

/**
 * College holidays — Principal only (the API enforces it). A holiday blocks
 * attendance for the classes it covers: everyone, a department, a year of a
 * department, or one section.
 */
function NewHoliday({ onDone }) {
  const [reason, setReason] = useState('');
  const [type, setType] = useState('SINGLE');
  const [startDate, setStartDate] = useState(() => new Date());
  const [endDate, setEndDate] = useState(() => new Date());
  const [department, setDepartment] = useState(ALL);
  const [year, setYear] = useState(null);
  const [section, setSection] = useState(null);
  const [create, { isLoading }] = useCreateHolidayMutation();

  const submit = async () => {
    if (reason.trim().length < 3) return Alert.alert('Reason must be at least 3 characters');
    if (type === 'CUSTOM' && dateKey(endDate) < dateKey(startDate)) return Alert.alert('The "To" date cannot be before the "From" date');
    const dept = department === ALL ? null : department;
    try {
      await create({
        reason: reason.trim(),
        type,
        startDate: dateKey(startDate),
        ...(type === 'CUSTOM' ? { endDate: dateKey(endDate) } : {}),
        department: dept,
        year: dept && year ? year : null,
        section: dept && year && section ? section : null,
      }).unwrap();
      onDone();
    } catch (e) {
      Alert.alert('Could not add holiday', errMsg(e));
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <Input label="Reason" value={reason} onChangeText={setReason} maxLength={200} placeholder="e.g. Pongal" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Single day" active={type === 'SINGLE'} onPress={() => setType('SINGLE')} />
        <Chip label="Date range" active={type === 'CUSTOM'} onPress={() => setType('CUSTOM')} />
      </View>
      <DateField label={type === 'CUSTOM' ? 'From' : 'Date'} value={startDate} onChange={(d) => { setStartDate(d); if (dateKey(endDate) < dateKey(d)) setEndDate(d); }} />
      {type === 'CUSTOM' ? <DateField label="To" value={endDate} minimumDate={startDate} onChange={setEndDate} /> : null}
      <PickerField label="Department" value={department} onChange={(d) => { setDepartment(d); setYear(null); setSection(null); }} options={[ALL, ...DEPARTMENTS]} />
      {department !== ALL ? (
        <View style={{ gap: 6 }}>
          <T v="label">Year</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="All years" active={!year} onPress={() => { setYear(null); setSection(null); }} />
            {ACADEMIC_YEARS.map((y) => (
              <Chip key={y} label={`Year ${y}`} active={year === y} onPress={() => setYear(y)} />
            ))}
          </View>
        </View>
      ) : null}
      {department !== ALL && year ? (
        <View style={{ gap: 6 }}>
          <T v="label">Section</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="All" active={!section} onPress={() => setSection(null)} />
            {SECTIONS.map((s) => (
              <Chip key={s} label={s} active={section === s} onPress={() => setSection(s)} />
            ))}
          </View>
        </View>
      ) : null}
      <Button title="Add holiday" icon={Plus} loading={isLoading} onPress={submit} />
    </Card>
  );
}

export default function Holidays() {
  const me = useSelector(selectUser);
  const isPrincipal = me.role === 'principal';
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useGetHolidaysQuery({ from: dateKey(new Date()) });
  const [remove] = useDeleteHolidayMutation();
  const holidays = data?.holidays || [];

  const confirmDelete = (h) =>
    Alert.alert('Cancel this holiday?', `${h.reason} · ${fmtHolidayDates(h)}. Attendance can be taken on these days again.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel holiday', style: 'destructive', onPress: () => remove(h._id).unwrap().catch((e) => Alert.alert('Could not cancel', errMsg(e))) },
    ]);

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header back title="Holidays" subtitle="Upcoming holidays that apply to you." right={isPrincipal && !adding ? <Button small icon={Plus} title="Add" onPress={() => setAdding(true)} /> : null} />
      {adding ? (
        <>
          <NewHoliday onDone={() => setAdding(false)} />
          <Button title="Close form" variant="ghost" onPress={() => setAdding(false)} />
        </>
      ) : null}
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !holidays.length ? (
        <Card>
          <EmptyState icon={CalendarOff} title="No upcoming holidays" />
        </Card>
      ) : (
        holidays.map((h) => (
          <Card key={h._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <CalendarOff size={20} color={colors.danger} />
            <View style={{ flex: 1, gap: 2 }}>
              <T v="strong">{h.reason}</T>
              <T v="small">{fmtHolidayDates(h)}</T>
              <T v="small" style={{ color: colors.muted }}>{h.scope}</T>
            </View>
            {isPrincipal ? <IconButton icon={Trash2} label="Cancel holiday" color={colors.danger} onPress={() => confirmDelete(h)} /> : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
