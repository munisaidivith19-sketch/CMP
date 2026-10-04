import { View } from 'react-native';
import { CalendarOff } from 'lucide-react-native';
import { Card, T } from './ui';
import { colors } from '../theme';
import { fmtClassDay } from '../utils/format';

// Display helpers only: which holidays apply to whom is decided by the server
// (GET /holidays, the timetable and the attendance roster already filter).

/** Holidays whose range (YYYY-MM-DD strings, inclusive) covers `key`. */
export const holidaysOn = (holidays = [], key) => holidays.filter((h) => h.startDate <= key && h.endDate >= key);

export const fmtHolidayDates = (h) =>
  h.startDate === h.endDate ? fmtClassDay(h.startDate) : `${fmtClassDay(h.startDate)} – ${fmtClassDay(h.endDate)}`;

/** HOLIDAY · reason · scope — shown wherever a class or date is on holiday. */
export default function HolidayCard({ holiday, text = 'Attendance cannot be taken for this class on this date.' }) {
  if (!holiday) return null;
  return (
    <Card style={{ flexDirection: 'row', gap: 10, backgroundColor: colors.dangerSoft, borderColor: 'rgba(244,63,94,0.3)' }}>
      <CalendarOff size={20} color={colors.danger} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="label" style={{ color: '#be123c' }}>
          HOLIDAY
        </T>
        <T v="strong">{holiday.reason}</T>
        <T v="small">
          {holiday.scope} · {fmtHolidayDates(holiday)}
        </T>
        {text ? <T v="small">{text}</T> : null}
      </View>
    </Card>
  );
}
