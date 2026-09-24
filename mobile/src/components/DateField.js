import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CalendarDays } from 'lucide-react-native';
import { T } from './ui';
import { colors, fonts } from '../theme';

// `value` here is always a real Date object (from the picker), not a server ISO string.
const fmt = (d) => format(d, 'EEEE, dd MMM yyyy');

/** Tap to pick a calendar date — no time component (used for the gate pass from/to dates). */
export default function DateField({ label, value, onChange, minimumDate, maximumDate, error }) {
  const [open, setOpen] = useState(false);

  const onPick = (event, picked) => {
    setOpen(false);
    if (event.type === 'dismissed' || !picked) return;
    onChange(picked);
  };

  return (
    <View>
      {label ? <T v="label" style={{ marginBottom: 6 }}>{label}</T> : null}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${fmt(value)}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: error ? colors.danger : 'rgba(255,255,255,0.85)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13 }}
      >
        <CalendarDays size={16} color={colors.primary} />
        <T style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.ink }}>{fmt(value)}</T>
      </Pressable>
      {error ? <T v="small" style={{ color: colors.danger, marginTop: 4 }}>{error}</T> : null}
      {open ? <DateTimePicker value={value} mode="date" onChange={onPick} minimumDate={minimumDate} maximumDate={maximumDate} /> : null}
    </View>
  );
}
