import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import { useSelector } from 'react-redux';
import { KeyRound, Pencil, Plus, Users } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorState, Header, Input, Loading, Screen, T } from '../../../components/ui';
import { errMsg, useCreateClassStudentMutation, useGetClassStudentQuery, useGetClassStudentsQuery, useResetUserPasswordMutation, useUpdateClassStudentMutation } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { colors } from '../../../theme';
import { displayName } from '../../../utils/format';

/** Faculty Class In-Charge only: the class always comes from the account (server-enforced). */
const isClassInCharge = (u) => u?.role === 'faculty' && Boolean(u.section && u.inChargeYear && u.inChargeSemester);
const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const strongEnough = (p) => p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);

function Sheet({ open, title, onClose, children }) {
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 56, gap: 12 }} keyboardShouldPersistTaps="handled">
          <T v="h2">{title}</T>
          {children}
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Choice({ label, options, value, onChange }) {
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{label}</T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {options.map(([v, l]) => (
          <Chip key={v} label={l} active={value === v} onPress={() => onChange(v)} />
        ))}
      </View>
    </View>
  );
}

const EMPTY = { name: '', email: '', rollNo: '', password: '', title: '', gender: '', stayType: '', parentPhone: '', phone: '' };

function AddStudent({ open, onClose }) {
  const [f, setF] = useState(EMPTY);
  const [create, { isLoading }] = useCreateClassStudentMutation();
  useEffect(() => {
    if (open) setF(EMPTY);
  }, [open]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setTitle = (t) => setF((x) => ({ ...x, title: t, gender: t === 'Mr' ? 'male' : 'female' }));

  const submit = async () => {
    const problem =
      f.name.trim().length < 2 ? 'Enter the student’s name' :
      !/^\S+@\S+\.\S+$/.test(f.email.trim()) ? 'Enter a valid college email' :
      !f.rollNo.trim() ? 'Roll number is required' :
      !strongEnough(f.password) ? 'Password: 8–72 characters with a letter and a number' :
      !f.title || !f.gender ? 'Choose Mr or Ms' :
      !f.stayType ? 'Select hosteler or day scholar' :
      digits10(f.parentPhone).length !== 10 ? "Parent's mobile must be 10 digits" :
      f.phone && digits10(f.phone).length !== 10 ? 'Student mobile must be 10 digits' :
      f.phone && digits10(f.phone) === digits10(f.parentPhone) ? 'Student mobile number and parent mobile number cannot be the same' : null;
    if (problem) return Alert.alert('Check the form', problem);
    try {
      await create({
        name: f.name.trim(),
        email: f.email.trim(),
        rollNo: f.rollNo.trim(),
        password: f.password,
        title: f.title,
        gender: f.gender,
        stayType: f.stayType,
        parentPhone: f.parentPhone,
        ...(f.phone ? { phone: f.phone } : {}),
      }).unwrap();
      Alert.alert('Student added', 'Share the password with the student — they can change it after signing in.');
      onClose();
    } catch (e) {
      Alert.alert('Could not add student', errMsg(e));
    }
  };

  return (
    <Sheet open={open} title="Add a student" onClose={onClose}>
      <Choice label="Title" options={[['Mr', 'Mr'], ['Ms', 'Ms']]} value={f.title} onChange={setTitle} />
      <Input label="Full name" value={f.name} onChangeText={set('name')} maxLength={80} />
      <Input label="College email" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" />
      <Input label="Roll number" value={f.rollNo} onChangeText={set('rollNo')} autoCapitalize="characters" maxLength={30} />
      <Input label="Password" value={f.password} onChangeText={set('password')} secureTextEntry autoCapitalize="none" hint="8+ characters with a letter and a number" />
      <Choice label="Stay" options={[['hosteler', 'Hosteler'], ['day_scholar', 'Day scholar']]} value={f.stayType} onChange={set('stayType')} />
      <Input label="Parent's mobile" value={f.parentPhone} onChangeText={set('parentPhone')} keyboardType="phone-pad" maxLength={14} hint="Gate pass OTPs go to this number" />
      <Input label="Student mobile (optional)" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={14} />
      <Button title="Add student" icon={Plus} loading={isLoading} onPress={submit} />
    </Sheet>
  );
}

function EditStudent({ student, onClose }) {
  const [stayType, setStayType] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [phone, setPhone] = useState('');
  const [update, { isLoading }] = useUpdateClassStudentMutation();
  // The class list carries no phone numbers; load them for this one student before editing.
  const { data: detail, isFetching, error } = useGetClassStudentQuery(student?._id, { skip: !student });
  useEffect(() => {
    if (!detail) return;
    setStayType(detail.stayType || '');
    setParentPhone(detail.parentPhone || '');
    setPhone(detail.phone || '');
  }, [detail]);
  const ready = Boolean(detail) && !isFetching;
  const save = async () => {
    if (digits10(parentPhone).length !== 10) return Alert.alert("Parent's mobile must be 10 digits");
    if (phone && digits10(phone).length !== 10) return Alert.alert('Student mobile must be 10 digits');
    if (phone && digits10(phone) === digits10(parentPhone)) return Alert.alert('Student mobile number and parent mobile number cannot be the same');
    try {
      await update({ id: student._id, parentPhone, phone: phone || '', ...(stayType ? { stayType } : {}) }).unwrap();
      onClose();
    } catch (e) {
      Alert.alert('Could not save', errMsg(e));
    }
  };
  return (
    <Sheet open={Boolean(student)} title={student ? `Edit ${displayName(student)}` : ''} onClose={onClose}>
      <Choice label="Stay" options={[['hosteler', 'Hosteler'], ['day_scholar', 'Day scholar']]} value={stayType} onChange={setStayType} />
      <Input label="Parent's mobile" value={parentPhone} onChangeText={setParentPhone} keyboardType="phone-pad" maxLength={14} />
      <Input label="Student mobile (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} hint="Leave empty to clear it" />
      {error ? <ErrorState error={error} /> : null}
      <Button title="Save" loading={isLoading || !ready} disabled={!ready} onPress={save} />
    </Sheet>
  );
}

function ResetPassword({ student, onClose }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reset, { isLoading }] = useResetUserPasswordMutation();
  useEffect(() => {
    setPw('');
    setConfirm('');
  }, [student]);
  const submit = async () => {
    if (!strongEnough(pw)) return Alert.alert('Password: 8–72 characters with a letter and a number');
    if (pw !== confirm) return Alert.alert('Passwords do not match');
    try {
      await reset({ id: student._id, newPassword: pw, confirmPassword: confirm }).unwrap();
      Alert.alert('Password reset', 'The student is signed out of every device and must use the new password.');
      onClose();
    } catch (e) {
      Alert.alert('Could not reset', errMsg(e));
    }
  };
  return (
    <Sheet open={Boolean(student)} title={student ? `Reset password · ${displayName(student)}` : ''} onClose={onClose}>
      <Input label="New password" value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" />
      <Input label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" />
      <Button title="Reset password" icon={KeyRound} variant="danger" loading={isLoading} onPress={submit} />
    </Sheet>
  );
}

