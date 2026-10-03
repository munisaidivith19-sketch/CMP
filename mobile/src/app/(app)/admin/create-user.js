import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSelector } from 'react-redux';
import { UserPlus } from 'lucide-react-native';
import { Button, Card, Chip, EmptyState, Header, Input, Screen, T } from '../../../components/ui';
import { errMsg, useCreateAdminUserMutation } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { ACADEMIC_YEARS, DEPARTMENTS, ROLE_LABELS, SECTIONS, YEAR_LABELS, semestersOfYear } from '../../../theme';

/** Fields per account type — mirrors the server's CREATE_FIELDS and the web form. */
const FORMS = {
  student: ['name', 'rollNo', 'department', 'year', 'section', 'stayType', 'email', 'phone', 'parentPhone', 'password'],
  // Class In Charge = section + in-charge year + in-charge semester ("Our Class").
  faculty: ['name', 'employeeId', 'department', 'teachingYears', 'section', 'inChargeYear', 'inChargeSemester', 'email', 'phone', 'password'],
  hod: ['name', 'employeeId', 'department', 'email', 'phone', 'password'],
  principal: ['name', 'employeeId', 'email', 'phone', 'password'],
  security: ['name', 'employeeId', 'email', 'phone', 'password'],
};
const REQUIRED = new Set([
  'name', 'email', 'password', 'rollNo', 'year', 'section', 'department', 'stayType', 'parentPhone', 'employeeId', 'teachingYears',
  'inChargeYear', 'inChargeSemester',
]);
const isRequired = (k) => REQUIRED.has(k);
const EMPTY = {
  name: '', rollNo: '', year: '', department: '', section: '', stayType: '', email: '', phone: '', parentPhone: '', employeeId: '', password: '',
  teachingYears: [], inChargeYear: '', inChargeSemester: '',
};
const LABELS = {
  department: 'Department', year: 'Year', stayType: 'Stay',
  teachingYears: 'Year(s) handling',
  inChargeYear: 'In-charge year',
  inChargeSemester: 'In-charge semester',
};
const TEXT = {
  name: { label: 'Full name', autoCapitalize: 'words' },
  rollNo: { label: 'Roll number', autoCapitalize: 'characters' },
  employeeId: { label: 'Employee ID', autoCapitalize: 'characters' },
  email: { label: 'College email (username)', autoCapitalize: 'none', keyboardType: 'email-address', placeholder: 'name@jnn.edu.in' },
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
  const set = (k) => (val) =>
    setV((s) => {
      const next = { ...s, [k]: val };
      // The in-charge semester must belong to the in-charge year (year 3 → 5 or 6).
      if (k === 'inChargeYear' && !semestersOfYear(next.inChargeYear).includes(Number(next.inChargeSemester))) next.inChargeSemester = '';
      return next;
    });
  const toggle = (k, val, order) =>
    setV((s) => {
      const list = s[k].includes(val) ? s[k].filter((x) => x !== val) : [...s[k], val];
      return { ...s, [k]: order.filter((o) => list.includes(o)) };
    });
  const fields = FORMS[role];
  const missing = fields.filter((k) => isRequired(k) && (Array.isArray(v[k]) ? !v[k].length : !String(v[k]).trim()));

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
      if (Array.isArray(v[k])) {
        if (v[k].length) body[k] = v[k];
        return;
      }
      const val = String(v[k]).trim();
      if (val) body[k] = ['year', 'inChargeYear', 'inChargeSemester'].includes(k) ? Number(val) : ['section', 'rollNo', 'employeeId'].includes(k) ? val.toUpperCase() : val;
    });
    // Faculty's class in charge is also their (sole) section handled.
    if (role === 'faculty' && body.section) body.teachingSections = [body.section];
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

  // Single-select chips, or multi-select when v[k] is a list.
  const chips = (k, options, label = LABELS[k]) => {
    const multi = Array.isArray(v[k]);
    return (
      <View key={k} style={{ gap: 6 }}>
        <T v="label">
          {label}
          {isRequired(k) ? ' *' : ''}
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {options.length ? (
            options.map(([value, text]) => (
              <Chip
                key={value}
                label={text}
                active={multi ? v[k].includes(value) : v[k] === value}
                onPress={() => (multi ? toggle(k, value, options.map((o) => o[0])) : set(k)(v[k] === value && !isRequired(k) ? '' : value))}
              />
            ))
          ) : (
            <T v="small">Select a year first</T>
          )}
        </View>
        {errors[k] ? <T v="small" style={{ color: '#e11d48' }}>{errors[k]}</T> : null}
      </View>
    );
  };

  const field = (k) => {
    if (k === 'year') return chips(k, ACADEMIC_YEARS.map((y) => [String(y), YEAR_LABELS[y]]));
    if (k === 'section') return chips(k, SECTIONS.map((s) => [s, s]), role === 'faculty' ? 'Class in charge' : 'Section');
    if (k === 'teachingYears') return chips(k, ACADEMIC_YEARS.map((y) => [y, YEAR_LABELS[y]]));
    if (k === 'inChargeYear') return chips(k, ACADEMIC_YEARS.map((y) => [String(y), YEAR_LABELS[y]]));
    if (k === 'inChargeSemester') return chips(k, semestersOfYear(v.inChargeYear).map((sem) => [String(sem), `Semester ${sem}`]));
    if (k === 'department') return chips(k, DEPARTMENTS.map((d) => [d, d]));
    if (k === 'stayType') return chips(k, [['hosteler', 'Hosteler'], ['day_scholar', 'Day Scholar']]);
    const { label, ...props } = TEXT[k];
    return (
      <Input
        key={k}
        label={`${k === 'phone' && role === 'student' ? 'Student mobile' : label}${isRequired(k) ? ' *' : ''}`}
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
