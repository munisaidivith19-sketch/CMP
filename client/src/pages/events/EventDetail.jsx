import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CalendarDays, Clock, Download, GraduationCap, MapPin, Maximize2, Pencil, Star, Trash2, UserCheck, Users } from 'lucide-react';
import { useDeleteEventMutation, useGetEventQuery, useGetParticipantsQuery, useMarkAttendanceMutation } from '../../services/api';
import { Avatar, Badge, Button, Card, CardHeader, CategoryBadge, ErrorState, PageLoader, ProgressBar, cn } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { RegisterButton, ReportButton } from '../../components/domain';
import EventForm from './EventForm';
import { catStyle } from '../../utils/constants';
import { errMsg, eventRange, fmtDateTime, displayName } from '../../utils/format';
import { downloadEventParticipantsPdf } from '../../services/reports';

function Participants({ eventId, isPast, canMarkAttendance }) {
  const { data = [], isLoading } = useGetParticipantsQuery(eventId);
  const [mark] = useMarkAttendanceMutation();
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const confirmed = data.filter((r) => r.status !== 'waitlisted');
  const waitlist = data.filter((r) => r.status === 'waitlisted');

  const handleDownloadPdf = async () => {
    try {
      setDownloadingPdf(true);
      await downloadEventParticipantsPdf(eventId);
      toast.success('Participants PDF downloaded');
    } catch (e) {
      toast.error(errMsg(e) || 'Failed to download PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Event Participants"
        subtitle={
          `${confirmed.length} confirmed · ${waitlist.length} waitlisted` +
          (!canMarkAttendance ? ' · (Attendance marked by assigned Faculty Coordinators)' : '')
        }
        action={
          <Button
            variant="soft"
            size="sm"
            icon={Download}
            onClick={handleDownloadPdf}
            loading={downloadingPdf}
            disabled={!data.length}
            title="Download event participants list as PDF with official college logo"
          >
            Download PDF
          </Button>
        }
      />
      {isLoading && <p className="text-sm muted">Loading participants…</p>}
      <div className="-mx-2 max-h-[420px] space-y-1 overflow-y-auto">
        {[...confirmed, ...waitlist].map((r) => (
          <div key={r.user?._id} className="flex items-center gap-3 rounded-2xl p-2.5 table-row">
            <Avatar user={r.user} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{displayName(r.user)}</p>
              <p className="truncate text-[11px] muted">
                {r.user?.department} {r.user?.year ? `· Y${r.user.year}` : ''} {r.user?.rollNo ? `(${r.user.rollNo})` : ''}
              </p>
            </div>
            {r.status === 'waitlisted' ? (
              <Badge color="warning">Waitlist</Badge>
            ) : canMarkAttendance ? (
              <button
                type="button"
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
            ) : (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold',
                  r.status === 'attended'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                    : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20'
                )}
              >
                <UserCheck className="h-3 w-3" /> {r.status === 'attended' ? 'Attended' : 'Registered'}
              </span>
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
  const [viewingPoster, setViewingPoster] = useState(false);
  const [remove, { isLoading: deleting }] = useDeleteEventMutation();

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const style = catStyle(ev.category);

  return (
    <div className="space-y-6">
      <Link to="/events" className="inline-flex items-center gap-2 text-sm font-semibold muted hover:text-primary-600 transition-colors">
        <ArrowLeft className="h-4 w-4" /> All events
      </Link>

      {/* 2-Column Split Hero Banner */}
      <div className={cn('relative overflow-hidden rounded-[32px] bg-gradient-to-br shadow-xl p-6 sm:p-8 lg:p-10 text-white', style.grad)}>
        {ev.poster && (
          <img src={ev.poster} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-3xl" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-black/40 backdrop-blur-[2px]" />

        <div className="relative z-10 grid gap-8 lg:grid-cols-12 lg:items-center">
          {/* Left Column: Event Title, Date, Venue, and Faculty Coordinators */}
          <div className="space-y-4 lg:col-span-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/20 px-3.5 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur-md">
                {ev.category}
              </span>
              {ev.isFeatured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-amber-950 shadow-sm">
                  <Star className="h-3 w-3 fill-amber-950" /> Featured
                </span>
              )}
              {ev.isPast && <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-bold">Ended</span>}
            </div>

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight leading-tight">{ev.title}</h1>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/90">
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <CalendarDays className="h-4 w-4 text-white/80" /> {eventRange(ev.startDate, ev.endDate)}
              </span>
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <MapPin className="h-4 w-4 text-white/80" /> {ev.venue}
              </span>
            </div>

            {/* Dedicated Faculty Coordinators Showcase Card */}
            <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-md dark:border-white/10 dark:bg-black/30">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/90">
                <GraduationCap className="h-4 w-4 text-amber-300" />
                <span>Faculty Coordinators</span>
              </div>
              {ev.facultyCoordinators && ev.facultyCoordinators.length > 0 ? (
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  {ev.facultyCoordinators.map((fc) => (
                    <div
                      key={fc._id}
                      className="flex items-center gap-3 rounded-xl bg-white/15 p-2.5 backdrop-blur-sm border border-white/10 dark:bg-white/5"
                    >
                      <Avatar user={fc} size="sm" className="ring-2 ring-white/30" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-white">{fc.name}</p>
                        <p className="truncate text-xs text-white/80">
                          <span className="font-semibold text-amber-200">[{fc.department || 'General'}]</span>{' '}
                          {fc.designation || 'Faculty'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-white/70 italic">
                  Directly coordinated by Department HOD ({ev.organizer?.name || 'Department'}).
                </p>
              )}
            </div>
          </div>

          {/* Right Column: Compact Poster Preview Card */}
          <div className="flex items-center justify-center lg:col-span-5 lg:justify-end">
            {ev.poster ? (
              <div className="group relative w-full max-w-[340px] sm:max-w-[380px] overflow-hidden rounded-2xl border border-white/20 bg-black/40 shadow-2xl backdrop-blur-sm transition-transform hover:scale-[1.02]">
                <img
                  src={ev.poster}
                  alt={`${ev.title} poster`}
                  className="h-[320px] sm:h-[360px] w-full object-contain"
                />
                <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/80 via-transparent to-transparent p-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setViewingPoster(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-black shadow-lg hover:bg-white/95 active:scale-95 transition-all"
                  >
                    <Maximize2 className="h-4 w-4" /> View Full Poster
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingPoster(true)}
                  className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white/90 backdrop-blur-md hover:bg-black/90 hover:text-white transition-colors"
                  title="Open full poster"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex h-[240px] w-full max-w-[340px] flex-col items-center justify-center rounded-2xl border border-white/20 bg-white/5 p-6 text-center text-white/70 backdrop-blur-sm">
                <CalendarDays className="mb-3 h-12 w-12 text-white/40" />
                <p className="text-sm font-semibold">Campus Event</p>
                <p className="mt-1 text-xs text-white/50">Official College & Department Session</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content & Sidebar Grid */}
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

          {/* Participants Roster: Visible to all faculties, HODs, Principal, and higher authorities */}
          {ev.canViewParticipants && (
            <Participants eventId={ev._id} isPast={ev.isPast} canMarkAttendance={Boolean(ev.canMarkAttendance)} />
          )}
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

            {/* Management Actions: strictly for Principal, Admin, and the HOD who posted the event */}
            {ev.canEdit && (
              <div className="mt-5 grid grid-cols-2 gap-2 border-t border-ink/10 pt-4 dark:border-white/10">
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

      {/* Poster Lightbox Modal */}
      {viewingPoster && ev.poster && (
        <Modal open={viewingPoster} onClose={() => setViewingPoster(false)} size="xl" title={`${ev.title} — Event Poster`}>
          <div className="flex justify-center p-2 bg-slate-950/40 rounded-2xl">
            <img src={ev.poster} alt={ev.title} className="max-h-[75vh] w-auto rounded-xl object-contain shadow-2xl" />
          </div>
        </Modal>
      )}

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
