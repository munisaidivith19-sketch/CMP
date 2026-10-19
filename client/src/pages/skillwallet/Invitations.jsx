import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, Inbox, Mail, X } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Pagination, Skeleton, Tabs } from '../../components/ui/primitives';
import {
  useAcceptSwInvitationMutation,
  useCancelSwInvitationMutation,
  useDeclineSwInvitationMutation,
  useGetSwContactRequestsQuery,
  useGetSwInvitationsQuery,
  useRespondSwContactMutation,
} from '../../services/skillWallet';
import { displayName, errMsg, fmtDateTime, timeAgo } from '../../utils/format';
import { StatusBadge } from './components';

function InvitationList({ box }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useGetSwInvitationsQuery({ box, page });
  const [accept, { isLoading: a }] = useAcceptSwInvitationMutation();
  const [decline, { isLoading: d }] = useDeclineSwInvitationMutation();
  const [cancel, { isLoading: c }] = useCancelSwInvitationMutation();
  const act = (fn, msg) => async (id) => {
    try {
      await fn(id).unwrap();
      toast.success(msg);
    } catch (e) {
      toast.error(errMsg(e));
      refetch();
    }
  };

  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data.items.length) {
    return <Card><EmptyState icon={Inbox} title={box === 'sent' ? 'No invitations sent' : 'No invitations'} text={box === 'sent' ? 'Invite teammates from a team project’s page.' : 'When a classmate invites you to a team project, it appears here.'} /></Card>;
  }
  return (
    <>
      <div className="space-y-3">
        {data.items.map((inv) => {
          const open = inv.status === 'pending' && !inv.expired;
          return (
            <Card key={inv._id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  {inv.project?.deleted ? 'A deleted project' : inv.project?.title || 'Project'}
                </p>
                <p className="text-sm muted">
                  {box === 'sent' ? <>To {displayName(inv.invitee)} {inv.invitee?.department ? `· ${inv.invitee.department}` : ''}</> : <>From {displayName(inv.inviter)} {inv.inviter?.department ? `· ${inv.inviter.department}` : ''}</>}
                  {' · '}
                  {timeAgo(inv.createdAt)}
                </p>
                {inv.message && <p className="mt-1 text-sm">“{inv.message}”</p>}
                {open && <p className="mt-1 text-xs muted">Expires {fmtDateTime(inv.expiresAt)}</p>}
              </div>
              <StatusBadge kind="invite" status={inv.expired ? 'expired' : inv.status} />
              {open && box === 'received' && (
                <div className="flex gap-2">
                  <Button size="sm" variant="success" icon={Check} loading={a} onClick={() => act(accept, 'You joined the team')(inv._id)}>Accept</Button>
                  <Button size="sm" variant="outline" icon={X} loading={d} onClick={() => act(decline, 'Invitation declined')(inv._id)}>Decline</Button>
                </div>
              )}
              {open && box === 'sent' && <Button size="sm" variant="ghost" loading={c} onClick={() => act(cancel, 'Invitation cancelled')(inv._id)}>Cancel</Button>}
              {inv.status === 'accepted' && inv.project && !inv.project.deleted && box === 'received' && (
                <Button size="sm" variant="soft" to={`/skill-wallet/projects/${inv.project._id}`}>Open project</Button>
              )}
            </Card>
          );
        })}
      </div>
      <Pagination page={data.page} pages={data.pages} onChange={setPage} />
    </>
  );
}

function ContactRequests({ box }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useGetSwContactRequestsQuery({ box, page });
  const [respond, { isLoading: r }] = useRespondSwContactMutation();
  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data.items.length) return <Card><EmptyState icon={Mail} title="No contact requests" text="People who want to reach your team about a published project ask here. Your email is shared only if you accept." /></Card>;
  return (
    <>
      <div className="space-y-3">
        {data.items.map((cr) => (
          <Card key={cr._id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold">{cr.project ? <Link className="hover:underline" to={`/skill-wallet/gallery/${cr.project._id}`}>{cr.project.title}</Link> : 'Project'}</p>
              <p className="text-sm muted">{box === 'sent' ? 'To the team of' : 'From'} {displayName(cr.person)} · {timeAgo(cr.createdAt)}</p>
              <p className="mt-1 text-sm">“{cr.message}”</p>
              {cr.person?.email && <p className="mt-1 text-sm font-semibold">Email: <a className="text-primary-700 hover:underline dark:text-primary-300" href={`mailto:${cr.person.email}`}>{cr.person.email}</a></p>}
            </div>
            <StatusBadge kind="invite" status={cr.status} />
            {box === 'received' && cr.status === 'pending' && (
              <div className="flex gap-2">
                <Button size="sm" variant="success" loading={r} onClick={() => respond({ id: cr._id, decision: 'accept' }).unwrap().then(() => toast.success('Your college email was shared')).catch((e) => toast.error(errMsg(e)))}>Share my email</Button>
                <Button size="sm" variant="outline" loading={r} onClick={() => respond({ id: cr._id, decision: 'decline' }).unwrap().catch((e) => toast.error(errMsg(e)))}>Decline</Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <Pagination page={data.page} pages={data.pages} onChange={setPage} />
    </>
  );
}

export default function Invitations() {
  const [box, setBox] = useState('received');
  return (
    <div className="space-y-4">
      <Tabs
        value={box}
        onChange={setBox}
        tabs={[
          { value: 'received', label: 'Team invitations' },
          { value: 'sent', label: 'Sent' },
          { value: 'contact', label: 'Contact requests' },
          { value: 'contact-sent', label: 'My contact requests' },
        ]}
      />
      {box === 'received' || box === 'sent' ? <InvitationList key={box} box={box} /> : <ContactRequests key={box} box={box === 'contact' ? 'received' : 'sent'} />}
    </div>
  );
}
