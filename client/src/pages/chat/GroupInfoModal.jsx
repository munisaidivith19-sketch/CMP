import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, LogOut, Pencil, Search, Trash2, UserMinus, UserPlus } from 'lucide-react';
import {
  useAddChatMembersMutation,
  useDeleteGroupMutation,
  useGetUsersQuery,
  useLeaveConversationMutation,
  useUpdateGroupMutation,
} from '../../services/api';
import { Avatar, Badge, Button, Skeleton } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/form';
import { ROLE_LABELS, YEAR_LABELS } from '../../utils/constants';
import { errMsg } from '../../utils/format';

const sameId = (a, b) => String(a?._id || a) === String(b?._id || b);
const CATEGORY_LABEL = { custom: 'Custom', academic: 'Academics', faculty: 'Faculty' };

/**
 * Group details. The group admin (its creator — the HOD for an HOD group) can
 * rename it, add and remove members and delete it; everyone else sees the
 * members and can leave. The server enforces the same rules, including who may
 * be added to the group's type.
 */
export default function GroupInfoModal({ open, onClose, conv, me }) {
  const navigate = useNavigate();
  const isAdmin = me.role === 'admin' || (conv?.admins || []).some((a) => sameId(a, me));
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [update, { isLoading: renaming }] = useUpdateGroupMutation();
  const [add, { isLoading: adding }] = useAddChatMembersMutation();
  const [removeMember] = useLeaveConversationMutation();
  const [del, { isLoading: deleting }] = useDeleteGroupMutation();
  const { data: found, isFetching } = useGetUsersQuery({ q: q || undefined, limit: 20, context: 'picker' }, { skip: !open || !isAdmin || q.trim().length < 2 });

  useEffect(() => {
    if (open) {
      setName(conv?.name || '');
      setQ('');
    }
  }, [open, conv?.name]);

  const members = conv?.participants || [];
  const candidates = useMemo(() => (found?.items || []).filter((u) => !members.some((m) => sameId(m, u))), [found, members]);

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
                      <span className="block truncate text-sm font-semibold">{u.name}</span>
                      <span className="block truncate text-xs muted">
                        {ROLE_LABELS[u.role]}
                        {u.department ? ` · ${u.department}` : ''}
                        {u.section ? ` · Sec ${u.section}` : ''}
                      </span>
                    </span>
                    <Button size="sm" variant="soft" icon={UserPlus} loading={adding} onClick={() => run(() => add({ id: conv._id, userIds: [u._id] }).unwrap(), `${u.name} added`)}>
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="label">Members</p>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {members.map((m) => {
            const groupAdmin = (conv.admins || []).some((a) => sameId(a, m));
            return (
              <li key={m._id} className="flex items-center gap-3 rounded-xl p-2">
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
                {isAdmin && !groupAdmin && (
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
