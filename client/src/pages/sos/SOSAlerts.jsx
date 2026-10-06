import { useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  AlertOctagon,
  CheckCircle2,
  ExternalLink,
  Flame,
  HeartPulse,
  HelpCircle,
  MapPin,
  Phone,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { selectUser } from '../../features/authSlice';
import {
  SOS_RESPONDER_ROLES,
  SOS_STATUSES,
  SOS_TYPES,
} from '../../utils/constants';
import {
  useAckSOSAlertMutation,
  useGetSOSAlertsQuery,
  useResolveSOSAlertMutation,
} from '../../services/api';
import { errMsg, timeAgo } from '../../utils/format';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Skeleton,
} from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Select, Textarea } from '../../components/ui/form';
import { StatusBadge } from '../../components/insights';
import SOSModal from '../../components/sos/SOSModal';

const TYPE_ICONS = {
  medical: HeartPulse,
  security: ShieldAlert,
  fire: Flame,
  ragging: Users,
  other: HelpCircle,
};

function ResolveAlertModal({ alert, open, onClose, onResolved }) {
  const [outcome, setOutcome] = useState('resolved');
  const [note, setNote] = useState('');
  const [resolveSOS, { isLoading }] = useResolveSOSAlertMutation();

  if (!alert) return null;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!note.trim()) {
      toast.error('Please enter a resolution note');
      return;
    }
    try {
      await resolveSOS({
        id: alert._id,
        status: outcome,
        resolutionNote: note.trim(),
      }).unwrap();
      toast.success('Alert resolved and closed');
      setNote('');
      setOutcome('resolved');
      onClose();
      onResolved?.();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Resolve SOS Emergency Alert"
      subtitle={`Alert for ${alert.user?.name || 'User'} (${alert.type})`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            loading={isLoading}
            variant="primary"
          >
            Submit resolution
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Resolution outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          options={[
            { value: 'resolved', label: 'Incident handled & resolved' },
            { value: 'false_alarm', label: 'Mark as false alarm' },
          ]}
        />

        <Textarea
          label="Resolution notes / actions taken"
          placeholder="Describe how the situation was attended to and resolved"
          rows={4}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
        />
      </form>
    </Modal>
  );
}

