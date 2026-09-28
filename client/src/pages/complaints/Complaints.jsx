import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { AlertOctagon, CheckCircle2, EyeOff, MessageSquareWarning, Plus } from 'lucide-react';
import { useGetComplaintsQuery } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/primitives';
import { StatusBadge } from '../../components/insights';
import { timeAgo, titleCase } from '../../utils/format';
import { COMPLAINT_CATEGORY_LABELS } from '../../utils/constants';
import ComplaintFormModal from './ComplaintFormModal';

function ComplaintCard({ complaint }) {
  return (
    <Link to={`/complaints/${complaint._id}`} className="block">
      <Card hover className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <MessageSquareWarning className="h-4 w-4 text-primary-400" />
          <h3 className="text-sm font-extrabold">{COMPLAINT_CATEGORY_LABELS[complaint.category] || titleCase(complaint.category)}</h3>
          {complaint.subCategory && <span className="text-xs muted">· {titleCase(complaint.subCategory)}</span>}
          {complaint.anonymous && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300">
              <EyeOff className="h-3 w-3" /> Anonymous
            </span>
          )}
          <StatusBadge status={complaint.status} />
        </div>
        <p className="text-xs muted">
          {complaint.complaintCode} · Assigned to {titleCase(complaint.currentAuthorityRole)} · Updated {timeAgo(complaint.updatedAt)}
        </p>
      </Card>
    </Link>
  );
}

function StudentComplaints() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useGetComplaintsQuery({ page, limit: 12 });

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MessageSquareWarning}
        title="Complaints"
        subtitle="Register and track complaints — academics, ragging & harassment, infrastructure or hostel."
        actions={
          <button onClick={() => setOpen(true)} className="btn btn-primary">
            <Plus className="h-4 w-4" /> Register complaint
          </button>
        }
      />
      {isLoading ? (
        <Skeleton className="h-72" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.complaints.length ? (
        <Card>
          <EmptyState
            icon={MessageSquareWarning}
            title="No complaints yet"
            text="Raised a concern? Register it here and we'll route it to the right authority."
            action={
              <button onClick={() => setOpen(true)} className="btn btn-primary">
                <Plus className="h-4 w-4" /> Register complaint
              </button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.complaints.map((c) => (
              <ComplaintCard key={c._id} complaint={c} />
            ))}
          </div>
          <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
        </>
      )}
      <ComplaintFormModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function AuthorityComplaints() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useGetComplaintsQuery({ page, limit: 12 });

  return (
    <div className="space-y-5">
      <PageHeader icon={MessageSquareWarning} title="Complaints assigned to you" subtitle="Complaints currently waiting on your review." />
      {isLoading ? (
        <Skeleton className="h-72" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.complaints.length ? (
        <Card>
          <EmptyState icon={CheckCircle2} title="Nothing assigned to you" text="New complaints appear here the moment they're routed to you." />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.complaints.map((c) => (
              <ComplaintCard key={c._id} complaint={c} />
            ))}
          </div>
          <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function ChairAdminRedirect() {
  return (
    <div className="space-y-5">
      <PageHeader icon={AlertOctagon} title="Complaints" subtitle="Use the full Complaints dashboard for college-wide monitoring, filters and statistics." />
      <Card>
        <EmptyState icon={MessageSquareWarning} title="Head to the admin dashboard" text="Chairman and Admin accounts manage complaints from the dedicated dashboard." action={<Link to="/admin/complaints" className="btn btn-primary">Open dashboard</Link>} />
      </Card>
    </div>
  );
}

export default function Complaints() {
  const me = useSelector(selectUser);
  if (me.role === 'student') return <StudentComplaints />;
  if (['admin', 'chairman'].includes(me.role)) return <ChairAdminRedirect />;
  return <AuthorityComplaints />;
}
