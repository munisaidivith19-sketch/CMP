import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Info, Link2, MapPin, PackageSearch, Sparkles, Trash2 } from 'lucide-react';
import {
  useDeleteLostFoundMutation,
  useGetLostFoundItemQuery,
  useGetLostFoundMatchesQuery,
  useSetLostFoundStatusMutation,
} from '../../services/api';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import { StatusBadge } from '../../components/insights';
import { errMsg, fmtDateTime, timeAgo, titleCase } from '../../utils/format';
import { LF_STATUSES } from './LostFound';

const CONTACT = { email: 'Email', phone: 'Phone', in_person: 'In person' };

function Matches({ item }) {
  const { data, isLoading, error } = useGetLostFoundMatchesQuery(item._id);
  const [setStatus, { isLoading: linking }] = useSetLostFoundStatusMutation();
  const resolved = ['returned', 'closed'].includes(item.status);

  return (
    <Card>
      <CardHeader title="Possible matches" subtitle={`${item.type === 'lost' ? 'Found' : 'Lost'} reports that look similar`} action={<Sparkles className="h-5 w-5 text-primary-400" />} />
      <div className="mb-3 flex items-start gap-2 rounded-2xl bg-sky-500/10 p-3 text-xs text-sky-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        These are automatic suggestions based on category, description, place and time. They are not proof of ownership — staff verify before any item is handed over.
      </div>
      {isLoading ? (
        <Skeleton className="h-32" />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data.length ? (
        <p className="py-6 text-center text-sm muted">No similar reports yet. You’ll be notified if staff link a possible match.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((m) => (
            <li key={m._id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/50 p-3 dark:bg-white/5">
              <Link to={`/lost-found/${m._id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{m.itemName}</p>
                <p className="truncate text-xs muted">
                  {m.location} · {fmtDateTime(m.dateTime)}
                </p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {m.matchReasons.map((r) => (
                    <Badge key={r} color="neutral">
                      {r}
                    </Badge>
                  ))}
                </p>
              </Link>
              {item.canManage && !resolved && (
                <Button
                  size="sm"
                  variant="soft"
                  icon={Link2}
                  loading={linking}
                  onClick={async () => {
                    try {
                      await setStatus({ id: item._id, status: 'possible_match', matchedWith: m._id }).unwrap();
                      toast.success('Linked as a possible match — both reporters were notified');
                    } catch (e) {
                      toast.error(errMsg(e));
                    }
                  }}
                >
                  Link as possible match
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StaffControls({ item }) {
  const [status, setStatusValue] = useState(item.status);
  const [note, setNote] = useState('');
  const [save, { isLoading }] = useSetLostFoundStatusMutation();
  return (
    <Card>
      <CardHeader title="Manage report" subtitle="Staff only" />
      <div className="space-y-3">
        <select aria-label="Status" className="input" value={status} onChange={(e) => setStatusValue(e.target.value)}>
          {LF_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Resolution note (e.g. ID verified at security desk)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          className="w-full"
          loading={isLoading}
          disabled={status === item.status && !note}
          onClick={async () => {
            try {
              await save({ id: item._id, status, resolutionNote: note || undefined }).unwrap();
              toast.success('Report updated');
              setNote('');
            } catch (e) {
              toast.error(errMsg(e));
            }
          }}
        >
          Update status
        </Button>
      </div>
    </Card>
  );
}

export default function LostFoundDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: item, isLoading, error, refetch } = useGetLostFoundItemQuery(id);
  const [setStatus, { isLoading: closing }] = useSetLostFoundStatusMutation();
  const [remove, { isLoading: removing }] = useDeleteLostFoundMutation();
  const [confirm, setConfirm] = useState(null);

  if (isLoading) return <Skeleton className="h-96" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const resolved = ['returned', 'closed'].includes(item.status);
  const match = item.matchedWith && typeof item.matchedWith === 'object' ? item.matchedWith : null;

  return (
    <div className="space-y-5">
      <Link to="/lost-found" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Lost & found
      </Link>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden p-0 lg:col-span-2">
          <div className={cn('relative flex h-64 items-center justify-center bg-gradient-to-br', item.type === 'lost' ? 'from-rose-300 to-orange-300' : 'from-sky-300 to-emerald-300')}>
            {item.photo ? <img src={item.photo} alt={item.itemName} className="h-full w-full object-cover" /> : <PackageSearch className="h-16 w-16 text-white/80" />}
            <span className={cn('absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-extrabold uppercase text-white', item.type === 'lost' ? 'bg-rose-500' : 'bg-sky-500')}>{item.type}</span>
          </div>
          <div className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">{item.itemName}</h1>
                <p className="mt-1 text-sm muted">
                  {titleCase(item.category)} · reported {timeAgo(item.createdAt)}
                </p>
              </div>
              <StatusBadge status={item.status} />
            </div>
            {item.description && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{item.description}</p>}
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="label">{item.type === 'lost' ? 'Last seen' : 'Found at'}</dt>
                <dd className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-primary-400" />
                  {item.location}
                </dd>
              </div>
              <div>
                <dt className="label">When</dt>
                <dd>{fmtDateTime(item.dateTime)}</dd>
              </div>
              {item.additionalDetails && (
                <div className="sm:col-span-2">
                  <dt className="label">Additional details</dt>
                  <dd>{item.additionalDetails}</dd>
                </div>
              )}
              {item.contactMethod && (
                <div>
                  <dt className="label">Preferred contact</dt>
                  <dd>{CONTACT[item.contactMethod]}</dd>
                </div>
              )}
              {item.resolutionNote && (
                <div>
                  <dt className="label">Resolution</dt>
                  <dd>
                    {item.resolutionNote}
                    {item.resolvedBy ? ` — ${item.resolvedBy.name}` : ''}
                  </dd>
                </div>
              )}
            </dl>
            {match && (
              <Link to={`/lost-found/${match._id}`} className="mt-5 flex items-center gap-3 rounded-2xl bg-amber-500/10 p-3 text-sm">
                <Link2 className="h-5 w-5 text-amber-600" />
                <span className="flex-1">
                  Linked {item.status === 'returned' ? 'and returned' : 'as a possible match'}: <span className="font-bold">{match.itemName}</span>
                </span>
                <StatusBadge status={match.status} />
              </Link>
            )}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Reported by" />
            <div className="flex items-center gap-3">
              <Avatar user={item.reporter} />
              <div className="min-w-0">
                <p className="font-bold">{item.isMine ? 'You' : item.reporter?.name}</p>
                <p className="truncate text-xs muted">{item.reporter?.department}</p>
                {item.reporter?.email && <p className="truncate text-xs">{item.reporter.email}</p>}
                {item.reporter?.phone && <p className="text-xs">{item.reporter.phone}</p>}
              </div>
            </div>
            {!item.isMine && !item.canManage && <p className="mt-3 text-xs muted">Contact details are shared with staff only. Hand found items to the security desk or message the reporter.</p>}
            {!item.isMine && item.reporter?._id && (
              <Button variant="soft" size="sm" className="mt-3 w-full" to={`/people/${item.reporter._id}`}>
                View profile
              </Button>
            )}
            {item.isMine && !resolved && (
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="soft" className="flex-1" loading={closing} onClick={() => setConfirm('close')}>
                  Close report
                </Button>
                {['lost', 'found'].includes(item.status) && (
                  <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirm('delete')}>
                    Delete
                  </Button>
                )}
              </div>
            )}
          </Card>
          {item.canManage && <StaffControls key={item.status} item={item} />}
        </div>
      </div>

      {(item.isMine || item.canManage) && !resolved ? (
        <Matches item={item} />
      ) : resolved ? (
        <Card>
          <EmptyState icon={PackageSearch} title={`This report is ${item.status}`} />
        </Card>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm === 'delete' ? 'Delete this report?' : 'Close this report?'}
        text={confirm === 'delete' ? 'It will be removed for everyone.' : 'Use this when you no longer need help — e.g. you found it yourself.'}
        confirmText={confirm === 'delete' ? 'Delete' : 'Close report'}
        danger={confirm === 'delete'}
        loading={closing || removing}
        onConfirm={async () => {
          try {
            if (confirm === 'delete') {
              await remove(item._id).unwrap();
              toast.success('Report deleted');
              navigate('/lost-found');
            } else {
              await setStatus({ id: item._id, status: 'closed' }).unwrap();
              toast.success('Report closed');
            }
          } catch (e) {
            toast.error(errMsg(e));
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}
