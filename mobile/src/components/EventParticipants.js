import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { Users } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorState, Input, Loading, T } from './ui';
import { errMsg, useGetParticipantsQuery, useMarkEventAttendanceMutation } from '../services/api';
import { dateKey } from '../utils/dates';
import { eventDays, statusOnDay } from '../utils/events';
import { fmtClassDay } from '../utils/format';

const TONE = { attended: 'success', absent: 'danger', pending: 'neutral', waitlisted: 'warning' };

/**
 * The event's participant list (same endpoints as the web). Faculty
 * coordinators and the hosting HOD mark each day: Present gives On Duty
 * credit for that day's classes; Absent marks those classes absent and
 * alerts the class in-charge. The server decides who may view and mark.
 */
export default function EventParticipants({ event }) {
  const days = useMemo(() => eventDays(event.startDate, event.endDate), [event.startDate, event.endDate]);
  const today = dateKey(new Date());
  const [day, setDay] = useState(days.includes(today) ? today : days[0]);
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);
  const { data = [], isLoading, error, refetch } = useGetParticipantsQuery(event._id);
  const [mark] = useMarkEventAttendanceMutation();
  const canMark = Boolean(event.canMarkAttendance);

  const needle = q.trim().toLowerCase();
  const rows = data.filter((r) => !needle || r.user?.name?.toLowerCase().includes(needle) || r.user?.rollNo?.toLowerCase().includes(needle));
  const counts = data.reduce((acc, r) => ({ ...acc, [statusOnDay(r, day)]: (acc[statusOnDay(r, day)] || 0) + 1 }), {});

  const setAttendance = (r, attended) => {
    const go = async (confirmOverwrite = false) => {
      setBusyId(r.user._id);
      try {
        await mark({ id: event._id, userId: r.user._id, attended, date: day, confirmOverwrite }).unwrap();
      } catch (e) {
        // Class attendance is already recorded for that day: the server asks
        // before replacing it (and tells the class in-charge).
        if (e?.status === 409 && e?.data?.requiresConfirmation && !confirmOverwrite) {
          Alert.alert('Replace recorded attendance?', `${errMsg(e)}\n\nThe class in-charge will be notified.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Replace', style: 'destructive', onPress: () => go(true) },
          ]);
        } else {
          Alert.alert('Could not update', errMsg(e));
        }
      } finally {
        setBusyId(null);
      }
    };
    if (attended) return go();
    Alert.alert('Mark absent?', `${r.user?.name} is marked absent for that day’s classes and their class in-charge is alerted.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark absent', style: 'destructive', onPress: go },
    ]);
  };

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Users size={18} color="#1d6feb" />
        <T v="h3" style={{ flex: 1 }}>
          Participants ({data.length})
        </T>
      </View>
      {days.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {days.map((d) => (
            <Chip key={d} label={fmtClassDay(d, 'EEE dd MMM')} active={day === d} onPress={() => setDay(d)} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Badge label={`Present ${counts.attended || 0}`} color="success" />
        <Badge label={`Absent ${counts.absent || 0}`} color="danger" />
        <Badge label={`Pending ${counts.pending || 0}`} color="neutral" />
        {counts.waitlisted ? <Badge label={`Waitlist ${counts.waitlisted}`} color="warning" /> : null}
      </View>
      <Input placeholder="Search name or roll no." value={q} onChangeText={setQ} autoCorrect={false} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !rows.length ? (
        <EmptyState icon={Users} title={needle ? 'No participants match' : 'No registrations yet'} />
      ) : (
        rows.map((r) => {
          const s = statusOnDay(r, day);
          return (
            <View key={r.user?._id} style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(31,111,235,0.14)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar user={r.user} size={32} />
                <View style={{ flex: 1 }}>
                  <T v="strong" numberOfLines={1}>{r.user?.name}</T>
                  <T v="small" numberOfLines={1}>
                    {r.user?.rollNo || '—'} · {r.user?.department || ''}
                    {r.user?.year ? ` · Y${r.user.year}` : ''}
                    {r.user?.section ? ` · Sec ${r.user.section}` : ''}
                  </T>
                </View>
                <Badge label={s} color={TONE[s]} />
              </View>
              {canMark && s !== 'waitlisted' ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Present" variant={s === 'attended' ? 'success' : 'outline'} small style={{ flex: 1 }} loading={busyId === r.user?._id} onPress={() => setAttendance(r, true)} />
                  <Button title="Absent" variant={s === 'absent' ? 'danger' : 'outline'} small style={{ flex: 1 }} disabled={busyId === r.user?._id} onPress={() => setAttendance(r, false)} />
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </Card>
  );
}
