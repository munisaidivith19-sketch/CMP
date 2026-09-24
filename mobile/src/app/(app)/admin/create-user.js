import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSelector } from 'react-redux';
import { UserPlus } from 'lucide-react-native';
import { Button, Card, Chip, EmptyState, Header, Input, Screen, T } from '../../../components/ui';
import { errMsg, useCreateAdminUserMutation } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { DEPARTMENTS, ROLE_LABELS } from '../../../theme';

/** Fields per account type — mirrors the server's CREATE_FIELDS and the web form. */
const FORMS = {
  student: ['name', 'rollNo', 'year', 'department', 'section', 'stayType', 'email', 'phone', 'parentPhone', 'password'],
  faculty: ['name', 'employeeId', 'department', 'section', 'email', 'phone', 'password'],
  hod: ['name', 'employeeId', 'department', 'email', 'phone', 'password'],
  principal: ['name', 'employeeId', 'email', 'phone', 'password'],
};
const REQUIRED = new Set(['name', 'email', 'password', 'rollNo', 'year', 'department', 'stayType', 'parentPhone', 'employeeId']);
const EMPTY = { name: '', rollNo: '', year: '', department: '', section: '', stayType: '', email: '', phone: '', parentPhone: '', employeeId: '', password: '' };
const TEXT = {
  name: { label: 'Full name', autoCapitalize: 'words' },
  rollNo: { label: 'Roll number', autoCapitalize: 'characters' },
  employeeId: { label: 'Employee ID', autoCapitalize: 'characters' },
  section: { label: 'Section', autoCapitalize: 'characters', placeholder: 'e.g. A', maxLength: 10 },
  email: { label: 'College email (username)', autoCapitalize: 'none', keyboardType: 'email-address', placeholder: 'name@college.edu' },
  phone: { label: 'Mobile', keyboardType: 'phone-pad', maxLength: 20 },
  parentPhone: { label: 'Parent mobile', keyboardType: 'phone-pad', maxLength: 20 },
  password: { label: 'Set password', autoCapitalize: 'none', hint: 'At least 8 characters with a letter and a number' },
};

export default function CreateUser() {
  const me = useSelector(selectUser);
  const [role, setRole] = useState('student');
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [create, { isLoading }] = useCreateAdminUserMutation();
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }));
  const fields = FORMS[role];
  const missing = fields.filter((k) => REQUIRED.has(k) && !String(v[k]).trim());

  if (me.role !== 'admin') {
    return (
      <Screen>
        <Header back title="Create login" />
        <Card>
          <EmptyState title="Admins only" />
        </Card>
      </Screen>
    );
  }

  const submit = async () => {
    const body = { role };
    fields.forEach((k) => {
      const val = String(v[k]).trim();
      if (val) body[k] = k === 'year' ? Number(val) : ['section', 'rollNo', 'employeeId'].includes(k) ? val.toUpperCase() : val;
    });
    try {
      const user = await create(body).unwrap();
      Alert.alert('Login created', `${ROLE_LABELS[role]} ${user.name}\nUsername: ${user.email}`);
      // Keep class details so the next student of the same class is quick to add.
      setV((s) => ({ ...EMPTY, ...(role === 'student' ? { department: s.department, year: s.year, section: s.section } : {}) }));
      setErrors({});
    } catch (e) {
      const list = e?.data?.errors;
      setErrors(Array.isArray(list) ? Object.fromEntries(list.map((x) => [x.field, x.message])) : {});
      Alert.alert('Could not create login', errMsg(e));
    }
  };

  const chips = (k, options) => (
    <View key={k} style={{ gap: 6 }}>
      <T v="label">
        {k === 'stayType' ? 'Stay' : k === 'year' ? 'Year' : 'Department'}
        {REQUIRED.has(k) ? ' *' : ''}
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(([value, label]) => (
          <Chip key={value} label={label} active={v[k] === value} onPress={() => set(k)(value)} />
        ))}
      </View>
      {errors[k] ? <T v="small" style={{ color: '#e11d48' }}>{errors[k]}</T> : null}
    </View>
  );

  const field = (k) => {
    if (k === 'year') return chips(k, [1, 2, 3, 4, 5].map((y) => [String(y), `Year ${y}`]));
    if (k === 'department') return chips(k, DEPARTMENTS.map((d) => [d, d]));
    if (k === 'stayType') return chips(k, [['hosteler', 'Hosteler'], ['day_scholar', 'Day Scholar']]);
    const { label, ...props } = TEXT[k];
    return (
      <Input
        key={k}
        label={`${k === 'phone' && role === 'student' ? 'Student mobile' : label}${REQUIRED.has(k) ? ' *' : ''}`}
        value={v[k]}
        onChangeText={set(k)}
        error={errors[k]}
        autoCorrect={false}
        secureTextEntry={false}
        {...props}
      />
    );
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: 14 }}>
        <Header back title="Create login" subtitle="The college email is the username." />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Object.keys(FORMS).map((r) => (
            <Chip
              key={r}
              label={ROLE_LABELS[r]}
              active={role === r}
              onPress={() => {
                setRole(r);
                setErrors({});
              }}
            />
          ))}
        </View>
        <Card style={{ gap: 12 }}>{fields.map(field)}</Card>
        <Button title={`Create ${ROLE_LABELS[role]} login`} icon={UserPlus} onPress={submit} loading={isLoading} disabled={missing.length > 0} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
