import { useState } from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { useSelector } from 'react-redux';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ClipboardCheck, XCircle } from 'lucide-react-native';
import StaffAttendance from '../../components/StaffAttendance';
import { Button, Card, EmptyState, ErrorState, Header, Input, Loading, PercentRing, ProgressBar, Screen, Segmented, SectionTitle, StatusBadge, T } from '../../components/ui';
import { errMsg, useGetAttendanceRecordsQuery, useGetCorrectionsQuery, useGetMyAttendanceQuery, useRequestCorrectionMutation } from '../../services/api';
import { selectUser } from '../../store/authSlice';
import { STUDENT_ROLES, colors, fonts, radius, shadow } from '../../theme';
import { fmtClassDay } from '../../utils/format';

const RANGES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'semester', label: 'Semester' },
  { value: 'all', label: 'All' },
];

// Recent-classes filter. The server applies `status` inside the student's own scope.
const STATUS_FILTERS = [
  { value: 'all', label: 'All classes' },
  { value: 'absent', label: 'Absent' },
  { value: 'present', label: 'Present' },
];

/** Compact dropdown: shows the current choice, opens a small menu of options. */
function FilterDropdown({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) || options[0];
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Filter: ${current.label}`}
        hitSlop={6}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.primary50 : colors.surfaceStrong })}
      >
        <T v="small" style={{ fontFamily: fonts.bold, color: colors.primary600 }}>{current.label}</T>
        <ChevronDown size={14} color={colors.primary600} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(27,29,58,0.25)', justifyContent: 'center', padding: 32 }} onPress={() => setOpen(false)}>
          <View style={[{ backgroundColor: '#fff', borderRadius: radius.lg, paddingVertical: 6 }, shadow]}>
            <T v="label" style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 }}>Show</T>
            {options.map((o) => {
              const active = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 13, backgroundColor: pressed ? colors.primary50 : 'transparent' })}
                >
                  <T v="body" style={{ flex: 1, fontFamily: active ? fonts.bold : fonts.regular, color: active ? colors.primary600 : colors.ink }}>{o.label}</T>
                  {active ? <Check size={18} color={colors.primary600} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function CorrectionSheet({ record, onClose }) {
  const [reason, setReason] = useState('');
  const [send, { isLoading }] = useRequestCorrectionMutation();
  if (!record) return null;
  const requested = record.status === 'present' ? 'absent' : 'present';
  const submit = async () => {
    try {
      await send({ subjectId: record.subject._id, date: String(record.date).slice(0, 10), period: record.period, requestedStatus: requested, reason: reason.trim() }).unwrap();
      Alert.alert('Request sent', 'Your faculty will review it. You’ll get a notification.');
      onClose();
    } catch (e) {
      Alert.alert('Could not send', errMsg(e));
    }
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(27,29,58,0.35)' }} onPress={onClose} />
      <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 }}>
        <T v="h2">Request a correction</T>
        <T v="small">
          {record.subject?.code} · {fmtClassDay(record.date)} · Period {record.period} — marked {record.status}, asking for {requested}.
        </T>
        <Input label="Reason" value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="Explain what happened" hint="At least 5 characters" />
        <Button title="Send request" onPress={submit} loading={isLoading} disabled={reason.trim().length < 5} />
        <Button title="Cancel" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

export default function Attendance() {
  const me = useSelector(selectUser);
  return STUDENT_ROLES.includes(me.role) ? <StudentAttendance /> : <StaffAttendance />;
}

function StudentAttendance() {
  const [range, setRange] = useState('semester');
  const [correct, setCorrect] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const summary = useGetMyAttendanceQuery({ range });
  const records = useGetAttendanceRecordsQuery(statusFilter === 'all' ? { limit: 30 } : { limit: 30, status: statusFilter });
  const corrections = useGetCorrectionsQuery({ limit: 10 });

  const { data, isLoading, error, refetch, isFetching } = summary;
  const o = data?.overall;
  const low = o && o.totalPeriods > 0 && o.percentage < data.threshold;

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={() => [summary, records, corrections].forEach((q) => !q.isUninitialized && q.refetch())}>
      <Header back title="Attendance" subtitle="Present ÷ conducted periods" />
      <Segmented value={range} onChange={setRange} options={RANGES} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          {low ? (
            <Card style={{ flexDirection: 'row', gap: 10, backgroundColor: colors.dangerSoft, borderColor: 'rgba(244,63,94,0.3)' }}>
              <AlertTriangle size={20} color={colors.danger} />
              <T v="small" style={{ flex: 1, color: '#be123c' }}>
                Below {data.threshold}%. Attend the next {o.mustAttend} class{o.mustAttend === 1 ? '' : 'es'} to recover.
              </T>
            </Card>
          ) : null}
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <PercentRing value={o.percentage} threshold={data.threshold} sub={`${o.presentPeriods}/${o.totalPeriods}`} />
            <View style={{ flex: 1, gap: 8 }}>
              <T v="small">Present: <T v="strong">{o.presentPeriods}</T></T>
              <T v="small">Absent: <T v="strong">{o.absentPeriods}</T></T>
              <T v="small">Conducted: <T v="strong">{o.totalPeriods}</T></T>
              <T v="small">{low ? 'Must attend' : 'Can still miss'}: <T v="strong">{low ? o.mustAttend : o.canMiss}</T></T>
            </View>
          </Card>

          <SectionTitle title="Subject-wise" />
          {data.subjects.length ? (
            <Card style={{ gap: 14 }}>
              {data.subjects.map((s) => (
                <View key={s._id} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <T v="strong" numberOfLines={1} style={{ flex: 1 }}>
                      {s.subject.code} · {s.subject.name}
                    </T>
                    <T v="strong">{s.percentage}%</T>
                  </View>
                  <ProgressBar value={s.percentage} threshold={data.threshold} />
                  <T v="small">
                    {s.presentPeriods}/{s.totalPeriods} periods
                  </T>
                </View>
              ))}
            </Card>
          ) : (
            <Card>
              <EmptyState icon={ClipboardCheck} title="No classes recorded in this period" />
            </Card>
          )}
        </>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <T v="h3">{statusFilter === 'absent' ? 'Absent classes' : statusFilter === 'present' ? 'Present classes' : 'Recent classes'}</T>
        <FilterDropdown value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTERS} />
      </View>
      {records.isLoading || (records.isFetching && !records.data) ? (
        <Loading />
      ) : records.error ? (
        <ErrorState error={records.error} onRetry={records.refetch} />
      ) : records.data?.records?.length ? (
        <Card style={{ gap: 2 }} padded={false}>
          {records.data.records.map((r) => (
            <Pressable key={r._id} onLongPress={() => setCorrect(r)} onPress={() => setCorrect(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11 }}>
              {r.status === 'present' ? <CheckCircle2 size={18} color={colors.success} /> : <XCircle size={18} color={colors.danger} />}
              <View style={{ flex: 1 }}>
                <T v="strong" numberOfLines={1}>
                  {r.subject?.code} · {r.subject?.name}
                </T>
                <T v="small">
                  {fmtClassDay(r.date)} · P{r.period}
                  {r.correctedAt ? ' · corrected' : ''}
                </T>
              </View>
              <StatusBadge status={r.status} />
            </Pressable>
          ))}
          <T v="small" style={{ padding: 12, textAlign: 'center', color: colors.muted }}>
            Tap a class to request a correction
          </T>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={statusFilter === 'absent' ? CheckCircle2 : ClipboardCheck}
            title={statusFilter === 'absent' ? 'No absences' : statusFilter === 'present' ? 'No classes marked present' : 'No attendance yet'}
            text={statusFilter === 'absent' ? 'You haven’t missed any recorded class.' : undefined}
          />
        </Card>
      )}

      {corrections.data?.requests?.length ? (
        <>
          <SectionTitle title="My correction requests" />
          {corrections.data.requests.map((c) => (
            <Card key={c._id} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T v="strong">
                  {c.subject?.code} · {fmtClassDay(c.date)} · P{c.period}
                </T>
                <StatusBadge status={c.status} />
              </View>
              <T v="small">“{c.reason}”</T>
              {c.reviewNote ? <T v="small">Reviewer: {c.reviewNote}</T> : null}
            </Card>
          ))}
        </>
      ) : null}
      <CorrectionSheet record={correct} onClose={() => setCorrect(null)} />
    </Screen>
  );
}
