import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, LogOut, Pencil, Search, ShieldAlert, ShieldCheck, Trash2, UserMinus, UserPlus } from 'lucide-react';
import {
  useAddChatMembersMutation,
  useDeleteGroupMutation,
  useGetUsersQuery,
  useLeaveConversationMutation,
  useToggleGroupAdminMutation,
  useUpdateGroupMutation,
} from '../../services/api';
import { Avatar, Badge, Button, Skeleton, cn } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/form';
import { ROLE_LABELS, YEAR_LABELS } from '../../utils/constants';
import { errMsg, displayName } from '../../utils/format';

const sameId = (a, b) => String(a?._id || a) === String(b?._id || b);
const CATEGORY_LABEL = { custom: 'Custom', academic: 'Academics', faculty: 'Faculty' };

/**
 * Group details. The group admin (its creator / designated group admins) can
 * rename it, add and remove members, manage group admin roles, and delete it;
 * everyone else sees the members and can leave.
 */
export default function GroupInfoModal({ open, onClose, conv, me }) {
  const navigate = useNavigate();
  const isAdmin = me.role === 'admin' || (conv?.admins || []).some((a) => sameId(a, me)) || sameId(conv?.createdBy, me);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [update, { isLoading: renaming }] = useUpdateGroupMutation();
  const [add, { isLoading: adding }] = useAddChatMembersMutation();
  const [removeMember] = useLeaveConversationMutation();
  const [toggleAdmin, { isLoading: togglingAdmin }] = useToggleGroupAdminMutation();
  const [del, { isLoading: deleting }] = useDeleteGroupMutation();
  // An HOD group adds only what its type allows: students for Custom /
  // Academics, faculty for Faculty. (The server enforces it either way.)
  const addRole = conv?.category === 'faculty' ? undefined : conv?.category ? 'student' : undefined;
  const { data: found, isFetching } = useGetUsersQuery(
    { q: q || undefined, limit: 20, context: 'picker', ...(addRole ? { role: addRole } : {}) },
    { skip: !open || !isAdmin || q.trim().length < 2 }
  );

  useEffect(() => {
    if (open) {
      setName(conv?.name || '');
      setQ('');
    }
  }, [open, conv?.name]);

  const members = conv?.participants || [];
  const candidates = useMemo(
    () =>
      (found?.items || []).filter(
        (u) =>
          !members.some((m) => sameId(m, u)) &&
          (conv?.category !== 'faculty' || ['faculty', 'hod'].includes(u.role)) &&
          (conv?.category !== 'academic' || (u.year === conv.linkedYear && u.section === conv.linkedSection))
      ),
    [found, members, conv]
  );

  const run = async (fn, ok) => {
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!conv) return null;
  const leave = () =>
    run(async () => {
      await removeMember({ id: conv._id, userId: me._id }).unwrap();
      onClose();
      navigate('/chat');
    }, 'You left the group');

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={conv.name}
        subtitle={[
          conv.category && `${CATEGORY_LABEL[conv.category]} group`,
          conv.linkedYear && `${YEAR_LABELS[conv.linkedYear]} · Section ${conv.linkedSection}`,
          `${members.length} members`,
        ]
          .filter(Boolean)
          .join(' · ')}
        footer={
          isAdmin ? (
            <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
              Delete group
            </Button>
          ) : (
            <Button variant="ghost" icon={LogOut} onClick={leave}>
              Leave group
            </Button>
          )
        }
      >
        {isAdmin && (
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Input label="Group name" className="min-w-0 flex-1" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            <Button
              variant="outline"
              icon={Pencil}
              loading={renaming}
              disabled={name.trim().length < 2 || name.trim() === conv.name}
              onClick={() => run(() => update({ id: conv._id, name: name.trim() }).unwrap(), 'Group renamed')}
            >
              Rename
            </Button>
          </div>
        )}

        {isAdmin && (
          <div className="mb-4">
            <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people to add" />
            {q.trim().length >= 2 && (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {isFetching && !candidates.length && <Skeleton className="h-12" />}
                {!isFetching && !candidates.length && <p className="py-2 text-center text-sm muted">No one to add for “{q}”.</p>}
                {candidates.map((u) => (
                  <div key={u._id} className="flex items-center gap-3 rounded-xl p-2">
                    <Avatar user={u} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{displayName(u)}</span>
                      <span className="block truncate text-xs muted">
                        {ROLE_LABELS[u.role]}
                        {u.department ? ` · ${u.department}` : ''}
                        {u.section ? ` · Sec ${u.section}` : ''}
                      </span>
                    </span>
                    <Button size="sm" variant="soft" icon={UserPlus} loading={adding} onClick={() => run(() => add({ id: conv._id, userIds: [u._id] }).unwrap(), `${displayName(u)} added`)}>
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!isAdmin && (
          <div className="mb-4 rounded-xl border border-sky-500/20 bg-sky-50/50 p-2.5 text-xs text-sky-700 dark:border-sky-500/10 dark:bg-sky-500/5 dark:text-sky-300">
            Only group admins can add or remove members.
          </div>
        )}

        <p className="label">Members</p>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {members.map((m) => {
            const groupAdmin = (conv.admins || []).some((a) => sameId(a, m)) || sameId(conv.createdBy, m);
            return (
              <li key={m._id} className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                <Avatar user={m} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {m.name}
                    {sameId(m, me) ? ' (you)' : ''}
                  </span>
                  <span className="block truncate text-xs muted">
                    {ROLE_LABELS[m.role]}
                    {m.department ? ` · ${m.department}` : ''}
                    {m.section ? ` · Sec ${m.section}` : ''}
                  </span>
                </span>
                {groupAdmin && <Badge color="primary">Group admin</Badge>}
                {isAdmin && !sameId(m, me) && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className={cn(
                        'btn-icon btn-ghost',
                        groupAdmin ? 'text-amber-600 hover:text-amber-700 dark:text-amber-400' : 'text-ink-muted hover:text-primary-600'
                      )}
                      aria-label={groupAdmin ? `Dismiss ${m.name} as group admin` : `Make ${m.name} group admin`}
                      title={groupAdmin ? 'Dismiss as group admin' : 'Make group admin'}
                      disabled={togglingAdmin}
                      onClick={() =>
                        run(
                          () => toggleAdmin({ id: conv._id, userId: m._id }).unwrap(),
                          groupAdmin ? `${m.name} is no longer a group admin` : `${m.name} is now a group admin`
                        )
                      }
                    >
                      {groupAdmin ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                    </button>
                    {!groupAdmin && (
                      <button
                        type="button"
                        className="btn-icon btn-ghost hover:!text-rose-500"
                        aria-label={`Remove ${m.name}`}
                        title="Remove from group"
                        onClick={() => run(() => removeMember({ id: conv._id, userId: m._id }).unwrap(), `${m.name} removed`)}
                      >
                        <UserMinus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
                {!isAdmin && sameId(m, me) && <Check className="h-4 w-4 text-primary-500" />}
              </li>
            );
          })}
        </ul>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete "${conv.name}"?`}
        text="The group and its conversation are removed for every member."
        confirmText="Delete group"
        loading={deleting}
        onConfirm={() =>
          run(async () => {
            await del(conv._id).unwrap();
            setConfirmDelete(false);
            onClose();
            navigate('/chat');
          }, 'Group deleted')
        }
      />
    </>
  );
}
