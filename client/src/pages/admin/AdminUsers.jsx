import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Ban, CheckCircle2, Download, KeyRound, Pencil, Search, Trash2, UserCog, UserPlus } from 'lucide-react';
import { useDeleteAdminUserMutation, useGetAdminUsersQuery, useUpdateAdminUserMutation } from '../../services/api';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, PageLoader, Pagination } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { ChipMultiSelect, Input, Select } from '../../components/ui/form';
import { selectUser } from '../../features/authSlice';
import CreateUserModal from '../../components/CreateUserModal';
import ResetPasswordModal from '../../components/ResetPasswordModal';
import { ACADEMIC_YEARS, DEPARTMENTS, ROLES, ROLE_LABELS, SECTIONS, STAY_TYPES, STUDENT_ROLES, YEAR_LABELS, semestersOfYear } from '../../utils/constants';
import { errMsg, fmtDate, timeAgo, displayName } from '../../utils/format';
import { downloadProfilesPdf } from '../../services/reports';

const TITLE_OPTIONS = ['Ms', 'Mr', 'Dr'].map((t) => ({ value: t, label: t }));
const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

/** The form's values for a user; every text field is a string, never undefined. */
const classFormValues = (user) => ({
  department: user?.department || '', year: user?.year || '', section: user?.section || '', semester: user?.semester || '', rollNo: user?.rollNo || '',
  title: user?.title || '', gender: user?.gender || '', employeeId: user?.employeeId || '',
  name: user?.name || '', email: user?.email || '', phone: user?.phone || '', parentPhone: user?.parentPhone || '', stayType: user?.stayType || '',
  teachingYears: user?.teachingYears || [], teachingSections: user?.teachingSections || [],
  inChargeYear: user?.inChargeYear || '', inChargeSemester: user?.inChargeSemester || '',
});

/**
 * Admin "Edit user": the account details (title, gender, name, email, mobile)
 * for every role, plus only the academic fields that role actually has — a
 * student's class, a faculty's teaching scope, an HOD's department.
 */
