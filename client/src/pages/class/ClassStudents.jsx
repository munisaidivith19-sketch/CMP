import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, KeyRound, Lock, Pencil, School, Search, UserPlus, Users } from 'lucide-react';
import { useCreateClassStudentMutation, useGetClassStudentQuery, useGetClassStudentsQuery, useUpdateClassStudentMutation } from '../../services/api';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/form';
import ResetPasswordModal, { suggestPassword } from '../../components/ResetPasswordModal';
import { ACADEMIC_YEARS, SECTIONS, STAY_TYPES, YEAR_LABELS, semestersOfYear } from '../../utils/constants';
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

const EDIT_FIELDS = ['name', 'email', 'rollNo', 'phone', 'parentPhone', 'stayType', 'year', 'section', 'semester'];
const EDIT_REQUIRED = ['name', 'email', 'rollNo', 'parentPhone', 'stayType', 'year', 'section', 'semester'];
const formOf = (s) => Object.fromEntries(EDIT_FIELDS.map((k) => [k, s?.[k] == null ? '' : String(s[k])]));

/**
 * Class In-Charge edits a student of their own class. Department stays locked
 * (Admin only); year / section / semester can move the student to another
 * class, after which this faculty no longer manages them. The server checks
 * the class again on every save.
 */
function EditStudentModal({ studentId, scope, onClose }) {
  const { data: student, isFetching, error } = useGetClassStudentQuery(studentId, { skip: !studentId, refetchOnMountOrArgChange: true });
  const [save, { isLoading }] = useUpdateClassStudentMutation();
  const [v, setV] = useState(() => formOf(null));
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (student && studentId) {
      setV(formOf(student));
      setErrors({});
    }
  }, [student, studentId]);

  const set = (k) => (e) =>
    setV((s) => {
      const next = { ...s, [k]: e.target.value };
      // The semester must belong to the year.
      if (k === 'year' && !semestersOfYear(Number(e.target.value)).includes(Number(s.semester))) next.semester = '';
      return next;
    });
  const ready = Boolean(student) && !isFetching;
  const missing = EDIT_REQUIRED.some((k) => !String(v[k]).trim());
  const moves = ready && (Number(v.year) !== scope.year || v.section !== scope.section || Number(v.semester) !== scope.semester);

  const submit = async (e) => {
    e.preventDefault();
    // Only what changed is sent; the server re-checks everything anyway.
    const body = {};
    for (const k of EDIT_FIELDS) {
      const now = String(v[k]).trim();
      if (now === String(student[k] ?? '')) continue;
      body[k] = k === 'year' || k === 'semester' ? Number(now) : k === 'phone' ? now || null : now;
    }
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    try {
      const res = await save({ id: studentId, ...body }).unwrap();
      toast.success(res.movedOutOfClass ? `${res.name} moved to another class` : `Saved ${res.name}’s details`);
      onClose();
    } catch (err) {
      const list = err?.data?.errors;
      setErrors(Array.isArray(list) ? Object.fromEntries(list.map((x) => [x.field, x.message])) : {});
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal
      open={Boolean(studentId)}
      onClose={onClose}
      size="lg"
      title={`Edit student${student?.name ? ` · ${student.name}` : ''}`}
      subtitle="Changes are saved to the student’s account and recorded in Security & Logs."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="class-student-edit" loading={isLoading} disabled={!ready || missing}>
            Save
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorState error={error} />
      ) : !ready ? (
        <Skeleton className="h-64" />
      ) : (
        <form id="class-student-edit" onSubmit={submit} className="grid gap-3 sm:grid-cols-2" autoComplete="off">
          <Input label="Full name" maxLength={80} required value={v.name} onChange={set('name')} error={errors.name} />
          <Input label="Roll number" maxLength={30} className="uppercase" required value={v.rollNo} onChange={set('rollNo')} error={errors.rollNo} />
          <Input label="College email (username)" type="email" required hint="This is the student’s sign-in username." value={v.email} onChange={set('email')} error={errors.email} />
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

          <div className="sm:col-span-2">
            <Locked label="Department (set by Admin)" value={student.department} />
          </div>
          <Select
            label="Year"
            required
            options={ACADEMIC_YEARS.map((y) => ({ value: String(y), label: YEAR_LABELS[y] }))}
            value={v.year}
            onChange={set('year')}
            error={errors.year}
          />
          <Select label="Section" required options={SECTIONS} value={v.section} onChange={set('section')} error={errors.section} />
          <Select
            label="Semester"
            required
            placeholder="Select semester"
            options={semestersOfYear(Number(v.year)).map((n) => ({ value: String(n), label: `Semester ${n}` }))}
            value={v.semester}
            onChange={set('semester')}
            error={errors.semester}
          />
          {moves && (
            <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-semibold text-amber-800 dark:text-amber-300 sm:col-span-2">
              This moves the student out of your class. After saving, they will no longer appear here and you will not be able to edit them.
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}

/** Faculty → Students: the students of the class this faculty is Class In-Charge of. */
export default function ClassStudents() {
  const { data, isLoading, error, refetch } = useGetClassStudentsQuery();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [editing, setEditing] = useState(null);
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
      <EditStudentModal studentId={editing} scope={scope} onClose={() => setEditing(null)} />

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
            <table className="w-full min-w-[720px] text-sm">
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
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEditing(s._id)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" icon={KeyRound} onClick={() => setResetting(s)}>
                          Reset password
                        </Button>
                      </div>
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
