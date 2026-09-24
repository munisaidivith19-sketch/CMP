import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BadgeCheck, Check, X } from 'lucide-react';
import { useGetClubsQuery, useReviewClubMutation } from '../../services/api';
import { Avatar, Button, Card, CategoryBadge, EmptyState, PageHeader, PageLoader, Tabs } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/form';
import { errMsg, timeAgo } from '../../utils/format';

export default function AdminClubs() {
  const [status, setStatus] = useState('pending');
  const [reviewing, setReviewing] = useState(null); // { club, status }
  const [note, setNote] = useState('');
  const { data, isLoading } = useGetClubsQuery({ status, limit: 50 });
  const [review, { isLoading: saving }] = useReviewClubMutation();

  const submit = async () => {
    try {
      await review({ id: reviewing.club._id, status: reviewing.status, note: note || undefined }).unwrap();
      toast.success(reviewing.status === 'approved' ? 'Club approved — it is now live' : 'Club rejected');
      setReviewing(null);
      setNote('');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div>
      <PageHeader icon={BadgeCheck} title="Club approvals" subtitle="Students request new clubs — review and approve them here." />
      <Tabs
        className="mb-5"
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
        ]}
      />
      {isLoading ? (
        <PageLoader />
      ) : !data?.items?.length ? (
        <Card>
          <EmptyState icon={BadgeCheck} title="Nothing to review" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.items.map((c) => (
            <Card key={c._id} className="flex flex-col gap-4 sm:flex-row">
              <Avatar name={c.name} src={c.logo} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/clubs/${c.slug}`} className="font-bold hover:text-primary-600">
                    {c.name}
                  </Link>
                  <CategoryBadge category={c.category} />
                </div>
                <p className="mt-1 line-clamp-3 text-sm muted">{c.description}</p>
                <p className="mt-2 text-xs muted">
                  Requested by <b>{c.createdBy?.name}</b> · {timeAgo(c.createdAt)}
                </p>
                {status === 'pending' && (
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" variant="success" icon={Check} onClick={() => setReviewing({ club: c, status: 'approved' })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="danger" icon={X} onClick={() => setReviewing({ club: c, status: 'rejected' })}>
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        size="sm"
        title={reviewing?.status === 'approved' ? `Approve ${reviewing?.club.name}?` : `Reject ${reviewing?.club.name}?`}
        subtitle="The requester is notified with your note."
        footer={
          <Button variant={reviewing?.status === 'approved' ? 'primary' : 'danger'} loading={saving} onClick={submit}>
            Confirm
          </Button>
        }
      >
        <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={300} />
      </Modal>
    </div>
  );
}
