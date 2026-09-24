import { useState } from 'react';
import { Activity } from 'lucide-react';
import { useGetActivityQuery } from '../../services/api';
import { Avatar, Card, EmptyState, PageHeader, PageLoader, Pagination, cn } from '../../components/ui/primitives';
import { fmtDateTime } from '../../utils/format';

const FILTERS = ['', 'auth', 'event', 'club', 'discussion', 'announcement', 'report', 'admin', 'file'];
const COLORS = {
  auth: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  event: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  club: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
  discussion: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  announcement: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  report: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  admin: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300',
};

export default function AdminActivity() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGetActivityQuery({ action: action || undefined, page, limit: 30 });

  return (
    <div>
      <PageHeader icon={Activity} title="Activity log" subtitle="Audit trail of sign-ins, content changes and admin actions (kept 180 days)." />
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            onClick={() => {
              setAction(f);
              setPage(1);
            }}
            className={cn('chip capitalize', action === f && 'chip-active')}
          >
            {f || 'All'}
          </button>
        ))}
      </div>
      {isLoading ? (
        <PageLoader />
      ) : !data?.items?.length ? (
        <Card>
          <EmptyState icon={Activity} title="No activity recorded" />
        </Card>
      ) : (
        <Card className="p-3">
          <div className="divide-y divide-white/60 dark:divide-white/5">
            {data.items.map((a) => {
              const group = a.action.split('.')[0];
              return (
                <div key={a._id} className="flex items-center gap-3 rounded-2xl px-2 py-3 table-row">
                  <Avatar user={a.user} name={a.user?.name || 'System'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <b>{a.user?.name || 'System'}</b>{' '}
                      <code className={cn('rounded-lg px-1.5 py-0.5 text-xs font-bold', COLORS[group] || COLORS.auth)}>{a.action}</code>
                    </p>
                    {a.summary && <p className="truncate text-xs muted">{a.summary}</p>}
                  </div>
                  <div className="shrink-0 text-right text-[11px] muted">
                    <p>{fmtDateTime(a.createdAt)}</p>
                    {a.ip && <p className="font-mono">{a.ip}</p>}
                  </div>
                </div>
              );
            })}
          </div>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </Card>
      )}
    </div>
  );
}
