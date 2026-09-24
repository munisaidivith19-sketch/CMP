import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import {
  useDeleteNotificationMutation,
  useGetNotificationsQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from '../services/api';
import { Button, Card, EmptyState, PageHeader, Pagination, PageLoader, Tabs, cn } from '../components/ui/primitives';
import { NotificationIcon } from '../components/layout/NotificationBell';
import { timeAgo } from '../utils/format';

export default function Notifications() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGetNotificationsQuery({ unread: filter === 'unread' ? 'true' : undefined, page, limit: 20 });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAll, { isLoading: marking }] = useMarkAllNotificationsReadMutation();
  const [remove] = useDeleteNotificationMutation();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={Bell}
        title="Notifications"
        subtitle="Delivered in real time — events, clubs, announcements and replies."
        actions={
          <Button variant="soft" icon={CheckCheck} loading={marking} onClick={() => markAll()} disabled={!data?.unread}>
            Mark all read
          </Button>
        }
      />
      <Tabs
        className="mb-4"
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setPage(1);
        }}
        tabs={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread', count: data?.unread ?? 0 },
        ]}
      />
      {isLoading ? (
        <PageLoader />
      ) : data?.items?.length ? (
        <Card className="space-y-1 p-3">
          {data.items.map((n) => (
            <div
              key={n._id}
              className={cn('group flex items-start gap-3 rounded-3xl p-3 transition-colors hover:bg-white/70 dark:hover:bg-white/5', !n.read && 'bg-primary-500/[0.06]')}
            >
              <button
                className="flex min-w-0 flex-1 items-start gap-3 text-left"
                onClick={() => {
                  if (!n.read) markRead(n._id);
                  if (n.link) navigate(n.link);
                }}
              >
                <NotificationIcon type={n.type} />
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-snug">{n.title}</p>
                  {n.message && <p className="mt-0.5 text-sm muted">{n.message}</p>}
                  <p className="mt-1 text-[11px] text-ink-muted">{timeAgo(n.createdAt)}</p>
                </div>
              </button>
              {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-500" />}
              <button
                className="btn-icon btn-ghost h-8 w-8 opacity-100 hover:!text-rose-500 sm:opacity-0 sm:group-hover:opacity-100"
                onClick={() => remove(n._id)}
                aria-label="Delete notification"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </Card>
      ) : (
        <Card>
          <EmptyState icon={Bell} title="You’re all caught up" text="New notifications will appear here instantly." />
        </Card>
      )}
    </div>
  );
}
