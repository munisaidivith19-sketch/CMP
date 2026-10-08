import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useCreateAdminUserMutation } from '../services/api';
import { Button, cn } from './ui/primitives';
import { Modal } from './ui/Modal';
import { ChipMultiSelect, Input, Select } from './ui/form';
import RestrictionPopupModal from './RestrictionPopupModal';
import { ACADEMIC_YEARS, DEPARTMENTS, ROLE_LABELS, SECTIONS, STAY_TYPES, YEAR_LABELS, semestersOfYear } from '../utils/constants';
import { displayName, errMsg } from '../utils/format';

/** Fields the admin fills in per role — mirrors the server's CREATE_FIELDS. */
const FORMS = {
  student: ['title', 'gender', 'name', 'rollNo', 'department', 'year', 'section', 'stayType', 'email', 'phone', 'parentPhone', 'password'],
  // Class In Charge = section + in-charge year + in-charge semester ("Our Class").
  faculty: ['title', 'gender', 'name', 'employeeId', 'department', 'teachingYears', 'section', 'inChargeYear', 'inChargeSemester', 'email', 'phone', 'password'],
  hod: ['title', 'gender', 'name', 'employeeId', 'department', 'email', 'phone', 'password'],
  principal: ['title', 'gender', 'name', 'employeeId', 'email', 'phone', 'password'],
  security: ['title', 'gender', 'name', 'employeeId', 'email', 'phone', 'password'],
  dean: ['title', 'gender', 'name', 'employeeId', 'email', 'phone', 'password'],
  ao: ['title', 'gender', 'name', 'employeeId', 'email', 'phone', 'password'],
  chairman: ['title', 'gender', 'name', 'employeeId', 'email', 'phone', 'password'],
  warden: ['title', 'gender', 'name', 'employeeId', 'email', 'phone', 'password'],
};
const REQUIRED = new Set([
  'title', 'gender', 'name', 'email', 'password', 'rollNo', 'year', 'department', 'stayType', 'parentPhone', 'employeeId', 'teachingYears', 'section',
  'inChargeYear', 'inChargeSemester',
]);
const isRequired = (k, role) => REQUIRED.has(k);
const EMPTY = {
  title: '', gender: '', name: '', rollNo: '', year: '', department: '', section: '', stayType: '', email: '', phone: '', parentPhone: '', employeeId: '', password: '',
  teachingYears: [], inChargeYear: '', inChargeSemester: '',
};
const TITLES = [
  { value: 'Ms', label: 'Ms' },
  { value: 'Mr', label: 'Mr' },
  { value: 'Dr', label: 'Dr' },
];
const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];
const NUMERIC = new Set(['year', 'inChargeYear', 'inChargeSemester']);

function suggestPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const pick = (n, set) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => set[x % set.length]).join('');
  return `${pick(6, letters)}${pick(3, '23456789')}`;
}

