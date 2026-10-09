import { useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { useSelector } from 'react-redux';
import { AlertCircle, CalendarCheck, FileText, Plus, UserCheck } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorState, Header, Input, Loading, Screen, Segmented, StatusBadge, T } from '../../components/ui';
import DateField from '../../components/DateField';
import PickerField from '../../components/PickerField';
import AttachDocument from '../../components/AttachDocument';
import ReasonSheet from '../../components/ReasonSheet';
import {
  errMsg,
  useCancelODLeaveRequestMutation,
  useCreateODLeaveRequestMutation,
  useGetMyODLeaveRequestsQuery,
  useGetPendingODLeaveReviewsQuery,
  useReviewODLeaveRequestMutation,
} from '../../services/api';
import { assetUrl } from '../../config';
import { selectUser } from '../../store/authSlice';
import { STUDENT_ROLES, colors } from '../../theme';
import { dateKey, odLeaveCutoff } from '../../utils/dates';
import { displayName, fmtClassDay } from '../../utils/format';

const OD_CATEGORIES = [
  'Academic Conference / Seminar',
  'Paper Presentation',
  'Technical Symposium',
  'Sports Tournament / Meet',
  'Cultural Event / Fest',
  'Hackathon / Project Expo',
  'Industrial Visit / Workshop',
  'Official College Representation',
  'Other',
];
const LEAVE_CATEGORIES = ['Medical / Sick Leave', 'Personal / Family Reason', 'Out of Station', 'Family Function / Event', 'Emergency', 'Other'];
const REVIEW_ROLES = ['faculty', 'hod', 'principal', 'admin'];
const STATUS_LABEL = {
  pending_faculty: 'waiting: class in-charge',
  pending_hod: 'waiting: HOD',
  pending_principal: 'waiting: principal',
};
const label = (s) => STATUS_LABEL[s] || s;
const statusColor = { pending_faculty: 'pending', pending_hod: 'pending', pending_principal: 'pending' };
// Request days are calendar dates stored as UTC midnight.
const range = (r) => (String(r.fromDate).slice(0, 10) === String(r.toDate).slice(0, 10) ? fmtClassDay(r.fromDate) : `${fmtClassDay(r.fromDate)} → ${fmtClassDay(r.toDate)}`);
const STAGE_NAME = { faculty: 'class in-charge', hod: 'HOD', principal: 'principal' };
const days = (r) => `${r.daysCount} day${r.daysCount === 1 ? '' : 's'}`;

function TypeBadge({ type }) {
  return <Badge label={type === 'od' ? 'On Duty (OD)' : 'Leave'} color={type === 'od' ? 'info' : 'warning'} />;
}

function DocLink({ doc }) {
  if (!doc?.url) return null;
  return (
    <Pressable onPress={() => Linking.openURL(assetUrl(doc.url))} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <FileText size={14} color={colors.primary} />
      <T v="small" style={{ color: colors.primary }} numberOfLines={1}>
        {doc.name || 'Supporting document'}
      </T>
    </Pressable>
  );
}