function ResponderAlertCard({ alert, onResolve }) {
  const [ackSOS, { isLoading: isAcking }] = useAckSOSAlertMutation();
  const Icon = TYPE_ICONS[alert.type] || HelpCircle;
  const isActive = alert.status === 'active';
  const isAcked = alert.status === 'acknowledged';

  const handleAck = async () => {
    try {
      await ackSOS(alert._id).unwrap();
      toast.success('Acknowledged alert');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const hasCoords = alert.location?.lat != null && alert.location?.lng != null;

  return (
    <Card
      className={`relative overflow-hidden transition-all ${
        isActive
          ? 'border-2 border-rose-500/60 bg-rose-500/5 shadow-md dark:border-rose-400/50 dark:bg-rose-500/10'
          : ''
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm transition-all ${
              isActive
                ? 'bg-rose-600 text-white animate-pulse'
                : 'bg-primary-500/10 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300'
            }`}
          >
            <Icon className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-extrabold capitalize text-ink dark:text-primary-50">
                {alert.type} Alert
              </h3>
              <StatusBadge status={alert.status} />
              <span className="text-xs font-medium text-ink-muted">
                {timeAgo(alert.createdAt)}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-2.5">
              <Avatar user={alert.user} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-ink dark:text-primary-50">
                  {alert.user?.name || 'Unknown User'}
                </p>
                <p className="truncate text-[11px] text-ink-soft dark:text-ink-muted">
                  {alert.department || alert.user?.department || 'Campus'}
                  {alert.section || alert.user?.section ? ` · Sec ${alert.section || alert.user?.section}` : ''}
                </p>
              </div>
            </div>

            {alert.user?.phone ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft dark:text-ink-muted">
                <Phone className="h-3.5 w-3.5 text-primary-500" />
                <span>Contact: {alert.user.phone}</span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isActive ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAck}
              loading={isAcking}
              icon={CheckCircle2}
              className="text-amber-800 dark:text-amber-300 border-amber-500/40 hover:bg-amber-500/10"
            >
              Acknowledge
            </Button>
          ) : null}

          {isActive || isAcked ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onResolve(alert)}
              className="!bg-gradient-to-r !from-emerald-500 !to-teal-600 !text-white"
            >
              Resolve
            </Button>
          ) : null}
        </div>
      </div>

      {alert.note ? (
        <div className="mt-3.5 rounded-2xl border border-slate-200/80 bg-white/60 p-3 text-xs text-ink dark:border-white/10 dark:bg-ink/40 dark:text-primary-100">
          <p className="font-semibold text-ink-muted uppercase tracking-wider text-[10px] mb-1">
            Details:
          </p>
          <p className="leading-relaxed whitespace-pre-wrap">{alert.note}</p>
        </div>
      ) : null}

      {hasCoords ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-primary-500/10 px-3.5 py-2 text-xs font-semibold text-primary-700 dark:bg-primary-500/15 dark:text-primary-300">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
            <span>
              {alert.location.lat.toFixed(5)}, {alert.location.lng.toFixed(5)}
              {alert.location.accuracy ? ` (±${alert.location.accuracy}m)` : ''}
            </span>
          </div>
          <a
            href={`https://www.google.com/maps?q=${alert.location.lat},${alert.location.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-bold text-primary-600 hover:underline dark:text-primary-400"
          >
            <span>View on Map</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : null}

      {alert.resolutionNote ? (
        <div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300">
          <p className="font-bold">
            Resolution ({alert.resolvedBy?.name || 'Staff'}):
          </p>
          <p className="mt-0.5 leading-relaxed">{alert.resolutionNote}</p>
        </div>
      ) : null}
    </Card>
  );
}

export default function SOSAlerts() {
  const user = useSelector(selectUser);
  const isResponder = SOS_RESPONDER_ROLES.includes(user?.role);

  const [triggerOpen, setTriggerOpen] = useState(false);
  const [resolveAlert, setResolveAlert] = useState(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading, isError, error, refetch } = useGetSOSAlertsQuery(
    {
      page,
      status: statusFilter || undefined,
      type: typeFilter || undefined,
    },
    { pollingInterval: isResponder ? 10000 : undefined }
  );

  const handleStatusChange = (val) => {
    setStatusFilter(val);
    setPage(1);
  };

  const handleTypeChange = (val) => {
    setTypeFilter(val);
    setPage(1);
  };

  const items = data?.items || [];
  const pages = data?.pages || 0; // REQUIRED correction §14 #3

  return (
    <div className="space-y-6">
      <PageHeader
        icon={AlertOctagon}
        title="Campus SOS & Emergency"
        subtitle={
          isResponder
            ? 'Live emergency responder feed for campus security and leadership.'
            : 'Rapid emergency alert system connected to campus security and staff.'
        }
        actions={
          <Button
            type="button"
            icon={AlertOctagon}
            onClick={() => setTriggerOpen(true)}
            className="!bg-gradient-to-r !from-rose-500 !to-red-600 !text-white shadow-lg hover:!from-rose-600 hover:!to-red-700"
          >
            Trigger SOS
          </Button>
        }
      />

      <SOSModal
        open={triggerOpen}
        onClose={() => setTriggerOpen(false)}
        onSubmitted={() => refetch()}
      />

      <ResolveAlertModal
        alert={resolveAlert}
        open={Boolean(resolveAlert)}
        onClose={() => setResolveAlert(null)}
        onResolved={() => refetch()}
      />

      {!isResponder ? (
        <Card className="border-2 border-rose-500/40 bg-gradient-to-br from-rose-500/10 via-red-500/5 to-transparent p-6 text-center sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-rose-500 text-white shadow-glow mb-4">
            <AlertOctagon className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-extrabold text-ink dark:text-primary-50">
            Need Immediate Assistance?
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-ink-soft dark:text-ink-muted leading-relaxed">
            Triggering an emergency SOS instantly alerts campus security, department HODs, and the administration with your live location.
          </p>
          <div className="mt-6 flex justify-center">
            <Button
              size="lg"
              icon={AlertOctagon}
              onClick={() => setTriggerOpen(true)}
              className="!bg-gradient-to-r !from-rose-500 !to-red-600 !text-white shadow-lg hover:!from-rose-600 hover:!to-red-700"
            >
              Trigger Campus SOS
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="section-title text-sm font-bold uppercase tracking-wider text-ink-soft dark:text-ink-muted">
              Filter Emergency Alerts
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="input cursor-pointer rounded-xl py-1.5 text-xs w-auto min-w-[140px]"
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                {SOS_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>

              <select
                value={typeFilter}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="input cursor-pointer rounded-xl py-1.5 text-xs w-auto min-w-[140px]"
                aria-label="Filter by emergency type"
              >
                <option value="">All emergency types</option>
                {SOS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>
      )}

      <div>
        <h2 className="mb-4 text-base font-extrabold text-ink dark:text-primary-50">
          {isResponder ? 'Live Emergency Dispatch' : 'Your Past Emergency Alerts'}
        </h2>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : isError ? (
          <ErrorState
            error={error}
            onRetry={refetch}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={AlertOctagon}
            title={isResponder ? 'No active emergency alerts' : 'No alerts submitted'}
            text={
              isResponder
                ? 'All quiet on campus. Live alerts will appear here automatically.'
                : 'You have not triggered any SOS alerts.'
            }
          />
        ) : (
          <div className="space-y-4">
            {items.map((alert) => (
              <ResponderAlertCard
                key={alert._id}
                alert={alert}
                onResolve={(a) => setResolveAlert(a)}
              />
            ))}

            <Pagination
              page={page}
              pages={pages}
              onChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

