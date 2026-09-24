import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CalendarDays, Clock, Download, MapPin, Pencil, Star, Trash2, UserCheck, Users } from 'lucide-react';
import { useDeleteEventMutation, useGetEventQuery, useGetParticipantsQuery, useMarkAttendanceMutation } from '../../services/api';
import { Avatar, Badge, Button, Card, CardHeader, CategoryBadge, ErrorState, PageLoader, ProgressBar, cn } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import { RegisterButton, ReportButton } from '../../components/domain';
import EventForm from './EventForm';
import { catStyle } from '../../utils/constants';
import { errMsg, eventRange, fmtDateTime } from '../../utils/format';

function Participants({ eventId, isPast }) {
  const { data = [], isLoading } = useGetParticipantsQuery(eventId);
  const [mark] = useMarkAttendanceMutation();
  const confirmed = data.filter((r) => r.status !== 'waitlisted');
  const waitlist = data.filter((r) => r.status === 'waitlisted');

  const exportCsv = () => {
    const rows = [['Name', 'Email', 'Department', 'Year', 'Roll No', 'Status', 'Registered at']];
    data.forEach((r) =>
      rows.push([r.user?.name, r.user?.email, r.user?.department, r.user?.year, r.user?.rollNo, r.status, new Date(r.registeredAt).toISOString()])
    );
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `participants-${eventId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader
        title="Participants"
        subtitle={`${confirmed.length} confirmed · ${waitlist.length} waitlisted`}
        action={
          <Button variant="soft" size="sm" icon={Download} onClick={exportCsv} disabled={!data.length}>
            Export CSV
          </Button>
        }
      />
      {isLoading && <p className="text-sm muted">Loading…</p>}
      <div className="-mx-2 max-h-[420px] space-y-1 overflow-y-auto">
        {[...confirmed, ...waitlist].map((r) => (
          <div key={r.user?._id} className="flex items-center gap-3 rounded-2xl p-2 table-row">
            <Avatar user={r.user} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{r.user?.name}</p>
              <p className="truncate text-[11px] muted">
                {r.user?.department} {r.user?.year ? `· Y${r.user.year}` : ''}
              </p>
            </div>
            {r.status === 'waitlisted' ? (
              <Badge color="warning">waitlist</Badge>
            ) : (
              <button
                onClick={() =>
                  mark({ id: eventId, userId: r.user._id, attended: r.status !== 'attended' })
                    .unwrap()
                    .catch((e) => toast.error(errMsg(e)))
                }
                className={cn('chip', r.status === 'attended' && 'chip-active')}
                title={isPast ? 'Toggle attendance' : 'Mark attendance'}
              >
                <UserCheck className="h-3.5 w-3.5" /> {r.status === 'attended' ? 'Attended' : 'Mark present'}
              </button>
            )}
          </div>
        ))}
        {!isLoading && !data.length && <p className="px-2 text-sm muted">No registrations yet.</p>}
      </div>
    </Card>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: ev, isLoading, error, refetch } = useGetEventQuery(id);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [remove, { isLoading: deleting }] = useDeleteEventMutation();

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const style = catStyle(ev.category);

  return (
    <div className="space-y-6">
      <Link to="/events" className="inline-flex items-center gap-2 text-sm font-semibold muted hover:text-primary-600">
        <ArrowLeft className="h-4 w-4" /> All events
      </Link>

      <div className={cn('relative overflow-hidden rounded-[32px] bg-gradient-to-br', style.grad)}>
        {ev.poster && <img src={ev.poster} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="relative flex min-h-[260px] flex-col justify-end p-6 text-white sm:p-8">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold capitalize backdrop-blur">{ev.category}</span>
            {ev.isFeatured && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/90 px-3 py-1 text-xs font-bold text-amber-950">
                <Star className="h-3 w-3" /> Featured
              </span>
            )}
            {ev.isPast && <span className="rounded-full bg-black/40 px-3 py-1 text-xs font-bold">Ended</span>}
          </div>
          <h1 className="mt-3 max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">{ev.title}</h1>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/90">
            <span className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> {eventRange(ev.startDate, ev.endDate)}
            </span>
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4" /> {ev.venue}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="About this event" />
            <p className="whitespace-pre-line text-sm leading-relaxed muted">{ev.description}</p>
            {ev.tags?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {ev.tags.map((t) => (
                  <span key={t} className="chip">
                    #{t}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-6 flex items-center justify-between border-t border-white/60 pt-4 dark:border-white/10">
              <div className="flex items-center gap-3">
                <Avatar user={ev.organizer} size="sm" />
                <div>
                  <p className="text-xs muted">Organised by</p>
                  <p className="text-sm font-bold">
                    {ev.club ? (
                      <Link to={`/clubs/${ev.club.slug}`} className="hover:text-primary-600">
                        {ev.club.name}
                      </Link>
                    ) : (
                      ev.organizer?.name
                    )}
                  </p>
                </div>
              </div>
              <ReportButton targetType="event" targetId={ev._id} />
            </div>
          </Card>
          {ev.canManage && <Participants eventId={ev._id} isPast={ev.isPast} />}
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-28">
            <CategoryBadge category={ev.category} />
            <div className="mt-4 space-y-3 text-sm">
              <p className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-300">
                  <Users className="h-4 w-4" />
                </span>
                <span>
                  <b>{ev.registeredCount}</b> registered {ev.capacity ? `of ${ev.capacity}` : '· unlimited'}
                  {ev.waitlistCount > 0 && <span className="muted"> · {ev.waitlistCount} waiting</span>}
                </span>
              </p>
              {ev.registrationDeadline && (
                <p className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
                    <Clock className="h-4 w-4" />
                  </span>
                  <span>Registration closes {fmtDateTime(ev.registrationDeadline)}</span>
                </p>
              )}
            </div>
            {ev.capacity > 0 && <ProgressBar className="mt-4" value={ev.registeredCount} max={ev.capacity} />}
            <RegisterButton event={ev} size="lg" className="mt-5 w-full" />
            {ev.myStatus === 'waitlisted' && (
              <p className="mt-3 text-center text-xs muted">You will be moved in automatically when a seat frees up.</p>
            )}
            {ev.canManage && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button variant="outline" icon={Pencil} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      <EventForm open={editing} onClose={() => setEditing(false)} event={ev} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this event?"
        text="All registered students will be notified that the event is cancelled. This cannot be undone."
        confirmText="Delete event"
        loading={deleting}
        onConfirm={async () => {
          try {
            await remove(ev._id).unwrap();
            toast.success('Event deleted');
            navigate('/events');
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
