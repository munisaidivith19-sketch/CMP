import { Link, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { ArrowLeft, DoorOpen } from 'lucide-react';
import { useGetGatePassQuery } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Avatar, Card, CardHeader, ErrorState, PageHeader, Skeleton } from '../../components/ui/primitives';
import { StatusBadge } from '../../components/insights';
import { fmtDateTime, titleCase } from '../../utils/format';
import { PassQr, PassTimeline } from './GatePass';

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
          <PageHeader icon={DoorOpen} title={`${titleCase(pass.reason)} pass`} subtitle={`Requested ${fmtDateTime(pass.createdAt)}`} actions={<StatusBadge status={pass.status} />} />
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Details" />
              {!mine && (
                <div className="mb-4 flex items-center gap-3">
                  <Avatar user={pass.student} />
                  <div>
                    <p className="font-bold">{pass.student?.name}</p>
                    <p className="text-xs muted">
                      {pass.student?.rollNo} · {pass.student?.department}
                      {pass.student?.section ? ` · Sec ${pass.student.section}` : ''}
                    </p>
                  </div>
                </div>
              )}
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="label">Details</dt>
                  <dd>{pass.description}</dd>
                </div>
                <div>
                  <dt className="label">Destination</dt>
                  <dd>{pass.destination || '—'}</dd>
                </div>
                <div>
                  <dt className="label">Expected exit</dt>
                  <dd>{fmtDateTime(pass.expectedExit)}</dd>
                </div>
                <div>
                  <dt className="label">Expected return</dt>
                  <dd>{fmtDateTime(pass.expectedReturn)}</dd>
                </div>
                {pass.approvedBy && (
                  <div>
                    <dt className="label">Approved by</dt>
                    <dd>{pass.approvedBy.name}</dd>
                  </div>
                )}
                {pass.rejectedReason && (
                  <div>
                    <dt className="label">Rejection reason</dt>
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