export default function ClassStudents() {
  const me = useSelector(selectUser);
  const allowed = isClassInCharge(me);
  const { data, isLoading, isFetching, error, refetch } = useGetClassStudentsQuery(undefined, { skip: !allowed });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [q, setQ] = useState('');

  if (!allowed) {
    return (
      <Screen>
        <Header back title="My class" />
        <Card>
          <EmptyState icon={Users} title="For Class In-Charge faculty only" text="Ask the administrator to assign you a class." />
        </Card>
      </Screen>
    );
  }

  const needle = q.trim().toLowerCase();
  const items = (data?.items || []).filter((s) => !needle || s.name?.toLowerCase().includes(needle) || s.rollNo?.toLowerCase().includes(needle));
  const scope = data?.scope;

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header
        back
        title="My class"
        subtitle={scope ? `${scope.department} · Year ${scope.year} · Sec ${scope.section} · Sem ${scope.semester}` : 'Students of your class'}
        right={<Button small icon={Plus} title="Add" onPress={() => setAdding(true)} />}
      />
      <Input placeholder="Search name or roll no." value={q} onChangeText={setQ} autoCorrect={false} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !items.length ? (
        <Card>
          <EmptyState icon={Users} title={needle ? 'No students match' : 'No students yet'} text={needle ? undefined : 'Add your class’s student logins here.'} />
        </Card>
      ) : (
        <>
          <T v="small">{items.length} student{items.length === 1 ? '' : 's'}</T>
          {items.map((s) => (
            <Card key={s._id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar user={s} size={38} />
                <View style={{ flex: 1 }}>
                  <T v="strong" numberOfLines={1}>{displayName(s)}</T>
                  <T v="small" numberOfLines={1}>
                    {s.rollNo || '—'} · {s.email}
                  </T>
                </View>
                {s.stayType ? <Badge label={s.stayType === 'hosteler' ? 'Hosteler' : 'Day scholar'} color={s.stayType === 'hosteler' ? 'info' : 'neutral'} /> : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Edit" icon={Pencil} variant="soft" small style={{ flex: 1 }} onPress={() => setEditing(s)} />
                <Button title="Reset password" icon={KeyRound} variant="outline" small style={{ flex: 1 }} onPress={() => setResetting(s)} />
              </View>
            </Card>
          ))}
        </>
      )}
      <AddStudent open={adding} onClose={() => setAdding(false)} />
      <EditStudent student={editing} onClose={() => setEditing(null)} />
      <ResetPassword student={resetting} onClose={() => setResetting(null)} />
    </Screen>
  );
}
