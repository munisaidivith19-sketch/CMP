import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useCreateAdminUserMutation } from '../services/api';
import { Button, cn } from './ui/primitives';
import { Modal } from './ui/Modal';
import { Input, Select } from './ui/form';
import { DEPARTMENTS, ROLE_LABELS, STAY_TYPES } from '../utils/constants';
import { errMsg } from '../utils/format';

/** Fields the admin fills in per role — mirrors the server's CREATE_FIELDS. */
const FORMS = {
  student: ['name', 'rollNo', 'year', 'department', 'section', 'stayType', 'email', 'phone', 'parentPhone', 'password'],
  faculty: ['name', 'employeeId', 'department', 'section', 'email', 'phone', 'password'],
  hod: ['name', 'employeeId', 'department', 'email', 'phone', 'password'],
  principal: ['name', 'employeeId', 'email', 'phone', 'password'],
  security: ['name', 'employeeId', 'email', 'phone', 'password'],
};
const REQUIRED = new Set(['name', 'email', 'password', 'rollNo', 'year', 'department', 'stayType', 'parentPhone', 'employeeId']);
const EMPTY = { name: '', rollNo: '', year: '', department: '', section: '', stayType: '', email: '', phone: '', parentPhone: '', employeeId: '', password: '' };

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
  const [create, { isLoading }] = useCreateAdminUserMutation();

  useEffect(() => {
    if (!open) {
      setV(EMPTY);
      setErrors({});
      setShow(false);
    }
  }, [open]);

  const fields = FORMS[role];
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const missing = fields.filter((k) => REQUIRED.has(k) && !String(v[k]).trim());

  const submit = async (e) => {
    e.preventDefault();
    const body = { role };
    fields.forEach((k) => {
      const val = String(v[k]).trim();
      if (val) body[k] = k === 'year' ? Number(val) : ['section', 'rollNo', 'employeeId'].includes(k) ? val.toUpperCase() : val;
    });
    try {
      const user = await create(body).unwrap();
      toast.success(`${ROLE_LABELS[role]} login created for ${user.name} — username: ${user.email}`, { duration: 6000 });
      // Keep the class details so the next student of the same class is quick to add.
      setV((s) => ({ ...EMPTY, ...(role === 'student' ? { department: s.department, year: s.year, section: s.section } : {}) }));
      setErrors({});
    } catch (err) {
      const list = err?.data?.errors;
      setErrors(Array.isArray(list) ? Object.fromEntries(list.map((x) => [x.field, x.message])) : {});
      toast.error(errMsg(err));
    }
  };

  const field = (k) => {
    const common = { value: v[k], onChange: set(k), error: errors[k], required: REQUIRED.has(k) };
    switch (k) {
      case 'name':
        return <Input key={k} label="Full name" maxLength={80} autoComplete="off" {...common} />;
      case 'rollNo':
        return <Input key={k} label="Roll number" maxLength={30} className="uppercase" {...common} />;
      case 'employeeId':
        return <Input key={k} label="Employee ID" maxLength={30} className="uppercase" {...common} />;
      case 'year':
        return <Select key={k} label="Year" placeholder="Select year" options={[1, 2, 3, 4, 5].map((y) => ({ value: String(y), label: `Year ${y}` }))} {...common} />;
      case 'department':
        return <Select key={k} label="Department" placeholder="Select department" options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} {...common} />;
      case 'section':
        return <Input key={k} label={role === 'faculty' ? 'Section (class in charge)' : 'Section'} maxLength={10} placeholder="e.g. A" className="uppercase" {...common} />;
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
  );
}