function ClassModal({ user, onClose }) {
  const [update, { isLoading }] = useUpdateAdminUserMutation();
  // Filled from the user on the very first render: the Save button reads
  // v.name / v.email immediately, so an empty first render crashed the page.
  const [v, setV] = useState(() => classFormValues(user));
  useEffect(() => {
    if (user) setV(classFormValues(user));
  }, [user]);
  if (!user) return null;
  const isFaculty = user.role === 'faculty';
  const isStudent = STUDENT_ROLES.includes(user.role);
  const isHod = user.role === 'hod';
  const isStaff = !isStudent;
  const set = (k) => (e) =>
    setV((s) => {
      const next = { ...s, [k]: e.target.value };
      // Mr / Ms imply the gender; Dr leaves it to the admin.
      if (k === 'title' && next.title === 'Mr') next.gender = 'male';
      if (k === 'title' && next.title === 'Ms') next.gender = 'female';
      if (k === 'year' && s.semester && !semestersOfYear(e.target.value).includes(Number(s.semester))) next.semester = '';
      // The in-charge semester must belong to the in-charge year.
      if (k === 'inChargeYear' && !semestersOfYear(Number(e.target.value)).includes(Number(s.inChargeSemester))) next.inChargeSemester = '';
      return next;
    });
  const save = async () => {
    try {
      await update({
        id: user._id,
        // Account details — every role.
        name: v.name.trim(),
        email: v.email.trim(),
        phone: v.phone.trim() || null,
        ...(v.title ? { title: v.title } : {}),
        ...(v.gender ? { gender: v.gender } : {}),
        ...(isStaff ? { employeeId: v.employeeId.trim().toUpperCase() || null } : {}),
        // Academic placement — only the fields this role actually has.
        ...(isStudent
          ? {
              department: v.department || null,
              section: v.section ? v.section.toUpperCase() : null,
              year: v.year ? Number(v.year) : undefined,
              semester: v.semester ? Number(v.semester) : undefined,
              rollNo: v.rollNo || null,
              parentPhone: v.parentPhone.trim() || null,
              ...(v.stayType ? { stayType: v.stayType } : {}),
            }
          : {}),
        ...(isFaculty
          ? {
              department: v.department || null,
              section: v.section ? v.section.toUpperCase() : null,
              teachingYears: v.teachingYears,
              // A faculty's class in charge is also their (sole) section handled.
              teachingSections: v.section ? [v.section.toUpperCase()] : [],
              // "Our Class": section + in-charge year + in-charge semester. Clearing
              // the section clears the in-charge class with it.
              inChargeYear: v.section && v.inChargeYear ? Number(v.inChargeYear) : null,
              inChargeSemester: v.section && v.inChargeSemester ? Number(v.inChargeSemester) : null,
            }
          : {}),
        ...(isHod ? { department: v.department || null } : {}),
      }).unwrap();
      toast.success('User details saved');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Edit ${ROLE_LABELS[user.role] || 'user'} · ${displayName(user)}`}
      subtitle={
        isFaculty
          ? 'Account details, and the classes this faculty can be scheduled for in the timetable.'
          : isStudent
            ? 'Account details, and the class that decides the timetable and attendance roster.'
            : 'Account details for this login.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={isLoading}
            onClick={save}
            disabled={!v.name.trim() || !v.email.trim() || (isFaculty && (!v.teachingYears?.length || !v.section || !v.inChargeYear !== !v.inChargeSemester))}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <p className="text-xs font-bold uppercase tracking-wide muted sm:col-span-2">Account</p>
        <Select label="Title" placeholder="Select title" options={TITLE_OPTIONS} value={v.title} onChange={set('title')} />
        <Select label="Gender" placeholder="Select gender" options={GENDER_OPTIONS} value={v.gender} onChange={set('gender')} />
        <Input label="Full name" maxLength={80} value={v.name} onChange={set('name')} />
        <Input label="College email (username)" type="email" value={v.email} onChange={set('email')} />
        <Input label={isStudent ? 'Student mobile' : 'Mobile'} type="tel" maxLength={20} value={v.phone} onChange={set('phone')} />
        {isStaff && <Input label="Employee ID" maxLength={30} className="uppercase" value={v.employeeId} onChange={set('employeeId')} />}
        {isStudent && (
          <>
            <Input label="Parent mobile" type="tel" maxLength={20} hint="Gate-pass OTPs go only to this number." value={v.parentPhone} onChange={set('parentPhone')} />
            <Select label="Stay" placeholder="—" options={Object.entries(STAY_TYPES).map(([value, label]) => ({ value, label }))} value={v.stayType} onChange={set('stayType')} />
          </>
        )}
        {(isStudent || isFaculty || isHod) && (
          <>
            <p className="mt-2 text-xs font-bold uppercase tracking-wide muted sm:col-span-2">{isFaculty ? 'Teaching scope' : isHod ? 'Department' : 'Class'}</p>
            <Select label="Department" placeholder="—" keepCase options={[...new Set([user.department, ...DEPARTMENTS].filter(Boolean))]} value={v.department} onChange={set('department')} />
          </>
        )}
        {isFaculty ? (
          <>
            <Select label="Class in charge" placeholder="Select section" options={SECTIONS} value={v.section} onChange={set('section')} />
            <Select
              label="In-charge year"
              placeholder="—"
              disabled={!v.section}
              options={ACADEMIC_YEARS.map((y) => ({ value: String(y), label: YEAR_LABELS[y] }))}
              value={String(v.inChargeYear || '')}
              onChange={set('inChargeYear')}
            />
            <Select
              label="In-charge semester"
              placeholder={v.inChargeYear ? '—' : 'Select in-charge year first'}
              disabled={!v.section || !v.inChargeYear}
              options={(v.inChargeYear ? semestersOfYear(Number(v.inChargeYear)) : []).map((sem) => ({ value: String(sem), label: `Semester ${sem}` }))}
              value={String(v.inChargeSemester || '')}
              onChange={set('inChargeSemester')}
            />
            <ChipMultiSelect
              className="sm:col-span-2"
              label="Year(s) handling"
              options={ACADEMIC_YEARS.map((y) => ({ value: y, label: YEAR_LABELS[y] }))}
              value={v.teachingYears || []}
              onChange={(list) => setV((s) => ({ ...s, teachingYears: list }))}
            />
          </>
        ) : isStudent ? (
          <>
            <Input label="Roll number" maxLength={30} value={v.rollNo} onChange={set('rollNo')} />
            <Select label="Year" placeholder="—" options={ACADEMIC_YEARS.map((y) => ({ value: String(y), label: YEAR_LABELS[y] }))} value={String(v.year || '')} onChange={set('year')} />
            <Select label="Section" placeholder="—" options={SECTIONS} value={v.section} onChange={set('section')} />
            <Select
              label="Semester"
              placeholder={v.year ? '—' : 'Select year first'}
              disabled={!v.year}
              options={semestersOfYear(v.year).map((s) => ({ value: String(s), label: `Semester ${s}` }))}
              value={String(v.semester || '')}
              onChange={set('semester')}
            />
          </>
        ) : null}
      </div>
    </Modal>
  );
}

export default function AdminUsers() {
  const me = useSelector(selectUser);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [classEdit, setClassEdit] = useState(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const { data, isLoading } = useGetAdminUsersQuery({ q: q || undefined, role: role || undefined, status: status || undefined, page });
  const [update, { isLoading: saving }] = useUpdateAdminUserMutation();
  const [removeUser, { isLoading: deletingSaving }] = useDeleteAdminUserMutation();

  const handleExportPdf = async () => {
    setDownloading(true);
    try {
      const filename = await downloadProfilesPdf();
      toast.success(`Downloaded ${filename}`);
    } catch (e) {
      toast.error(e?.message || errMsg(e));
    } finally {
      setDownloading(false);
    }
  };

  const apply = async (id, body, msg) => {
    try {
      await update({ id, ...body }).unwrap();
      toast.success(msg);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div>
      <PageHeader
        icon={UserCog}
        title="User management"
        subtitle="Create logins for students, faculty, HODs and the principal; assign roles and suspend or reactivate accounts."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={Download} loading={downloading} onClick={handleExportPdf}>
              Export Directory (PDF)
            </Button>
            <Button icon={UserPlus} onClick={() => setCreating(true)}>
              Create login
            </Button>
          </div>
        }
      />
      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      <Card className="mb-6 grid gap-3 md:grid-cols-[1fr_180px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, email, roll no…"
            className="input pl-11"
          />
        </div>
        <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="input">
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </Card>

      {isLoading ? (
        <PageLoader />
      ) : !data?.items?.length ? (
        <Card>
          <EmptyState icon={UserCog} title="No users found" />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-5 py-4 font-bold">User</th>
                  <th className="px-3 py-4 font-bold">Department</th>
                  <th className="px-3 py-4 font-bold">Role</th>
                  <th className="px-3 py-4 font-bold">Status</th>
                  <th className="px-3 py-4 font-bold">Last login</th>
                  <th className="px-5 py-4 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/60 dark:divide-white/5">
                {data.items.map((u) => {
                  const self = u._id === me._id;
                  return (
                    <tr key={u._id} className="table-row">
                      <td className="px-5 py-3">
                        <Link to={`/people/${u._id}`} className="flex items-center gap-3">
                          <Avatar user={u} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-bold">{displayName(u)}</p>
                            <p className="truncate text-xs muted">
                              {u.email}
                              {u.rollNo || u.employeeId ? ` · ${u.rollNo || u.employeeId}` : ''}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-xs muted">
                        <button onClick={() => setClassEdit(u)} disabled={self} className="rounded-lg px-1.5 py-1 text-left hover:bg-white/70 hover:text-ink" title={self ? undefined : 'Edit user'}>
                          {u.department || '—'}
                          {u.role === 'faculty' ? (
                            <>
                              {u.teachingYears?.length ? ` · Y${u.teachingYears.join('/')}` : ''}
                              {u.teachingSections?.length ? ` · Sec ${u.teachingSections.join('/')}` : ''}
                              {!u.teachingYears?.length && <span className="ml-1 font-semibold text-amber-600">· scope not set</span>}
                              {u.section && u.inChargeYear ? ` · In-charge Y${u.inChargeYear} ${u.section} Sem ${u.inChargeSemester}` : ''}
                              {u.section && !u.inChargeYear && <span className="ml-1 font-semibold text-amber-600">· in-charge year/semester not set</span>}
                            </>
                          ) : (
                            <>
                              {u.year ? ` · Y${u.year}` : ''}
                              {u.section ? ` · Sec ${u.section}` : ''}
                              {u.semester ? ` · Sem ${u.semester}` : ''}
                              {['student', 'club_admin'].includes(u.role) && (!u.year || !u.section || !u.semester) && (
                                <span className="ml-1 font-semibold text-amber-600">· incomplete</span>
                              )}
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={u.role}
                          disabled={self || saving}
                          onChange={(e) => apply(u._id, { role: e.target.value }, `Role changed to ${ROLE_LABELS[e.target.value]}`)}
                          className="input w-auto rounded-xl py-1.5 text-xs"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3">{u.isActive ? <Badge color="success">active</Badge> : <Badge color="danger">suspended</Badge>}</td>
                      <td className="px-3 py-3 text-xs muted" title={u.lastLogin ? fmtDate(u.lastLogin) : ''}>
                        {u.lastLogin ? timeAgo(u.lastLogin) : 'never'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {!self && (
                          <div className="inline-flex items-center gap-2">
                            <Button size="sm" variant="outline" icon={Pencil} onClick={() => setClassEdit(u)}>
                              Edit
                            </Button>
                            {u.role !== 'admin' && (
                              <Button size="sm" variant="outline" icon={KeyRound} onClick={() => setResetting(u)}>
                                Reset password
                              </Button>
                            )}
                            {u.isActive ? (
                              <Button size="sm" variant="danger" icon={Ban} onClick={() => setPending(u)}>
                                Suspend
                              </Button>
                            ) : (
                              <Button size="sm" variant="success" icon={CheckCircle2} onClick={() => apply(u._id, { isActive: true }, 'Account reactivated')}>
                                Reactivate
                              </Button>
                            )}
                            <Button size="sm" variant="danger" icon={Trash2} onClick={() => setDeleting(u)}>
                              Delete
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pb-5">
            <Pagination page={data.page} pages={data.pages} onChange={setPage} />
          </div>
        </Card>
      )}

      <ClassModal user={classEdit} onClose={() => setClassEdit(null)} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={`Suspend ${displayName(pending)}?`}
        text="They will be signed out immediately and cannot sign in until reactivated."
        confirmText="Suspend account"
        loading={saving}
        onConfirm={async () => {
          await apply(pending._id, { isActive: false }, 'Account suspended');
          setPending(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${displayName(deleting)}?`}
        text="This permanently removes the account from the database. This cannot be undone."
        confirmText="Delete permanently"
        loading={deletingSaving}
        onConfirm={async () => {
          try {
            await removeUser(deleting._id).unwrap();
            toast.success('Account deleted');
          } catch (e) {
            toast.error(errMsg(e));
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}
