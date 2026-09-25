import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  Crown,
  Globe,
  Instagram,
  Linkedin,
  LogOut,
  Mail,
  Megaphone,
  Pencil,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  useCancelJoinMutation,
  useDeleteClubMutation,
  useGetClubQuery,
  useGetClubRequestsQuery,
  useHandleClubRequestMutation,
  useJoinClubMutation,
  useLeaveClubMutation,
  useRemoveClubMemberMutation,
  useSetClubMemberRoleMutation,
} from '../../services/api';
import { Avatar, Badge, Button, Card, CardHeader, CategoryBadge, EmptyState, ErrorState, PageLoader, Tabs, cn } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/form';
import { AnnouncementItem, ReportButton } from '../../components/domain';
import ClubForm from './ClubForm';
import EventForm from '../events/EventForm';
import AnnouncementForm from '../announcements/AnnouncementForm';
import { ClubInsights } from '../analytics/Insights';
import { selectUser } from '../../features/authSlice';
import { catStyle, ROLE_LABELS, STAFF_VIEW, STUDENT_ROLES } from '../../utils/constants';
import { errMsg, friendlyDay, fmtTime, timeAgo } from '../../utils/format';

function Requests({ club }) {
  const { data = [], isLoading } = useGetClubRequestsQuery(club._id);
  const [handle] = useHandleClubRequestMutation();
  const act = async (userId, action) => {
    try {
      const res = await handle({ id: club._id, userId, action }).unwrap();
      toast.success(res.message);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  if (isLoading) return <p className="text-sm muted">Loading…</p>;
  if (!data.length) return <EmptyState icon={UserPlus} title="No pending requests" text="New join requests will appear here." />;
  return (
    <div className="space-y-2">
      {data.map((r) => (
        <div key={r.user._id} className="flex flex-col gap-3 rounded-3xl bg-white/50 p-4 sm:flex-row sm:items-center dark:bg-white/[0.03]">
          <Avatar user={r.user} />
          <div className="min-w-0 flex-1">
            <Link to={`/people/${r.user._id}`} className="font-bold hover:text-primary-600">
              {r.user.name}
            </Link>
            <p className="text-xs muted">
              {r.user.department} {r.user.year ? `· Year ${r.user.year}` : ''} · {timeAgo(r.requestedAt)}
            </p>
            {r.message && <p className="mt-1 text-sm italic muted">“{r.message}”</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="success" icon={Check} onClick={() => act(r.user._id, 'approve')}>
              Approve
            </Button>
            <Button size="sm" variant="danger" icon={X} onClick={() => act(r.user._id, 'reject')}>
              Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Members({ club }) {
  const me = useSelector(selectUser);
  const [remove] = useRemoveClubMemberMutation();
  const [setRole] = useSetClubMemberRoleMutation();
  const adminIds = new Set(club.admins.map((a) => a._id));
  const run = (p, msg) =>
    p
      .unwrap()
      .then(() => toast.success(msg))
      .catch((e) => toast.error(errMsg(e)));

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {club.members.map((m) => {
        const isAdmin = adminIds.has(m._id);
        return (
          <div key={m._id} className="group flex items-center gap-3 rounded-3xl bg-white/50 p-3 transition-colors hover:bg-white/80 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]">
            <Avatar user={m} />
            <div className="min-w-0 flex-1">
              <Link to={`/people/${m._id}`} className="block truncate text-sm font-bold hover:text-primary-600">
                {m.name}
              </Link>
              <p className="truncate text-[11px] muted">{m.department || ROLE_LABELS[m.role]}</p>
            </div>
            {isAdmin && <Crown className="h-4 w-4 text-amber-500" title="Club admin" />}
            {club.isManager && m._id !== me._id && (
              <div className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                <button
                  className="btn-icon btn-ghost h-8 w-8"
                  title={isAdmin ? 'Remove admin role' : 'Make club admin'}
                  onClick={() => run(setRole({ id: club._id, userId: m._id, makeAdmin: !isAdmin }), 'Role updated')}
                >
                  <Shield className="h-4 w-4" />
                </button>
                <button
                  className="btn-icon btn-ghost h-8 w-8 hover:!text-rose-500"
                  title="Remove member"
                  onClick={() => run(remove({ id: club._id, userId: m._id }), 'Member removed')}
                >
                  <UserMinus className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ClubDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const me = useSelector(selectUser);
  const [search, setSearch] = useSearchParams();
  const tab = search.get('tab') || 'about';
  const { data: club, isLoading, error, refetch } = useGetClubQuery(slug);
  const [join, { isLoading: joining }] = useJoinClubMutation();
  const [cancelJoin] = useCancelJoinMutation();
  const [leave, { isLoading: leaving }] = useLeaveClubMutation();
  const [del, { isLoading: deleting }] = useDeleteClubMutation();
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinMsg, setJoinMsg] = useState('');
  const [editing, setEditing] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [posting, setPosting] = useState(false);
  const [confirm, setConfirm] = useState(null);

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const style = catStyle(club.category);
  const tabs = [
    { value: 'about', label: 'About' },
    { value: 'members', label: 'Members', count: club.memberCount },
    { value: 'events', label: 'Events', count: club.upcomingEvents.length },
    ...(club.isManager ? [{ value: 'requests', label: 'Requests', count: club.pendingCount }] : []),
    ...(club.isManager || STAFF_VIEW.includes(me.role) ? [{ value: 'insights', label: 'Insights' }] : []),
  ];
  const setTab = (t) => setSearch(t === 'about' ? {} : { tab: t });

  const doJoin = async () => {
    try {
      await join({ id: club._id, message: joinMsg }).unwrap();
      toast.success('Request sent! Club admins will review it.');
      setJoinOpen(false);
      setJoinMsg('');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/clubs" className="inline-flex items-center gap-2 text-sm font-semibold muted hover:text-primary-600">
        <ArrowLeft className="h-4 w-4" /> All clubs
      </Link>

      <Card className="overflow-hidden p-0">
        <div className={cn('relative h-44 bg-gradient-to-br sm:h-56', style.grad)}>
          {club.coverImage && <img src={club.coverImage} alt="" className="h-full w-full object-cover" />}
          <div className="absolute inset-0 opacity-30 [background:radial-gradient(circle_at_15%_30%,white_0,transparent_35%),radial-gradient(circle_at_85%_80%,white_0,transparent_30%)]" />
          {club.status !== 'approved' && (
            <Badge color="warning" className="absolute right-4 top-4 bg-white/90">
              {club.status}
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end">
          <Avatar name={club.name} src={club.logo} size="xl" ring className="-mt-12 rounded-[28px]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight">{club.name}</h1>
              <CategoryBadge category={club.category} />
            </div>
            {club.tagline && <p className="mt-1 text-sm muted">{club.tagline}</p>}
            <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold muted">
              <Users className="h-3.5 w-3.5" /> {club.memberCount} members
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {club.isManager && (
              <>
                <Button variant="soft" icon={CalendarPlus} onClick={() => setCreatingEvent(true)}>
                  Event
                </Button>
                <Button variant="soft" icon={Megaphone} onClick={() => setPosting(true)}>
                  Announce
                </Button>
                <Button variant="outline" icon={Pencil} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </>
            )}
            {club.status === 'approved' &&
              STUDENT_ROLES.includes(me.role) &&
              (club.isMember ? (
                <Button variant="outline" icon={LogOut} loading={leaving} onClick={() => setConfirm('leave')}>
                  Leave
                </Button>
              ) : club.hasRequested ? (
                <Button
                  variant="soft"
                  onClick={() =>
                    cancelJoin(club._id)
                      .unwrap()
                      .then(() => toast.success('Request withdrawn'))
                  }
                >
                  Requested · Withdraw
                </Button>
              ) : (
                <Button icon={UserPlus} onClick={() => setJoinOpen(true)}>
                  Join club
                </Button>
              ))}
            {me.role === 'admin' && (
              <Button variant="danger" icon={Trash2} onClick={() => setConfirm('delete')}>
                Delete
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'about' && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="About" />
            <p className="whitespace-pre-line text-sm leading-relaxed muted">{club.description}</p>
            {club.tags?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {club.tags.map((t) => (
                  <span key={t} className="chip">
                    #{t}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-6 border-t border-white/60 pt-5 dark:border-white/10">
              <h4 className="section-title mb-3">Club announcements</h4>
              <div className="space-y-3">
                {club.announcements.length ? (
                  club.announcements.map((a) => <AnnouncementItem key={a._id} a={{ ...a, audience: { scope: 'club', club } }} compact />)
                ) : (
                  <p className="text-sm muted">No announcements yet.</p>
                )}
              </div>
            </div>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Leadership" />
              <div className="space-y-3">
                {club.admins.map((a) => (
                  <Link key={a._id} to={`/people/${a._id}`} className="flex items-center gap-3 rounded-2xl p-1 hover:bg-white/50 dark:hover:bg-white/5">
                    <Avatar user={a} size="sm" />
                    <div>
                      <p className="text-sm font-bold">{a.name}</p>
                      <p className="text-[11px] muted">Club admin</p>
                    </div>
                  </Link>
                ))}
                {club.facultyAdvisor && (
                  <Link to={`/people/${club.facultyAdvisor._id}`} className="flex items-center gap-3 rounded-2xl p-1 hover:bg-white/50 dark:hover:bg-white/5">
                    <Avatar user={club.facultyAdvisor} size="sm" />
                    <div>
                      <p className="text-sm font-bold">{club.facultyAdvisor.name}</p>
                      <p className="text-[11px] muted">Faculty advisor</p>
                    </div>
                  </Link>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Connect" />
              <div className="space-y-2 text-sm">
                {club.contactEmail && (
                  <a href={`mailto:${club.contactEmail}`} className="flex items-center gap-2 hover:text-primary-600">
                    <Mail className="h-4 w-4" /> {club.contactEmail}
                  </a>
                )}
                {[
                  [club.socialLinks?.website, Globe, 'Website'],
                  [club.socialLinks?.instagram, Instagram, 'Instagram'],
                  [club.socialLinks?.linkedin, Linkedin, 'LinkedIn'],
                ]
                  .filter(([url]) => url && /^https?:\/\//.test(url))
                  .map(([url, Icon, label]) => (
                    <a key={label} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-primary-600">
                      <Icon className="h-4 w-4" /> {label}
                    </a>
                  ))}
                <div className="pt-2">
                  <ReportButton targetType="club" targetId={club._id} label="Report club" />
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'members' && (
        <Card>
          <Members club={club} />
        </Card>
      )}

      {tab === 'events' && (
        <Card>
          <CardHeader title="Upcoming events" />
          {club.upcomingEvents.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {club.upcomingEvents.map((e) => (
                <Link key={e._id} to={`/events/${e._id}`} className="rounded-3xl bg-white/50 p-4 transition-all hover:-translate-y-0.5 hover:bg-white/80 dark:bg-white/[0.03]">
                  <CategoryBadge category={e.category} />
                  <p className="mt-2 font-bold">{e.title}</p>
                  <p className="text-xs muted">
                    {friendlyDay(e.startDate)} · {fmtTime(e.startDate)} · {e.venue}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={CalendarPlus} title="No upcoming events" />
          )}
        </Card>
      )}

      {tab === 'insights' && (club.isManager || STAFF_VIEW.includes(me.role)) && <ClubInsights clubId={club._id} />}

      {tab === 'requests' && club.isManager && (
        <Card>
          <CardHeader title="Membership requests" subtitle="Approve students who want to join" />
          <Requests club={club} />
        </Card>
      )}

      <Modal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        title={`Join ${club.name}`}
        subtitle="Tell the club admins a bit about yourself (optional)."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setJoinOpen(false)}>
              Cancel
            </Button>
            <Button loading={joining} onClick={doJoin}>
              Send request
            </Button>
          </>
        }
      >
        <Textarea value={joinMsg} onChange={(e) => setJoinMsg(e.target.value)} maxLength={300} rows={3} placeholder="Why do you want to join?" />
      </Modal>

      <ConfirmDialog
        open={confirm === 'leave'}
        onClose={() => setConfirm(null)}
        title={`Leave ${club.name}?`}
        confirmText="Leave club"
        loading={leaving}
        onConfirm={async () => {
          try {
            await leave(club._id).unwrap();
            toast.success('You left the club');
            setConfirm(null);
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title="Delete this club permanently?"
        text="Members will be removed and club events will become college events."
        confirmText="Delete club"
        loading={deleting}
        onConfirm={async () => {
          try {
            await del(club._id).unwrap();
            toast.success('Club deleted');
            navigate('/clubs');
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />

      <ClubForm open={editing} onClose={() => setEditing(false)} club={club} />
      <EventForm open={creatingEvent} onClose={() => setCreatingEvent(false)} defaultClub={club._id} />
      <AnnouncementForm open={posting} onClose={() => setPosting(false)} defaultClub={club._id} />
    </div>
  );
}