/* ── Student: apply ─────────────────────────────────────────────── */
function ApplyForm({ onDone }) {
  const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  };
  const [type, setType] = useState('od');
  const [fromDate, setFromDate] = useState(tomorrow);
  const [toDate, setToDate] = useState(tomorrow);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [doc, setDoc] = useState(null);
  const [errors, setErrors] = useState({});
  const [create, { isLoading }] = useCreateODLeaveRequestMutation();
  const fromKey = dateKey(fromDate);
  const cutoff = odLeaveCutoff(fromKey);

  const submit = async () => {
    const e = {};
    if (!category) e.category = 'Select a category';
    if (description.trim().length < 5) e.description = 'At least 5 characters';
    if (dateKey(toDate) < fromKey) e.toDate = 'Cannot be before the start date';
    if (type === 'od' && !doc) e.doc = 'A supporting document is compulsory for On Duty';
    setErrors(e);
    if (Object.keys(e).length || cutoff?.type === 'danger') return;
    try {
      await create({ requestType: type, category, fromDate: fromKey, toDate: dateKey(toDate), description: description.trim(), ...(doc ? { document: doc } : {}) }).unwrap();
      Alert.alert('Request sent', 'Your class in-charge will review it first, then the HOD and the principal.');
      onDone();
    } catch (err) {
      Alert.alert('Could not submit', errMsg(err));
    }
  };

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="On Duty (OD)" active={type === 'od'} onPress={() => { setType('od'); setCategory(''); }} />
        <Chip label="Leave" active={type === 'leave'} onPress={() => { setType('leave'); setCategory(''); }} />
      </View>
      <T v="small">
        {type === 'od' ? 'Approved OD counts as Present for every period.' : 'Approved Leave marks scheduled periods Absent with an authorised Leave record.'} Goes Class In-Charge → HOD → Principal.
      </T>
      {cutoff ? (
        <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: 14, backgroundColor: cutoff.type === 'danger' ? colors.dangerSoft : colors.warningSoft }}>
          <AlertCircle size={16} color={cutoff.type === 'danger' ? colors.danger : '#b45309'} />
          <T v="small" style={{ flex: 1, color: cutoff.type === 'danger' ? '#be123c' : '#b45309' }}>
            {cutoff.message}
          </T>
        </View>
      ) : null}
      <DateField label="From date" value={fromDate} minimumDate={tomorrow()} onChange={(d) => { setFromDate(d); if (dateKey(toDate) < dateKey(d)) setToDate(d); }} />
      <DateField label="To date" value={toDate} minimumDate={fromDate} onChange={setToDate} error={errors.toDate} />
      <PickerField label="Category" value={category} onChange={setCategory} options={type === 'od' ? OD_CATEGORIES : LEAVE_CATEGORIES} placeholder="Select category" error={errors.category} />
      <Input label="Description" value={description} onChangeText={setDescription} multiline maxLength={1000} placeholder="Explain the reason" error={errors.description} />
      <AttachDocument label="Supporting document" value={doc} onChange={setDoc} required={type === 'od'} hint={errors.doc} />
      <Button title="Submit request" loading={isLoading} disabled={cutoff?.type === 'danger'} onPress={submit} />
    </Card>
  );
}

