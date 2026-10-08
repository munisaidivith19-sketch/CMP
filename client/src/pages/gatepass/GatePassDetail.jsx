import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { ArrowLeft, DoorOpen, LogIn } from 'lucide-react';
import { useAdminReturnOverrideMutation, useGetGatePassQuery } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Avatar, Button, Card, CardHeader, ErrorState, PageHeader, Skeleton } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/form';
import { StatusBadge } from '../../components/insights';
import { errMsg, fmtClassDay, fmtDateTime, titleCase, displayName } from '../../utils/format';
import { GATE_PASS_REGARDING } from '../../utils/constants';
import { PassQr, PassTimeline, ReviewCard, canReviewPass, isOuting, passStatusLabel } from './GatePass';
import { AUTHORITY_LABELS, EmergencyBadge, EmergencyDetails, isEmergency } from './EmergencyGatePass';

const destinationLine = (d) => (d ? [d.area, d.district, d.state].filter(Boolean).join(', ') : '—');

/**
 * Admin: when a student's device cannot pass the return location check, issue
 * their Return QR / code directly. Security still scans it and records IN —
 * this never marks the student as returned by itself.
 */
function AdminReturnOverride({ pass }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submit, { isLoading }] = useAdminReturnOverrideMutation();
  const trimmed = reason.trim();
  const go = async () => {
    try {
      await submit({ id: pass._id, reason: trimmed }).unwrap();
      toast.success('Return code sent to the student — Security will record IN at the gate');
      setOpen(false);
      setReason('');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border border-amber-500/20 bg-amber-500/5">
      <div className="min-w-0">
        <p className="font-bold">Student can't verify their location?</p>
        <p className="text-sm muted">
          {pass.returnOverride?.at
            ? `Return approved by ${displayName(pass.returnOverride.by) || 'Admin'} · ${fmtDateTime(pass.returnOverride.at)}${pass.returnOverride.reason ? ` — “${pass.returnOverride.reason}”` : ''}`
            : 'Mark the return to send them a Return QR / code. Security still scans it and taps IN at the gate.'}
        </p>
      </div>
      <Button icon={LogIn} variant={pass.returnOverride?.at ? 'outline' : 'primary'} onClick={() => setOpen(true)}>
        {pass.returnOverride?.at ? 'Issue a new code' : 'Mark as return'}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Mark as return"
        subtitle={`${displayName(pass.student)} · ${pass.student?.rollNo || ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button icon={LogIn} loading={isLoading} disabled={trimmed.length < 3} onClick={go}>
              Send return code
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            The student gets a Return QR / code on their gate pass, valid for an hour. They show it to Security, who scans it and taps <b>IN</b> — only then is
            the return recorded. Any earlier return code stops working.
          </p>
          <Textarea
            label="Reason (recorded in Security & Logs)"
            rows={3}
            maxLength={300}
            placeholder="e.g. Student is at the gate; laptop cannot get a precise location"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </Modal>
    </Card>
  );
}

export default function GatePassDetail() {
  const { id } = useParams();
  const me = useSelector(selectUser);
  const { data: pass, isLoading, error, refetch } = useGetGatePassQuery(id);
  const mine = pass && String(pass.student?._id) === String(me._id);

  return (
    <div className="space-y-5">
      <Link to="/gate-pass" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Gate passes
      </Link>
      {isLoading ? (
        <Skeleton className="h-72" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <PageHeader
            icon={DoorOpen}
            title={isEmergency(pass) ? 'Emergency gate pass' : isOuting(pass) ? 'Outing pass' : `${GATE_PASS_REGARDING[pass.regarding] || titleCase(pass.regarding)} pass`}
            subtitle={`Requested ${fmtDateTime(pass.createdAt)}`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {isEmergency(pass) && <EmergencyBadge />}
                <StatusBadge status={pass.status} label={passStatusLabel(pass.status, pass)} />
              </div>
            }
          />
          {!mine && canReviewPass(me.role, pass) && <ReviewCard pass={pass} onDone={refetch} />}
          {me.role === 'admin' && pass.status === 'active' && pass.actualExit && !pass.dayScholarOuting && <AdminReturnOverride pass={pass} />}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Details" />
              {!mine && (
                <div className="mb-4 flex items-center gap-3">
                  <Avatar user={pass.student} />
                  <div>
                    <p className="font-bold">{displayName(pass.student)}</p>
                    <p className="text-xs muted">
                      {pass.student?.rollNo} · {pass.student?.department}
                      {pass.student?.year ? ` · Y${pass.student.year}` : ''}
                      {pass.student?.section ? ` · Sec ${pass.student.section}` : ''}
                    </p>
                  </div>
                </div>
              )}
              {isEmergency(pass) && (
                <div className="mb-4">
                  <EmergencyDetails pass={pass} />
                </div>
              )}
              {!isEmergency(pass) && (
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="label">Details</dt>
                  <dd>{pass.description}</dd>
                </div>
                {isOuting(pass) ? (
                  <>
                    <div>
                      <dt className="label">Subject</dt>
                      <dd>{pass.subject}</dd>
                    </div>
                    <div>
                      <dt className="label">Date (day scholar outing)</dt>
                      <dd>{fmtClassDay(pass.fromDate)}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <dt className="label">Where</dt>
                      <dd>{destinationLine(pass.destination)}</dd>
                    </div>
                    <div>
                      <dt className="label">From date</dt>
                      <dd>{fmtClassDay(pass.fromDate)}</dd>
                    </div>
                    <div>
                      <dt className="label">To date</dt>
                      <dd>{fmtClassDay(pass.toDate)}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt className="label">Parent's mobile{isOuting(pass) ? ' (entered by student)' : ''}</dt>
                  <dd>{pass.parentPhone}</dd>
                  {pass.parentPhoneDiffers && <p className="mt-0.5 text-xs font-semibold text-amber-600">Not the registered parent number</p>}
                </div>
                {isOuting(pass) && pass.supportingDocument?.url && (
                  <div>
                    <dt className="label">Attachment</dt>
                    <dd>
                      <a href={pass.supportingDocument.url} target="_blank" rel="noreferrer" className="break-all font-semibold text-primary-600 hover:underline">
                        {pass.supportingDocument.name || 'Attachment'}
                      </a>
                    </dd>
                  </div>
                )}
                {pass.principalReview?.by && (
                  <div>
                    <dt className="label">Approved by</dt>
                    <dd>{displayName(pass.principalReview.by)}</dd>
                  </div>
                )}
                {pass.rejectedReason && (
                  <div>
                    <dt className="label">Rejection reason ({pass.rejectedStage})</dt>
                    <dd>{pass.rejectedReason}</dd>
                  </div>
                )}
                {pass.revokeReason && (
                  <div>
                    <dt className="label">Revocation reason</dt>
                    <dd>{pass.revokeReason}</dd>
                  </div>
                )}
              </dl>
              )}
              {isEmergency(pass) && pass.emergencyReview?.by && (
                <p className="text-sm">
                  <span className="label">{pass.emergencyReview.action === 'rejected' ? 'Rejected by' : 'Approved by'}</span>
                  {displayName(pass.emergencyReview.by)} ({AUTHORITY_LABELS[pass.emergencyAuthority]})
                  {pass.rejectedReason ? ` — “${pass.rejectedReason}”` : ''}
                </p>
              )}
              <div className="mt-6">
                <PassTimeline pass={pass} />
              </div>
            </Card>
            {mine && ['approved', 'active'].includes(pass.status) && (
              <Card className="flex items-center justify-center">
                <PassQr pass={pass} />
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