export default function CreateUserModal({ open, onClose }) {
  const [role, setRole] = useState('student');
  const [v, setV] = useState(EMPTY);
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [restrictionPopup, setRestrictionPopup] = useState(null);
  const [create, { isLoading }] = useCreateAdminUserMutation();

  useEffect(() => {
    if (!open) {
      setV(EMPTY);
      setErrors({});
      setShow(false);
      setRestrictionPopup(null);
    }
  }, [open]);

  const fields = FORMS[role];
  const set = (k) => (e) =>
    setV((s) => {
      const next = { ...s, [k]: e.target.value };
      // Mr / Ms imply the gender; Dr leaves it to the admin.
      if (k === 'title' && next.title === 'Mr') next.gender = 'male';
      if (k === 'title' && next.title === 'Ms') next.gender = 'female';
      // The in-charge semester must belong to the in-charge year (year 3 → 5 or 6).
      if (k === 'inChargeYear' && !semestersOfYear(Number(next.inChargeYear)).includes(Number(next.inChargeSemester))) next.inChargeSemester = '';
      return next;
    });
  const setList = (k) => (list) => setV((s) => ({ ...s, [k]: list }));
  const missing = fields.filter((k) => isRequired(k, role) && (Array.isArray(v[k]) ? !v[k].length : !String(v[k]).trim()));

const normalizeDigits = (val) => {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
};

  const submit = async (e) => {
    e.preventDefault();

    // Verify student mobile and parent mobile are not identical
    if (v.phone && v.parentPhone) {
      const p1 = normalizeDigits(v.phone);
      const p2 = normalizeDigits(v.parentPhone);
      if (p1 && p2 && p1 === p2) {
        setRestrictionPopup({
          type: 'mobile',
          title: 'Identical Mobile Numbers Restricted',
          message: 'Student mobile number and parent mobile number cannot be the same. Institutional policy requires distinct contact numbers for student security and emergency verification.',
          detail: `Student Mobile: ${v.phone} | Parent Mobile: ${v.parentPhone}`,
        });
        setErrors((prev) => ({ ...prev, parentPhone: 'Cannot be same as student mobile number' }));
        return;
      }
    }

    const body = { role };
    fields.forEach((k) => {
      if (Array.isArray(v[k])) {
        if (v[k].length) body[k] = v[k];
        return;
      }
      const val = String(v[k]).trim();
      if (val) body[k] = NUMERIC.has(k) ? Number(val) : ['section', 'rollNo', 'employeeId'].includes(k) ? val.toUpperCase() : val;
    });
    // Faculty's class in charge is also their (sole) section handled.
    if (role === 'faculty' && body.section) body.teachingSections = [body.section];
    try {
      const user = await create(body).unwrap();
      toast.success(`${ROLE_LABELS[role]} login created for ${displayName(user)} — username: ${user.email}`, { duration: 6000 });
      // Keep the class details so the next student of the same class is quick to add.
      setV((s) => ({ ...EMPTY, ...(role === 'student' ? { department: s.department, year: s.year, section: s.section } : {}) }));
      setErrors({});
      setRestrictionPopup(null);
    } catch (err) {
      const list = err?.data?.errors;
      setErrors(Array.isArray(list) ? Object.fromEntries(list.map((x) => [x.field, x.message])) : {});
      const message = errMsg(err);
      const lower = message.toLowerCase();

      if (lower.includes('email') && (lower.includes('already exists') || lower.includes('in use') || err?.status === 409)) {
        setRestrictionPopup({
          type: 'email',
          title: 'Email Already in Use',
          message: `An account with the college email "${v.email}" is already registered. Duplicate login emails are strictly restricted.`,
          detail: `Conflicting Email: ${v.email}`,
        });
      } else if (
        (lower.includes('register number') || lower.includes('roll number') || lower.includes('rollno') || lower.includes('employee id')) &&
        (lower.includes('already in use') || lower.includes('already exists') || err?.status === 409)
      ) {
        const isEmployee = lower.includes('employee id');
        setRestrictionPopup({
          type: isEmployee ? 'general' : 'rollNo',
          title: isEmployee ? 'Employee ID Already in Use' : 'Register Number Already in Use',
          message: isEmployee
            ? `The employee ID "${v.employeeId}" is already assigned to another staff member. Duplicate employee IDs are strictly restricted.`
            : `The register number "${v.rollNo}" is already assigned to another student. Duplicate register numbers are strictly restricted.`,
          detail: isEmployee ? `Conflicting Employee ID: ${v.employeeId}` : `Conflicting Register Number: ${v.rollNo}`,
        });
      } else if (lower.includes('same') && (lower.includes('student mobile') || lower.includes('parent mobile'))) {
        setRestrictionPopup({
          type: 'mobile',
          title: 'Identical Mobile Numbers Restricted',
          message: 'Student mobile number and parent mobile number cannot be the same. Please provide distinct contact numbers.',
          detail: `Student Mobile: ${v.phone} | Parent Mobile: ${v.parentPhone}`,
        });
      } else {
        toast.error(message);
      }
    }
  };

  const field = (k) => {
    const common = { value: v[k], onChange: set(k), error: errors[k], required: isRequired(k, role) };
    switch (k) {
      case 'teachingYears':
        return (
          <ChipMultiSelect
            key={k}
            label="Year(s) handling"
            hint="Select every year this faculty teaches."
            options={ACADEMIC_YEARS.map((y) => ({ value: y, label: YEAR_LABELS[y] }))}
            value={v[k]}
            onChange={setList(k)}
            error={errors[k]}
          />
        );
      case 'title':
        return <Select key={k} label="Title" placeholder="Select title" options={TITLES} {...common} />;
      case 'gender':
        return <Select key={k} label="Gender" placeholder="Select gender" options={GENDERS} {...common} />;
      case 'name':
        return <Input key={k} label="Full name" maxLength={80} autoComplete="off" {...common} />;
      case 'rollNo':
        return <Input key={k} label="Roll number" maxLength={30} className="uppercase" {...common} />;
      case 'employeeId':
        return <Input key={k} label="Employee ID" maxLength={30} className="uppercase" {...common} />;
      case 'year':
        return <Select key={k} label="Year" placeholder="Select year" options={ACADEMIC_YEARS.map((y) => ({ value: String(y), label: YEAR_LABELS[y] }))} {...common} />;
      case 'department':
        return <Select key={k} label="Department" placeholder="Select department" options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} {...common} />;
      case 'section':
        return (
          <Select
            key={k}
            label={role === 'faculty' ? 'Class in charge' : 'Section'}
            placeholder="Select section"
            options={SECTIONS.map((s) => ({ value: s, label: s }))}
            {...common}
          />
        );
      case 'inChargeYear':
        return (
          <Select
            key={k}
            label="In-charge year"
            placeholder="Select year"
            hint="The year of the class this faculty is in charge of — not the years handled."
            options={ACADEMIC_YEARS.map((y) => ({ value: String(y), label: YEAR_LABELS[y] }))}
            {...common}
          />
        );
      case 'inChargeSemester':
        return (
          <Select
            key={k}
            label="In-charge semester"
            placeholder={v.inChargeYear ? 'Select semester' : 'Choose the in-charge year first'}
            disabled={!v.inChargeYear}
            options={(v.inChargeYear ? semestersOfYear(Number(v.inChargeYear)) : []).map((sem) => ({ value: String(sem), label: `Semester ${sem}` }))}
            {...common}
          />
        );
      case 'stayType':
        return <Select key={k} label="Stay" placeholder="Hosteler / Day Scholar" options={Object.entries(STAY_TYPES).map(([value, label]) => ({ value, label }))} {...common} />;
      case 'email':
        return <Input key={k} label="College email (username)" type="email" autoComplete="off" placeholder="name@college.edu" {...common} />;
      case 'phone':
        return <Input key={k} label={role === 'student' ? 'Student mobile' : 'Mobile'} type="tel" maxLength={20} {...common} />;
      case 'parentPhone':
        return <Input key={k} label="Parent mobile" type="tel" maxLength={20} {...common} />;
      case 'password':
        return (
          <div key={k} className="flex items-start gap-2 sm:col-span-2">
            <Input
              label="Set password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              hint="At least 8 characters with a letter and a number."
              className="flex-1"
              {...common}
            />
            <Button type="button" variant="ghost" className="mt-7" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="mt-7"
              icon={KeyRound}
              onClick={() => {
                setV((s) => ({ ...s, password: suggestPassword() }));
                setShow(true);
              }}
            >
              Generate
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title="Create login"
      subtitle="The college email is the username. Share the password with the user — they can change it after signing in."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" form="create-user-form" loading={isLoading} disabled={missing.length > 0}>
            Create {ROLE_LABELS[role]} login
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Account type">
        {Object.keys(FORMS).map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={role === r}
            className={cn('chip', role === r && 'chip-active')}
            onClick={() => {
              setRole(r);
              setErrors({});
            }}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>
      <form id="create-user-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2" autoComplete="off">
        {fields.map(field)}
      </form>
    </Modal>
    <RestrictionPopupModal
      open={Boolean(restrictionPopup)}
      onClose={() => setRestrictionPopup(null)}
      {...restrictionPopup}
    />
    </>
  );
}
