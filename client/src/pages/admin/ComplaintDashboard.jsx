import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertOctagon,
  CheckCircle2,
  Clock,
  MessageSquareWarning,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useGetComplaintDashboardQuery, useGetComplaintsQuery } from '../../services/api';
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard } from '../../components/ui/primitives';
import { StatusBadge } from '../../components/insights';
import { COMPLAINT_CATEGORY_LABELS, DEPARTMENTS } from '../../utils/constants';
import { timeAgo, titleCase } from '../../utils/format';

const STATUSES = ['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'NOT_RESOLVED', 'ESCALATED', 'CANCELLED', 'CLOSED'];

export default function ComplaintDashboard() {
  const [filters, setFilters] = useState({ department: '', category: '', status: '', anonymous: '' });
  const [page, setPage] = useState(1);
  const { data: dash, isLoading: dashLoading, error: dashError, refetch: refetchDash } = useGetComplaintDashboardQuery({
    department: filters.department || undefined,
    category: filters.category || undefined,
  });
  const { data, isLoading, error, refetch } = useGetComplaintsQuery({
    page,
    limit: 15,
    department: filters.department || undefined,
    category: filters.category || undefined,
    status: filters.status || undefined,
    anonymous: filters.anonymous || undefined,
  });

  const set = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={AlertOctagon} title="Complaints" subtitle="College-wide complaint monitoring, filters and statistics." />

      {dashLoading ? (
        <Skeleton className="h-28" />
      ) : dashError ? (
        <ErrorState error={dashError} onRetry={refetchDash} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={MessageSquareWarning} label="Total" value={dash.total} gradient="from-primary-400 to-primary-600" />
          <StatCard icon={Clock} label="Open" value={dash.open} hint={`${dash.pending} pending`} gradient="from-amber-400 to-orange-500" delay={60} />
          <StatCard icon={CheckCircle2} label="Resolved" value={dash.resolved} gradient="from-emerald-400 to-teal-500" delay={120} />
          <StatCard icon={TrendingUp} label="Escalated" value={dash.escalated} hint={`${dash.cancelled} cancelled`} gradient="from-fuchsia-400 to-purple-500" delay={180} />
        </div>
      )}

      <Card>
        <CardHeader title="Filters" />
        <div className="grid gap-3 sm:grid-cols-4">
          <select className="input" value={filters.department} onChange={(e) => set('department', e.target.value)}>
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select className="input" value={filters.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>
            {Object.entries(COMPLAINT_CATEGORY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select className="input" value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </select>
          <select className="input" value={filters.anonymous} onChange={(e) => set('anonymous', e.target.value)}>
            <option value="">Anonymous & visible</option>
            <option value="true">Anonymous only</option>
            <option value="false">Visible only</option>
          </select>
        </div>
      </Card>

      <Card>
        <CardHeader title="Complaints" />
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !data.complaints.length ? (
          <EmptyState icon={XCircle} title="No complaints match these filters" />
        ) : (
          <>
            <ul className="divide-y divide-white/60 dark:divide-white/5">
              {data.complaints.map((c) => (
                <li key={c._id}>
                  <Link to={`/complaints/${c._id}`} className="flex flex-wrap items-center gap-3 rounded-2xl px-2 py-3 hover:bg-white/60 dark:hover:bg-white/5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {COMPLAINT_CATEGORY_LABELS[c.category] || titleCase(c.category)}
                        {c.subCategory ? ` · ${titleCase(c.subCategory)}` : ''} · {c.complaintCode}
                      </p>
                      <p className="text-xs muted">
                        {c.department || 'College-wide'} · assigned to {titleCase(c.currentAuthorityRole)} · {timeAgo(c.updatedAt)}
                        {c.anonymous ? ' · anonymous' : ''}
                      </p>
                    </div>
                    <StatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
