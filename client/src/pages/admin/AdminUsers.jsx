import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Ban, CheckCircle2, Search, UserCog, UserPlus } from 'lucide-react';
import { useGetAdminUsersQuery, useUpdateAdminUserMutation } from '../../services/api';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, PageLoader, Pagination } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/form';
import { selectUser } from '../../features/authSlice';
import CreateUserModal from '../../components/CreateUserModal';
import { DEPARTMENTS, ROLES, ROLE_LABELS } from '../../utils/constants';
import { errMsg, fmtDate, timeAgo } from '../../utils/format';

/** Department / section / semester decide which timetable and attendance roster a student belongs to. */
function ClassModal({ user, onClose }) {
  const [update, { isLoading }] = useUpdateAdminUserMutation();
  const [v, setV] = useState({});
  useEffect(() => {
    if (user) setV({ department: user.department || '', year: user.year || '', section: user.section || '', semester: user.semester || '', rollNo: user.rollNo || '' });
  }, [user]);
  if (!user) return null;
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    try {
      await update({
        id: user._id,
        department: v.department || null,
        year: v.year ? Number(v.year) : undefined,
        section: v.section ? v.section.toUpperCase() : null,
        semester: v.semester ? Number(v.semester) : undefined,
        rollNo: v.rollNo || null,
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
      title={`Class details · ${user.name}`}
      subtitle="Used for the timetable and attendance roster."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Department" placeholder="—" options={[...new Set([user.department, ...DEPARTMENTS].filter(Boolean))]} value={v.department} onChange={set('department')} />
        <Input label="Roll number" maxLength={30} value={v.rollNo} onChange={set('rollNo')} />
        <Input label="Year" type="number" min={1} max={6} value={v.year} onChange={set('year')} />
        <Input label="Semester" type="number" min={1} max={12} value={v.semester} onChange={set('semester')} />
        <Input label="Section" maxLength={10} className="uppercase" placeholder="e.g. A" value={v.section} onChange={set('section')} />
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
  const [classEdit, setClassEdit] = useState(null);
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useGetAdminUsersQuery({ q: q || undefined, role: role || undefined, status: status || undefined, page });
  const [update, { isLoading: saving }] = useUpdateAdminUserMutation();

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
                        <button onClick={() => setClassEdit(u)} className="rounded-lg px-1.5 py-1 text-left hover:bg-white/70 hover:text-ink" title="Edit class details">
                          {u.department || '—'}
                          {u.year ? ` · Y${u.year}` : ''}
                          {u.section ? ` · Sec ${u.section}` : ''}
                          {u.semester ? ` · Sem ${u.semester}` : ''}
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
                        {!self &&
                          (u.isActive ? (
                            <Button size="sm" variant="danger" icon={Ban} onClick={() => setPending(u)}>
                              Suspend
                            </Button>
                          ) : (
                            <Button size="sm" variant="success" icon={CheckCircle2} onClick={() => apply(u._id, { isActive: true }, 'Account reactivated')}>
                              Reactivate
                            </Button>
                          ))}
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
    </div>
  );
}
