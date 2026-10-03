import { useState } from 'react';
import { useSelector } from 'react-redux';
import {
  ShieldCheck,
  Check,
  X,
  AlertTriangle,
  Building,
  GraduationCap,
  Mail,
  Clock,
  Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { selectUser } from '../../features/authSlice';
import {
  useGetAlumniQuery,
  useVerifyAlumniProfileMutation,
  useRejectAlumniProfileMutation,
} from '../../services/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
} from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Field, Textarea } from '../../components/ui/form';

export default function AlumniVerificationTab() {
  const currentUser = useSelector(selectUser);
  const isHOD = currentUser?.role === 'hod';

  const [search, setSearch] = useState('');
  const [rejectModalItem, setRejectModalItem] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  // Fetch unverified alumni profiles
  const { data, isLoading, refetch } = useGetAlumniQuery({
    unverified: true,
    search: search.trim() || undefined,
  });

  const [verifyProfile, { isLoading: isVerifying }] = useVerifyAlumniProfileMutation();
  const [rejectProfile, { isLoading: isRejecting }] = useRejectAlumniProfileMutation();

  const unverifiedList = data?.alumni || [];

  const handleVerify = async (id, name) => {
    try {
      await verifyProfile(id).unwrap();
      toast.success(`${name}'s alumni profile verified successfully!`);
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to verify profile');
    }
  };

  const handleReject = async (e) => {
    e.preventDefault();
    if (!rejectModalItem || rejectReason.trim().length < 5) {
      toast.error('Please provide a reason (at least 5 characters)');
      return;
    }
    try {
      await rejectProfile({ id: rejectModalItem._id, reason: rejectReason.trim() }).unwrap();
      toast.success('Profile rejected. Notification sent to alumni member.');
      setRejectModalItem(null);
      setRejectReason('');
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to reject profile');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Search */}
      <Card className="p-5 sm:p-6 bg-gradient-to-r from-emerald-500/10 via-primary-500/10 to-transparent">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-base font-bold">Alumni Verification Queue</h3>
              {unverifiedList.length > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                  {unverifiedList.length} Pending
                </span>
              )}
            </div>
            <p className="text-xs muted mt-1">
              {isHOD
                ? `Reviewing alumni credentials for the ${currentUser?.department} Department.`
                : 'Campus-wide verification queue for all registered alumni members.'}
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search pending queue..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 text-xs"
            />
          </div>
        </div>
      </Card>

      {/* Queue Table */}
      {isLoading ? (
        <Card className="p-5 space-y-3">
          <Skeleton className="h-6 w-1/4" />
          <Skeleton className="h-32 w-full" />
        </Card>
      ) : unverifiedList.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="All Caught Up!"
          text="There are no alumni profiles currently awaiting verification."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-white/5 uppercase text-[10px] font-bold text-slate-500">
                <tr>
                  <th className="p-4">Alumni Member</th>
                  <th className="p-4">Department & Class</th>
                  <th className="p-4">Company & Designation</th>
                  <th className="p-4">Submitted Date</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {unverifiedList.map((item) => {
                  const u = item.user || {};
                  return (
                    <tr key={item._id} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <Avatar user={u} size="sm" />
                          <div>
                            <p className="font-bold text-ink">{u.name}</p>
                            <p className="text-slate-400 text-[11px]">{u.email}</p>
                          </div>
                        </div>
                      </td>

                      <td className="p-4">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {u.department}
                        </span>
                        <p className="text-slate-400 text-[11px]">Class of {item.gradYear || u.year || '—'}</p>
                      </td>

                      <td className="p-4">
                        <p className="font-semibold text-primary-600 dark:text-primary-400">
                          {item.company || '—'}
                        </p>
                        <p className="text-slate-500 text-[11px]">{item.designation || 'Alumni'}</p>
                      </td>

                      <td className="p-4 text-slate-400 text-[11px]">
                        {new Date(item.updatedAt || item.createdAt).toLocaleDateString()}
                      </td>

                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            loading={isVerifying}
                            onClick={() => handleVerify(item._id, u.name)}
                            className="text-xs font-bold"
                          >
                            <Check className="mr-1 h-3.5 w-3.5" /> Verify
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRejectModalItem(item);
                              setRejectReason('');
                            }}
                            className="text-xs text-rose-600"
                          >
                            <X className="mr-1 h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Reject Modal */}
      {rejectModalItem && (
        <Modal
          open={!!rejectModalItem}
          onClose={() => setRejectModalItem(null)}
          title="Reject Alumni Profile"
          subtitle={`Member: ${rejectModalItem.user?.name} (${rejectModalItem.user?.email})`}
          size="sm"
        >
          <form onSubmit={handleReject} className="space-y-4">
            <Field
              label="Rejection Reason"
              hint="Please explain what details need correction (min 5 chars). The alumni will see this reason."
              required
            >
              <Textarea
                rows={3}
                placeholder="e.g. Graduation year does not match college registry records. Please resubmit with correct batch."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                required
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setRejectModalItem(null)}>
                Cancel
              </Button>
              <Button variant="danger" type="submit" loading={isRejecting}>
                Confirm Rejection
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
