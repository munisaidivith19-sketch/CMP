import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, KeyRound, Lock, School, Search, UserPlus, Users } from 'lucide-react';
import { useCreateClassStudentMutation, useGetClassStudentsQuery } from '../../services/api';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/form';
import ResetPasswordModal, { suggestPassword } from '../../components/ResetPasswordModal';
import { STAY_TYPES, YEAR_LABELS } from '../../utils/constants';
import { errMsg, timeAgo } from '../../utils/format';

const EMPTY = { name: '', rollNo: '', email: '', phone: '', parentPhone: '', stayType: '', password: '' };
const REQUIRED = ['name', 'rollNo', 'email', 'parentPhone', 'stayType', 'password'];

/** Read-only field showing a value assigned from the faculty's Class In-Charge scope. */
function Locked({ label, value }) {
  return (
    <div>
      <p className="label">{label}</p>
      <div className="input flex cursor-not-allowed items-center justify-between gap-2 bg-white/40 text-ink-soft dark:bg-white/5" aria-readonly="true" aria-label={label}>
        <span className="truncate font-semibold">{value}</span>
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </div>
    </div>
  );
}

/**
 * Class In-Charge creates a student login. Department, year, section and
 * semester are shown locked: the server takes them from the faculty's own
 * account and refuses anything else, whatever this form sends.
 */
function CreateStudentModal({ open, scope, onClose }) {
  const [v, setV] = useState(EMPTY);
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [create, { isLoading }] = useCreateClassStudentMutation();

  useEffect(() => {
    if (!open) {
      setV(EMPTY);
      setErrors({});
      setShow(false);
    }
  }, [open]);

  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const missing = REQUIRED.some((k) => !String(v[k]).trim());

  const submit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, String(val).trim()]).filter(([, val]) => val));
    try {
      const user = await create(body).unwrap();
      toast.success(`Student login created for ${user.name} — username: ${user.email}`, { duration: 6000 });
      setV(EMPTY);
      setErrors({});
      setShow(false);
    } catch (err) {
      const list = err?.data?.errors;
      setErrors(Array.isArray(list) ? Object.fromEntries(list.map((x) => [x.field, x.message])) : {});
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Create student"
      subtitle="The college email is the username. Share the password with the student — they can change it after signing in."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" form="class-student-form" loading={isLoading} disabled={missing}>
            Create student login
          </Button>
        </>
      }
    >
      <div className="mb-4 rounded-2xl bg-primary-500/5 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-primary-700 dark:text-primary-300">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Assigned automatically from your Class In-Charge class
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Locked label="Department" value={scope.department} />
          <Locked label="Year" value={YEAR_LABELS[scope.year] || `Year ${scope.year}`} />
          <Locked label="Section" value={scope.section} />
          <Locked label="Semester" value={`Semester ${scope.semester}`} />
        </div>
      </div>
      <form id="class-student-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2" autoComplete="off">
        <Input label="Full name" maxLength={80} required value={v.name} onChange={set('name')} error={errors.name} />
        <Input label="Roll number" maxLength={30} className="uppercase" required value={v.rollNo} onChange={set('rollNo')} error={errors.rollNo} />
        <Input label="College email (username)" type="email" placeholder="name@jnn.edu.in" required value={v.email} onChange={set('email')} error={errors.email} />
        <Select
          label="Stay"
          placeholder="Hosteler / Day Scholar"
          required
          options={Object.entries(STAY_TYPES).map(([value, label]) => ({ value, label }))}
          value={v.stayType}
          onChange={set('stayType')}
          error={errors.stayType}
        />
        <Input label="Parent mobile" type="tel" maxLength={20} required hint="Gate-pass OTPs go only to this number." value={v.parentPhone} onChange={set('parentPhone')} error={errors.parentPhone} />
        <Input label="Student mobile" type="tel" maxLength={20} value={v.phone} onChange={set('phone')} error={errors.phone} />
        <div className="flex items-start gap-2 sm:col-span-2">
          <Input
            label="Set password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            hint="At least 8 characters with a letter and a number."
            className="min-w-0 flex-1"
            required
            value={v.password}
            onChange={set('password')}
            error={errors.password}
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
      </form>
    </Modal>
  );
}

/** Faculty → Students: the students of the class this faculty is Class In-Charge of. */
export default function ClassStudents() {
  const { data, isLoading, error, refetch } = useGetClassStudentsQuery();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [q, setQ] = useState('');

  if (isLoading) return <Skeleton className="h-64 rounded-[28px]" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const scope = data?.scope;
  if (!scope) {
    return (
      <div>
        <PageHeader icon={Users} title="Students" />
        <Card>
          <EmptyState
            icon={School}
            title="No class is currently assigned to you as Class In-Charge."
            text="Only a Class In-Charge can create student logins and reset student passwords. Your administrator sets your Class In-Charge department, section, year and semester."
          />
        </Card>
      </div>
    );
  }

  const needle = q.trim().toLowerCase();
  const items = needle
    ? data.items.filter((s) => [s.name, s.rollNo, s.email].some((x) => String(x || '').toLowerCase().includes(needle)))
    : data.items;

  return (
    <div>
      <PageHeader
        icon={Users}
        title="Students"
        subtitle={`${scope.department} · ${YEAR_LABELS[scope.year] || `Year ${scope.year}`} · Section ${scope.section} · Semester ${scope.semester}`}
        actions={
          <Button icon={UserPlus} onClick={() => setCreating(true)}>
            Create student
          </Button>
        }
      />
      <CreateStudentModal open={creating} scope={scope} onClose={() => setCreating(false)} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />

      <Card className="mb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, roll no, email…" className="input pl-11" aria-label="Search students" />
        </div>
      </Card>

      {!items.length ? (
        <Card>
          <EmptyState icon={Users} title={data.items.length ? 'No matching students' : 'No students in this class yet'} />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-5 py-4 font-bold">Student</th>
                  <th className="px-3 py-4 font-bold">Roll no</th>
                  <th className="px-3 py-4 font-bold">Status</th>
                  <th className="px-3 py-4 font-bold">Last login</th>
                  <th className="px-5 py-4 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/60 dark:divide-white/5">
                {items.map((s) => (
                  <tr key={s._id} className="table-row">
                    <td className="max-w-[240px] px-5 py-3">
                      <p className="truncate font-bold">{s.name}</p>
                      <p className="truncate text-xs muted">{s.email}</p>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{s.rollNo || '—'}</td>
                    <td className="px-3 py-3">{s.isActive ? <Badge color="success">active</Badge> : <Badge color="danger">suspended</Badge>}</td>
                    <td className="px-3 py-3 text-xs muted">{s.lastLogin ? timeAgo(s.lastLogin) : 'never'}</td>
                    <td className="px-5 py-3 text-right">
                      <Button size="sm" variant="outline" icon={KeyRound} onClick={() => setResetting(s)}>
                        Reset password
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
