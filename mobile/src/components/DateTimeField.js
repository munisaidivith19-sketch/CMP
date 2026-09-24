import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CalendarDays } from 'lucide-react-native';
import { T } from './ui';
import { colors, fonts } from '../theme';
import { fmtDateTime } from '../utils/format';

/** Tap to pick a date, then a time (Android shows them as two native dialogs). */
export default function DateTimeField({ label, value, onChange, minimumDate, maximumDate, error }) {
  const [mode, setMode] = useState(null);

  const onPick = (event, picked) => {
    if (event.type === 'dismissed' || !picked) return setMode(null);
    if (mode === 'date') {
      const next = new Date(value);
      next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      onChange(next);
      setMode(Platform.OS === 'android' ? 'time' : null);
    } else {
      const next = new Date(value);
      next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      onChange(next);
      setMode(null);
    }
  };

  return (
    <View>
      {label ? <T v="label" style={{ marginBottom: 6 }}>{label}</T> : null}
      <Pressable
        onPress={() => setMode('date')}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${fmtDateTime(value)}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: error ? colors.danger : 'rgba(255,255,255,0.85)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13 }}
      >
        <CalendarDays size={16} color={colors.primary} />
        <T style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.ink }}>{fmtDateTime(value)}</T>
      </Pressable>
      {error ? <T v="small" style={{ color: colors.danger, marginTop: 4 }}>{error}</T> : null}
      {mode ? <DateTimePicker value={value} mode={mode} onChange={onPick} minimumDate={minimumDate} maximumDate={maximumDate} /> : null}
    </View>
  );
}
