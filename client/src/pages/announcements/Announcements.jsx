import { useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Megaphone, Pencil, Pin, Plus, Search, Trash2 } from 'lucide-react';
import {
  useDeleteAnnouncementMutation,
  useGetAnnouncementsQuery,
  useTogglePinAnnouncementMutation,
} from '../../services/api';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, cn } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import { AnnouncementItem } from '../../components/domain';
import AnnouncementForm from './AnnouncementForm';
import { selectIsModerator, selectUser } from '../../features/authSlice';
import { PRIORITIES } from '../../utils/constants';
import { errMsg } from '../../utils/format';

export default function Announcements() {
  const user = useSelector(selectUser);
  const isMod = useSelector(selectIsModerator);
  const [priority, setPriority] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | announcement
  const [deleting, setDeleting] = useState(null);

  const { data, isFetching, error, refetch } = useGetAnnouncementsQuery({ priority: priority || undefined, q: q || undefined, page });
  const [pin] = useTogglePinAnnouncementMutation();
  const [remove, { isLoading: removing }] = useDeleteAnnouncementMutation();
  const canPost = isMod || user.role === 'club_admin' || user.clubs?.length > 0;

  return (
    <div>
      <PageHeader
        icon={Megaphone}
        title="Announcements"
        subtitle="Official notices, deadlines and club updates."
        actions={
          canPost && (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              New announcement
            </Button>
          )
        }
      />

      <Card className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search announcements…"
            className="input pl-11"
          />
        </div>
        <div className="flex gap-2">
          {['', ...PRIORITIES].map((p) => (
            <button
              key={p || 'all'}
              onClick={() => {
                setPriority(p);
                setPage(1);
              }}
              className={cn('chip capitalize', priority === p && 'chip-active')}
            >
              {p || 'All'}
            </button>
          ))}
        </div>
      </Card>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isFetching && !data ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-3xl" />
          ))}
        </div>
      ) : data?.items?.length ? (
        <Card className={cn('space-y-3', isFetching && 'opacity-60')}>
          {data.items.map((a) => (
            <AnnouncementItem
              key={a._id}
              a={a}
              actions={
                <>
                  {isMod && (
                    <button
                      className={cn('btn-icon btn-ghost h-8 w-8', a.isPinned && 'text-primary-500')}
                      title={a.isPinned ? 'Unpin' : 'Pin to top'}
                      onClick={() => pin(a._id)}
                    >
                      <Pin className="h-4 w-4" />
                    </button>
                  )}
                  {a.canEdit && (
                    <>
                      <button className="btn-icon btn-ghost h-8 w-8" title="Edit" onClick={() => setEditing(a)}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button className="btn-icon btn-ghost h-8 w-8 hover:!text-rose-500" title="Delete" onClick={() => setDeleting(a)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </>
              }
            />
          ))}
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </Card>
      ) : (
        <Card>
          <EmptyState icon={Megaphone} title="No announcements" text="Nothing matches your filters." />
        </Card>
      )}

      <AnnouncementForm open={Boolean(editing)} onClose={() => setEditing(null)} announcement={editing === 'new' ? null : editing} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete announcement?"
        confirmText="Delete"
        loading={removing}
        onConfirm={async () => {
          try {
            await remove(deleting._id).unwrap();
            toast.success('Deleted');
            setDeleting(null);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
