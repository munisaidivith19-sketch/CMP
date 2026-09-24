import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { AlertTriangle, Ban, Check, EyeOff, ExternalLink, ShieldAlert, Trash2 } from 'lucide-react';
import { useGetReportsQuery, useResolveReportMutation } from '../../services/api';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, PageLoader, Pagination, Tabs } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/form';
import { selectRole } from '../../features/authSlice';
import { errMsg, timeAgo } from '../../utils/format';

const ACTIONS = [
  { value: 'dismiss', label: 'Dismiss', icon: Check, variant: 'ghost', text: 'No rule was broken. The report will be closed.' },
  { value: 'hide', label: 'Hide content', icon: EyeOff, variant: 'soft', text: 'The content stays in the database but is hidden from everyone except moderators.' },
  { value: 'warn', label: 'Warn author', icon: AlertTriangle, variant: 'soft', text: 'The author receives a guidelines warning notification.' },
  { value: 'delete', label: 'Delete content', icon: Trash2, variant: 'danger', text: 'The content is permanently removed.' },
  { value: 'suspend', label: 'Suspend author', icon: Ban, variant: 'danger', text: 'The author’s account is suspended and signed out everywhere.', adminOnly: true },
];

export default function AdminReports() {
  const role = useSelector(selectRole);
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState(null); // { report, action }
  const [note, setNote] = useState('');
  const { data, isLoading } = useGetReportsQuery({ status, page });
  const [resolve, { isLoading: saving }] = useResolveReportMutation();

  const submit = async () => {
    try {
      await resolve({ id: acting.report._id, action: acting.action.value, note: note || undefined }).unwrap();
      toast.success('Report handled');
      setActing(null);
      setNote('');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div>
      <PageHeader icon={ShieldAlert} title="Moderation queue" subtitle="Review reported and auto-flagged content." />
      <Tabs
        className="mb-5"
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        tabs={[
          { value: 'pending', label: 'Pending' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'dismissed', label: 'Dismissed' },
        ]}
      />

      {isLoading ? (
        <PageLoader />
      ) : !data?.items?.length ? (
        <Card>
          <EmptyState icon={ShieldAlert} title={status === 'pending' ? 'Queue is clear 🎉' : 'Nothing here'} text="Reported content will show up here for review." />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((r) => (
            <Card key={r._id} className="animate-fade-up">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color="danger">{r.reason}</Badge>
                    <Badge color="neutral">{r.targetType}</Badge>
                    {!r.reporter && <Badge color="warning">auto-flagged</Badge>}
                    <span className="text-xs muted">{timeAgo(r.createdAt)}</span>
                  </div>
                  <p className="mt-3 rounded-2xl bg-white/60 p-3 text-sm italic dark:bg-white/5">“{r.preview}”</p>
                  {r.details && <p className="mt-2 text-sm muted">Reporter note: {r.details}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs muted">
                    {r.reporter && (
                      <span className="flex items-center gap-2">
                        <Avatar user={r.reporter} size="xs" /> Reported by {r.reporter.name}
                      </span>
                    )}
                    {r.link && (
                      <Link to={r.link} className="flex items-center gap-1 font-semibold text-primary-600 hover:underline dark:text-primary-300">
                        View content <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    {r.resolution?.action && (
                      <span>
                        Action: <b className="capitalize">{r.resolution.action}</b> by {r.resolution.by?.name}
                        {r.resolution.note ? ` — “${r.resolution.note}”` : ''}
                      </span>
                    )}
                  </div>
                </div>
                {r.status === 'pending' && (
                  <div className="flex flex-wrap gap-2 lg:max-w-[340px] lg:justify-end">
                    {ACTIONS.filter((a) => !a.adminOnly || role === 'admin')
                      .filter((a) => !(a.value === 'hide' && !['discussion', 'reply'].includes(r.targetType)))
                      .filter((a) => !(a.value === 'delete' && r.targetType === 'user'))
                      .map((a) => (
                        <Button key={a.value} size="sm" variant={a.variant} icon={a.icon} onClick={() => setActing({ report: r, action: a })}>
                          {a.label}
                        </Button>
                      ))}
                  </div>
                )}
              </div>
            </Card>
          ))}
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </div>
      )}

      <Modal
        open={Boolean(acting)}
        onClose={() => setActing(null)}
        title={acting?.action.label}
        subtitle={acting?.action.text}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setActing(null)}>
              Cancel
            </Button>
            <Button variant={acting?.action.variant === 'danger' ? 'danger' : 'primary'} loading={saving} onClick={submit}>
              Confirm
            </Button>
          </>
        }
      >
        <Textarea label="Note (optional — sent to the author)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
      </Modal>
    </div>
  );
}
