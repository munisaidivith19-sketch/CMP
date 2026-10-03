import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Ban, CheckCircle2, Search, Trash2, UserCog, UserPlus } from 'lucide-react';
import { useDeleteAdminUserMutation, useGetAdminUsersQuery, useUpdateAdminUserMutation } from '../../services/api';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, PageLoader, Pagination } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { ChipMultiSelect, Input, Select } from '../../components/ui/form';
import { selectUser } from '../../features/authSlice';
import CreateUserModal from '../../components/CreateUserModal';
import { ACADEMIC_YEARS, DEPARTMENTS, ROLES, ROLE_LABELS, SECTIONS, YEAR_LABELS, semestersOfYear } from '../../utils/constants';
import { errMsg, fmtDate, timeAgo } from '../../utils/format';

/** Department / section / semester decide which timetable and attendance roster a student belongs to. */
function ClassModal({ user, onClose }) {
  const [update, { isLoading }] = useUpdateAdminUserMutation();
  const [v, setV] = useState({});
  useEffect(() => {
    if (user) {
      setV({
        department: user.department || '', year: user.year || '', section: user.section || '', semester: user.semester || '', rollNo: user.rollNo || '',
        teachingYears: user.teachingYears || [], teachingSections: user.teachingSections || [],
        inChargeYear: user.inChargeYear || '', inChargeSemester: user.inChargeSemester || '',
      });
    }
  }, [user]);
  if (!user) return null;
  const isFaculty = user.role === 'faculty';
  const set = (k) => (e) =>
    setV((s) => {
      const next = { ...s, [k]: e.target.value };
      if (k === 'year' && s.semester && !semestersOfYear(e.target.value).includes(Number(s.semester))) next.semester = '';
      // The in-charge semester must belong to the in-charge year.
      if (k === 'inChargeYear' && !semestersOfYear(Number(e.target.value)).includes(Number(s.inChargeSemester))) next.inChargeSemester = '';
      return next;
    });
  const save = async () => {
    try {
      await update({
        id: user._id,
        department: v.department || null,
        section: v.section ? v.section.toUpperCase() : null,
        // A faculty's class in charge is also their (sole) section handled.
        ...(isFaculty
          ? {
              teachingYears: v.teachingYears,
              teachingSections: v.section ? [v.section.toUpperCase()] : [],
              // "Our Class": section + in-charge year + in-charge semester. Clearing
              // the section clears the in-charge class with it.
              inChargeYear: v.section && v.inChargeYear ? Number(v.inChargeYear) : null,
              inChargeSemester: v.section && v.inChargeSemester ? Number(v.inChargeSemester) : null,
            }
          : { year: v.year ? Number(v.year) : undefined, semester: v.semester ? Number(v.semester) : undefined, rollNo: v.rollNo || null }),
      }).unwrap();
      toast.success('Class details saved');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${isFaculty ? 'Teaching scope' : 'Class details'} · ${user.name}`}
      subtitle={isFaculty ? 'Bounds which classes this faculty can be scheduled for in the timetable.' : 'Department, year, section and semester decide the timetable and attendance roster.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={isLoading}
            onClick={save}
            disabled={isFaculty && (!v.teachingYears?.length || !v.section || !v.inChargeYear !== !v.inChargeSemester)}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Department" placeholder="—" keepCase options={[...new Set([user.department, ...DEPARTMENTS].filter(Boolean))]} value={v.department} onChange={set('department')} />
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
        ) : (
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
        )}
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
  const { data, isLoading } = useGetAdminUsersQuery({ q: q || undefined, role: role || undefined, status: status || undefined, page });
  const [update, { isLoading: saving }] = useUpdateAdminUserMutation();
  const [removeUser, { isLoading: deletingSaving }] = useDeleteAdminUserMutation();

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
          <Button icon={UserPlus} onClick={() => setCreating(true)}>
            Create login
          </Button>
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
            <table className="w-full min-w-[760px] text-sm">
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
                            <p className="truncate font-bold">{u.name}</p>
                            <p className="truncate text-xs muted">
                              {u.email}
                              {u.rollNo || u.employeeId ? ` · ${u.rollNo || u.employeeId}` : ''}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-xs muted">
                        <button onClick={() => setClassEdit(u)} className="rounded-lg px-1.5 py-1 text-left hover:bg-white/70 hover:text-ink" title={u.role === 'faculty' ? 'Edit teaching scope' : 'Edit class details'}>
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
      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={`Suspend ${pending?.name}?`}
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
        title={`Delete ${deleting?.name}?`}
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