function StudentODLeave() {
  const [applying, setApplying] = useState(false);
  const [type, setType] = useState('');
  const { data, isLoading, isFetching, error, refetch } = useGetMyODLeaveRequestsQuery({ limit: 30, requestType: type || undefined }, { pollingInterval: 30000 });
  const [cancel, { isLoading: cancelling }] = useCancelODLeaveRequestMutation();

  const confirmCancel = (r) =>
    Alert.alert(
      'Cancel this request?',
      r.status === 'approved' ? 'Your OD attendance credit for these days will be removed.' : 'The request is withdrawn immediately.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Cancel request', style: 'destructive', onPress: () => cancel(r._id).unwrap().catch((e) => Alert.alert('Could not cancel', errMsg(e))) },
      ]
    );

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header back title="OD & Leave" subtitle="Apply in advance — before 5 PM the day before." right={!applying ? <Button small icon={Plus} title="Apply" onPress={() => setApplying(true)} /> : null} />
      {applying ? (
        <>
          <ApplyForm onDone={() => setApplying(false)} />
          <Button title="Close form" variant="ghost" onPress={() => setApplying(false)} />
        </>
      ) : null}
      <Segmented value={type} onChange={setType} options={[{ value: '', label: 'All' }, { value: 'od', label: 'OD' }, { value: 'leave', label: 'Leave' }]} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.requests.length ? (
        <Card>
          <EmptyState icon={CalendarCheck} title="No requests yet" text="Apply for On Duty or Leave and track every approval stage here." />
        </Card>
      ) : (
        data.requests.map((r) => {
          const canCancel = r.status.startsWith('pending_') || (r.status === 'approved' && r.requestType === 'od');
          return (
            <Card key={r._id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <TypeBadge type={r.requestType} />
                <StatusBadge status={statusColor[r.status] || r.status} label={label(r.status)} />
              </View>
              <T v="strong">{r.category}</T>
              <T v="small">
                {range(r)} · {days(r)}
              </T>
              <T v="small">“{r.description}”</T>
              <DocLink doc={r.document} />
              {r.status === 'rejected' && r.rejectedReason ? (
                <T v="small" style={{ color: colors.danger }}>
                  Rejected{r.rejectedStage ? ` by ${STAGE_NAME[r.rejectedStage] || r.rejectedStage}` : ''}: “{r.rejectedReason}”
                </T>
              ) : null}
              {canCancel ? <Button title="Cancel request" variant="danger" small loading={cancelling} onPress={() => confirmCancel(r)} style={{ alignSelf: 'flex-start' }} /> : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

/* ── Reviewers: class in-charge → HOD → principal (admin can act at any stage) ── */
const MY_STAGE = { faculty: 'pending_faculty', hod: 'pending_hod', principal: 'pending_principal' };

function ReviewQueue() {
  const me = useSelector(selectUser);
  const [status, setStatus] = useState(MY_STAGE[me.role] || '');
  const [rejecting, setRejecting] = useState(null);
  const { data, isLoading, isFetching, error, refetch } = useGetPendingODLeaveReviewsQuery({ limit: 30, status: status || undefined }, { pollingInterval: 30000 });
  const [review, { isLoading: saving }] = useReviewODLeaveRequestMutation();
  const isPrincipal = ['principal', 'admin'].includes(me.role);

  const act = async (r, action, reason) => {
    try {
      await review({ id: r._id, action, ...(reason ? { reason } : {}) }).unwrap();
      setRejecting(null);
      Alert.alert(action === 'reject' ? 'Rejected' : action === 'approve' ? 'Approved' : 'Forwarded', action === 'approve' ? 'Attendance has been updated for these days.' : undefined);
    } catch (e) {
      Alert.alert('Could not update', errMsg(e));
    }
  };

  const canAct = (r) => (me.role === 'admin' ? r.status.startsWith('pending_') : r.status === MY_STAGE[me.role]);

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header back title="OD & Leave" subtitle={me.role === 'faculty' ? 'Requests from your class' : me.role === 'hod' ? 'Forwarded by class in-charges' : 'Final approval'} />
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          ...(MY_STAGE[me.role] ? [{ value: MY_STAGE[me.role], label: 'To review' }] : []),
          { value: '', label: 'All' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
        ]}
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.requests.length ? (
        <Card>
          <EmptyState icon={UserCheck} title="Nothing here" text="New requests appear here as students send them." />
        </Card>
      ) : (
        data.requests.map((r) => (
          <Card key={r._id} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar user={r.student} size={40} />
              <View style={{ flex: 1 }}>
                <T v="strong" numberOfLines={1}>
                  {displayName(r.student)}
                </T>
                <T v="small" numberOfLines={1}>
                  {r.student?.rollNo || '—'} · {r.department} · Y{r.year} · Sec {r.section}
                </T>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <TypeBadge type={r.requestType} />
              <StatusBadge status={statusColor[r.status] || r.status} label={label(r.status)} />
            </View>
            <T v="strong">{r.category}</T>
            <T v="small">
              {range(r)} · {days(r)}
            </T>
            <T v="small">“{r.description}”</T>
            <DocLink doc={r.document} />
            {canAct(r) ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {isPrincipal ? (
                  <Button title="Approve" variant="success" small style={{ flex: 1 }} loading={saving} onPress={() => act(r, 'approve')} />
                ) : (
                  <Button title={me.role === 'faculty' ? 'Forward to HOD' : 'Forward to Principal'} small style={{ flex: 1 }} loading={saving} onPress={() => act(r, 'forward')} />
                )}
                <Button title="Reject" variant="danger" small style={{ flex: 1 }} onPress={() => setRejecting(r)} />
              </View>
            ) : null}
          </Card>
        ))
      )}
      <ReasonSheet
        open={Boolean(rejecting)}
        title="Reject request"
        subtitle={rejecting ? displayName(rejecting.student) : ''}
        label="Reason (shared with the student)"
        confirmText="Reject"
        minLength={3}
        maxLength={500}
        loading={saving}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => act(rejecting, 'reject', reason)}
      />
    </Screen>
  );
}

export default function ODLeave() {
  const me = useSelector(selectUser);
  if (STUDENT_ROLES.includes(me.role)) return <StudentODLeave />;
  if (REVIEW_ROLES.includes(me.role)) return <ReviewQueue />;
  return (
    <Screen>
      <Header back title="OD & Leave" />
      <Card>
        <EmptyState icon={UserCheck} title="Not available for your role" />
      </Card>
    </Screen>
  );
}
