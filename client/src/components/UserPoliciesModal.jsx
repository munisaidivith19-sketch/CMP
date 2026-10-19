import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck } from 'lucide-react';
import { Badge, Button, Skeleton } from './ui/primitives';
import { Modal } from './ui/Modal';
import PolicyEditor from './superadmin/PolicyEditor';
import { reportError, useReauth } from './superadmin/Reauth';
import { useGetUserPoliciesQuery, useSetUserPoliciesMutation } from '../services/superAdmin';
import { ROLE_LABELS } from '../utils/constants';
import { restrictCatalogue } from '../utils/delegation';
import { displayName, errMsg } from '../utils/format';

/**
 * Additional policies for one staff account (faculty, HOD, office, chairman…).
 * They only ADD admin-module access to the role. The server returns the
 * catalogue that may be given to this account and, for an Admin, its cap:
 * only those boxes are shown; anything else the account holds is kept as is.
 */
export default function UserPoliciesModal({ user, onClose }) {
  const open = Boolean(user);
  const { data, isLoading, error } = useGetUserPoliciesQuery(user?._id, { skip: !open });
  const [save, { isLoading: saving }] = useSetUserPoliciesMutation();
  const { guard, modal } = useReauth();
  const [policies, setPolicies] = useState([]);
  useEffect(() => {
    if (data) setPolicies(data.policies);
  }, [data]);
  const catalogue = useMemo(() => (data ? (data.cap ? restrictCatalogue(data.catalogue, data.cap) : data.catalogue) : {}), [data]);

  const submit = async () => {
    try {
      await guard(() => save({ id: user._id, policies }).unwrap());
      toast.success('Policies saved — effective on their next request');
      onClose();
    } catch (err) {
      reportError(err, 'Could not save policies'); // silent when the password prompt was cancelled
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={`Policies · ${displayName(user)}`}
        subtitle={`${ROLE_LABELS[user?.role] || user?.role || ''} — these add access on top of the role; nothing the role already allows is removed.`}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button icon={ShieldCheck} loading={saving} disabled={!data || Object.keys(catalogue).length === 0} onClick={submit}>Save policies</Button>
          </>
        }
      >
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : error ? (
          <p className="rounded-xl bg-amber-500/10 p-3 text-sm">{errMsg(error)}</p>
        ) : (
          <div className="space-y-3">
            {data?.hiddenActions > 0 && <Badge color="neutral">{data.hiddenActions} other permission(s) managed by a Super Admin</Badge>}
            {Object.keys(catalogue).length === 0 ? (
              <p className="text-sm">You have no permissions you may give to this account.</p>
            ) : (
              <PolicyEditor catalogue={catalogue} value={policies} onChange={setPolicies} />
            )}
            <p className="text-xs muted">
              Only Attendance (view, mark / edit), User Management, Staff Management (view), Security Logs and Activity Logs can be given to staff accounts.
              Changing roles, managing staff accounts and assigning policies always stay with Admins and the Super Admin.
            </p>
          </div>
        )}
      </Modal>
      {modal}
    </>
  );
}
