import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { useSelector } from 'react-redux';
import { useCreateAdminUserMutation } from '../services/api';
import { useGetMyPoliciesQuery } from '../services/superAdmin';
import { selectUser } from '../features/authSlice';
import { STAFF_GRANT_ROLES, allowedRoles, creationPolicyAccess, grantedPages, policySummary } from '../utils/delegation';
import { Button, cn } from './ui/primitives';
import { ConfirmDialog, Modal } from './ui/Modal';
import PolicyEditor from './superadmin/PolicyEditor';
import { reportError, useReauth } from './superadmin/Reauth';
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
  // Controller of Examinations: exam timetables campus-wide, no department.
  coe: ['title', 'gender', 'name', 'employeeId', 'email', 'phone', 'password'],
  // Administrative Office: read-only college-wide attendance, no department.
  office: ['title', 'gender', 'name', 'employeeId', 'email', 'phone', 'password'],
  // Transport officer: buses, routes, rider assignments, trips.
  transport: ['title', 'gender', 'name', 'employeeId', 'email', 'phone', 'password'],
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
  const me = useSelector(selectUser);
  // Policy-managed admins see only the roles a Super Admin delegated to them
  // (the server refuses any other role regardless of what this shows).
  const { data: myPolicies } = useGetMyPoliciesQuery(undefined, { skip: !open || !['admin', 'super_admin', ...STAFF_GRANT_ROLES].includes(me?.role) });
  const creatable = Object.keys(FORMS).filter((r) => allowedRoles(myPolicies, 'create').includes(r));
  const hiddenRoles = Object.keys(FORMS).length - creatable.length;
  const [role, setRole] = useState('student');
  useEffect(() => {
    if (creatable.length && !creatable.includes(role)) setRole(creatable[0]);
  }, [creatable.join(','), role]); // eslint-disable-line react-hooks/exhaustive-deps
  const [v, setV] = useState(EMPTY);
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [restrictionPopup, setRestrictionPopup] = useState(null);
  const [create, { isLoading }] = useCreateAdminUserMutation();
  const { guard, modal: reauthModal } = useReauth();
  // Policy Assignment: 'none' (the role's access only) or 'custom' (additional policies).
  const [policyMode, setPolicyMode] = useState('none');
  const [policies, setPolicies] = useState([]);
  // A pending change that would discard the selected policies: { label, apply }.
  const [discard, setDiscard] = useState(null);
  const access = creationPolicyAccess(me?.role, myPolicies, role, v.department);
  const custom = policyMode === 'custom';

  useEffect(() => {
    if (!open) {
      setV(EMPTY);
      setErrors({});
      setShow(false);
      setRestrictionPopup(null);
      setPolicyMode('none');
      setPolicies([]);
      setDiscard(null);
    }
  }, [open]);

  // Ask before throwing away policy selections; never discard them silently.
  const confirmDiscard = (label, apply) => {
    if (custom && policies.length) setDiscard({ label, apply });
    else apply();
  };
  const chooseMode = (mode) => {
    if (mode === policyMode) return;
    if (mode === 'none') {
      confirmDiscard('Switching to No Additional Policies', () => {
        setPolicyMode('none');
        setPolicies([]);
      });
    } else setPolicyMode('custom');
  };
  const chooseRole = (r) => {
    const apply = () => {
      setRole(r);
      setErrors({});
      if (!STAFF_GRANT_ROLES.includes(r)) {
        setPolicyMode('none');
        setPolicies([]);
      }
    };
    // Every staff role takes the same additional-policy catalogue: selections carry over.
    if (STAFF_GRANT_ROLES.includes(r)) apply();
    else confirmDiscard(`Switching to ${ROLE_LABELS[r]}`, apply);
  };

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
  // "Add Policies" needs at least one permission the signed-in account may delegate here.
  const policyBlocked = custom && (!access.allowed || policies.length === 0);

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
    body.policyMode = custom ? 'custom' : 'none';
    if (custom) body.policies = policies;
    try {
      // A Super Admin adding policies confirms its password first (server: REAUTH_REQUIRED).
      const user = await guard(() => create(body).unwrap());
      const summary = custom ? policySummary(user.policies, access.catalogue) : [];
      toast.success(
        `${ROLE_LABELS[role]} login created for ${displayName(user)} — username: ${user.email}. ${summary.length ? `Additional policies: ${summary.join(' · ')}` : 'Role permissions only, no additional policies.'}`,
        { duration: 8000 }
      );
      // Keep the class details so the next student of the same class is quick to add.
      setV((s) => ({ ...EMPTY, ...(role === 'student' ? { department: s.department, year: s.year, section: s.section } : {}) }));
      setErrors({});
      setRestrictionPopup(null);
      setPolicyMode('none');
      setPolicies([]);
    } catch (err) {
      if (err?.cancelled) return; // the password prompt was cancelled: nothing was created
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
          <Button type="submit" form="create-user-form" loading={isLoading} disabled={missing.length > 0 || !creatable.includes(role) || policyBlocked}>
            Create {ROLE_LABELS[role]} login
          </Button>
        </>
      }
    >
      {creatable.length === 0 ? (
        <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm">You are not authorized to create any account type. A Super Admin must delegate roles to you first.</p>
      ) : hiddenRoles > 0 ? (
        <p className="mb-3 text-xs muted">Only the account types delegated to you are shown. Other roles require Super Admin authorization.</p>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Account type">
        {creatable.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={role === r}
            className={cn('chip', role === r && 'chip-active')}
            onClick={() => chooseRole(r)}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>
      <form id="create-user-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2" autoComplete="off">
        {fields.map(field)}
        <PolicyAssignment
          role={role}
          mode={policyMode}
          onMode={chooseMode}
          access={access}
          policies={policies}
          onPolicies={setPolicies}
          error={errors.policies || errors.policyMode}
        />
      </form>
    </Modal>
    <ConfirmDialog
      open={Boolean(discard)}
      onClose={() => setDiscard(null)}
      onConfirm={() => {
        discard?.apply();
        setDiscard(null);
      }}
      title="Discard selected policies?"
      text={`${discard?.label || 'This change'} discards the additional permissions you selected. The account will get its role's access only.`}
      confirmText="Discard policies"
    />
    {reauthModal}
    <RestrictionPopupModal
      open={Boolean(restrictionPopup)}
      onClose={() => setRestrictionPopup(null)}
      {...restrictionPopup}
    />
    </>
  );
}

const POLICY_OPTIONS = [
  { value: 'none', label: 'No Additional Policies', text: 'Use the existing dashboard access and permissions provided by the assigned role.' },
  { value: 'custom', label: 'Add Policies', text: 'Configure additional permissions for this user.' },
];

/**
 * Policy Assignment for the new account. "No Additional Policies" stores
 * nothing extra; "Add Policies" shows only what the signed-in account may
 * delegate to this account type. The server validates every grant again.
 */
function PolicyAssignment({ role, mode, onMode, access, policies, onPolicies, error }) {
  const custom = mode === 'custom';
  const roleLabel = ROLE_LABELS[role] || role;
  const summary = policySummary(policies, access.catalogue);
  const pages = grantedPages({ staffGrants: true, policies });
  return (
    <section className="space-y-3 sm:col-span-2" aria-labelledby="policy-assignment-title">
      <div>
        <h3 id="policy-assignment-title" className="text-sm font-extrabold">Policy Assignment</h3>
        {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
      </div>
      <div role="radiogroup" aria-labelledby="policy-assignment-title" className="grid gap-2 sm:grid-cols-2">
        {POLICY_OPTIONS.map((o) => {
          const disabled = o.value === 'custom' && !access.allowed;
          const selected = mode === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                'flex items-start gap-2.5 rounded-2xl border p-3 text-sm transition',
                selected ? 'border-primary-500 bg-primary-500/10' : 'border-white/60 dark:border-white/10',
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              )}
            >
              <input
                type="radio"
                name="policyMode"
                value={o.value}
                className="mt-0.5 h-4 w-4 accent-primary-600"
                checked={selected}
                disabled={disabled}
                onChange={() => onMode(o.value)}
              />
              <span>
                <span className="font-bold">{o.label}</span>
                <span className="block text-xs muted">{o.text}</span>
              </span>
            </label>
          );
        })}
      </div>
      {!access.allowed && <p className="text-xs muted">{access.reason}</p>}

      <div className="rounded-2xl bg-white/40 p-3 text-xs dark:bg-white/5">
        <p className="font-bold">Inherited from the {roleLabel} role</p>
        <p className="muted">
          The account gets the standard {roleLabel} dashboard and permissions. Role permissions are not copied onto the account, so
          later changes to the role still apply, and nothing chosen here removes them.
        </p>
      </div>

      {custom && access.allowed && (
        <>
          <div>
            <p className="mb-2 text-xs font-bold">Additional permissions for this user</p>
            <PolicyEditor catalogue={access.catalogue} value={policies} onChange={onPolicies} />
            <p className="mt-2 text-xs muted">
              Only permissions you may delegate are shown. Changing roles, managing staff accounts and assigning policies always stay with Admins
              and the Super Admin.
            </p>
          </div>
          <div className="rounded-2xl border border-primary-500/30 p-3 text-xs" aria-live="polite">
            <p className="mb-1 flex items-center gap-1.5 font-bold">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Effective permissions preview
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>Everything the {roleLabel} role allows (inherited)</li>
              {summary.length ? summary.map((line) => <li key={line}>Additional: {line}</li>) : <li className="muted">No additional permissions selected yet</li>}
              {pages.length > 0 && <li>Opens admin pages: {pages.join(', ')}</li>}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
