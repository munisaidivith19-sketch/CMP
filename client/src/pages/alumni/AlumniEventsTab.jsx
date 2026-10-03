import { useState } from 'react';
import { useSelector } from 'react-redux';
import {
  CalendarDays,
  MapPin,
  Video,
  Clock,
  Plus,
  Users,
  CheckCircle,
  AlertTriangle,
  Download,
  Check,
  X,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { selectUser } from '../../features/authSlice';
import {
  useGetAlumniEventsQuery,
  useCreateAlumniEventMutation,
  useApproveAlumniEventMutation,
  useRejectAlumniEventMutation,
  useCancelAlumniEventMutation,
  useRsvpEventMutation,
  useCancelRsvpMutation,
  useGetAttendeesQuery,
  useCheckInAttendeeMutation,
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
import { Field, Input, Select, Textarea } from '../../components/ui/form';

const EVENT_TYPE_LABELS = {
  reunion: 'Batch Reunion',
  webinar: 'Online Webinar',
  guest_talk: 'Guest Speaker Talk',
  networking: 'Networking Meetup',
  workshop: 'Hands-on Workshop',
  other: 'Special Event',
};

export default function AlumniEventsTab() {
  const currentUser = useSelector(selectUser);
  const isStaff = ['admin', 'hod', 'principal', 'dean', 'chairman'].includes(currentUser?.role);
  const canHost = ['alumni', 'faculty', 'hod', 'admin'].includes(currentUser?.role);

  const [segment, setSegment] = useState('upcoming');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [hostModalOpen, setHostModalOpen] = useState(false);

  // New Event Form State
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('webinar');
  const [newMode, setNewMode] = useState('online');
  const [newStartsAt, setNewStartsAt] = useState('');
  const [newEndsAt, setNewEndsAt] = useState('');
  const [newVenue, setNewVenue] = useState('');
  const [newMeetingLink, setNewMeetingLink] = useState('');
  const [newCapacity, setNewCapacity] = useState('100');
  const [newDescription, setNewDescription] = useState('');

  // RTK Query
  const { data: eventsData, isLoading } = useGetAlumniEventsQuery({ when: segment });
  const events = Array.isArray(eventsData) ? eventsData : eventsData?.items || [];
  const [createEvent, { isLoading: isHosting }] = useCreateAlumniEventMutation();
  const [approveEvent] = useApproveAlumniEventMutation();
  const [rejectEvent] = useRejectAlumniEventMutation();
  const [cancelEvent] = useCancelAlumniEventMutation();
  const [rsvpEvent, { isLoading: isRsvping }] = useRsvpEventMutation();
  const [cancelRsvp] = useCancelRsvpMutation();
  const [checkInAttendee] = useCheckInAttendeeMutation();

  // Attendees list for selected event
  const isOrganizerOrStaff =
    selectedEvent &&
    (selectedEvent.organizer?._id === currentUser?._id ||
      selectedEvent.organizer === currentUser?._id ||
      isStaff);

  const { data: attendeesData = {}, refetch: refetchAttendees } = useGetAttendeesQuery(
    selectedEvent?._id,
    { skip: !isOrganizerOrStaff }
  );

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!newStartsAt || !newEndsAt) {
      toast.error('Please specify both start and end times');
      return;
    }
    if (new Date(newEndsAt) <= new Date(newStartsAt)) {
      toast.error('End time must be after start time');
      return;
    }
    try {
      await createEvent({
        title: newTitle.trim(),
        type: newType,
        mode: newMode,
        startsAt: new Date(newStartsAt).toISOString(),
        endsAt: new Date(newEndsAt).toISOString(),
        venue: newVenue.trim() || undefined,
        meetingLink: newMeetingLink.trim() || undefined,
        capacity: Number(newCapacity) || 0,
        description: newDescription.trim(),
      }).unwrap();
      toast.success(
        isStaff
          ? 'Event scheduled and published!'
          : 'Event proposal submitted for admin/department approval.'
      );
      setHostModalOpen(false);
      setNewTitle('');
      setNewDescription('');
      setNewVenue('');
      setNewMeetingLink('');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to create event');
    }
  };

  const handleRsvp = async (eventId) => {
    try {
      const res = await rsvpEvent(eventId).unwrap();
      if (res.status === 'waitlisted') {
        toast('Capacity reached: You have been placed on the waitlist!', { icon: '⏳' });
      } else {
        toast.success('RSVP confirmed! Meeting details unlocked.');
      }
      setSelectedEvent(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to RSVP');
    }
  };

  const handleCancelRsvp = async (eventId) => {
    try {
      await cancelRsvp(eventId).unwrap();
      toast.success('RSVP cancelled. Next waitlisted attendee has been promoted!');
      setSelectedEvent(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to cancel RSVP');
    }
  };

  const handleCheckIn = async (userId) => {
    try {
      await checkInAttendee({ id: selectedEvent._id, userId }).unwrap();
      toast.success('Attendee checked in!');
      refetchAttendees();
    } catch (err) {
      toast.error(err?.data?.message || 'Check-in failed');
    }
  };

  const exportAttendeesCSV = () => {
    if (!attendeesData?.attendees?.length) return;
    const rows = [
      ['Name', 'Email', 'Role', 'Status', 'Checked In At'],
      ...attendeesData.attendees.map((a) => [
        a.user?.name || '',
        a.user?.email || '',
        a.user?.role || '',
        a.status,
        a.checkedInAt ? new Date(a.checkedInAt).toLocaleString() : 'No',
      ]),
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${selectedEvent.title.replace(/\s+/g, '_')}_attendees.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Top Controls */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="glass inline-flex gap-1 overflow-x-auto rounded-2xl p-1 scrollbar-none">
            {[
              { id: 'upcoming', label: 'Upcoming' },
              { id: 'past', label: 'Past Events' },
              { id: 'mine', label: 'My RSVPs' },
              ...(isStaff ? [{ id: 'pending', label: 'Pending Approval' }] : []),
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSegment(tab.id)}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                  segment === tab.id
                    ? 'bg-white text-primary-600 shadow-soft dark:bg-white/10 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {canHost && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setHostModalOpen(true)}
              className="shrink-0 font-bold"
            >
              <Plus className="mr-1 h-4 w-4" /> Host an Event
            </Button>
          )}
        </div>
      </Card>

      {/* Events Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
            </Card>
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No Events Found"
          text={`There are no ${segment} alumni events to show.`}
          action={
            canHost && (
              <Button variant="primary" size="sm" onClick={() => setHostModalOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Host First Event
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => {
            const start = new Date(event.startsAt);
            const month = start.toLocaleString('default', { month: 'short' });
            const day = start.getDate();
            const time = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const isGoing = event.myRsvp?.status === 'going';
            const isWaitlisted = event.myRsvp?.status === 'waitlisted';

            return (
              <Card
                key={event._id}
                hover
                onClick={() => setSelectedEvent(event)}
                className="flex flex-col justify-between border border-slate-200/70 p-5 transition-all duration-300 hover:shadow-lg dark:border-white/10"
              >
                <div>
                  {/* Date Block and Type */}
                  <div className="flex items-start gap-4">
                    <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500/10 to-primary-600/20 text-center font-extrabold text-primary-600 dark:text-primary-400">
                      <span className="text-[10px] uppercase tracking-wider">{month}</span>
                      <span className="text-xl leading-none">{day}</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Badge color={event.mode === 'online' ? 'info' : 'primary'}>
                          {event.mode === 'online' ? <Video className="h-3 w-3 mr-0.5" /> : null}
                          {event.mode}
                        </Badge>
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          {EVENT_TYPE_LABELS[event.type] || event.type}
                        </span>
                      </div>
                      <h3 className="mt-1 line-clamp-1 text-base font-bold text-ink dark:text-white hover:text-primary-600 dark:hover:text-primary-400">
                        {event.title}
                      </h3>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <Clock className="h-3 w-3" /> {time}
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 line-clamp-2 text-xs text-slate-600 leading-relaxed dark:text-slate-300">
                    {event.description}
                  </p>

                  {event.venue && (
                    <p className="mt-2 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="line-clamp-1">{event.venue}</span>
                    </p>
                  )}
                </div>

                {/* Bottom Capacity & RSVP Status */}
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs dark:border-white/5">
                  <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                    <Users className="h-3.5 w-3.5" />
                    <span className="font-semibold">{event.goingCount || 0} attending</span>
                    {event.capacity > 0 && (
                      <span className="text-slate-400">({event.spotsLeft} spots left)</span>
                    )}
                  </div>

                  <div>
                    {isGoing ? (
                      <span className="flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle className="h-3.5 w-3.5" /> You're Going
                      </span>
                    ) : isWaitlisted ? (
                      <span className="font-bold text-amber-600 dark:text-amber-400">
                        Waitlisted
                      </span>
                    ) : event.status === 'scheduled' ? (
                      <span className="font-bold text-primary-600 hover:underline">
                        View Details →
                      </span>
                    ) : (
                      <Badge color="warning">{event.status}</Badge>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Host Event Modal */}
      <Modal
        open={hostModalOpen}
        onClose={() => setHostModalOpen(false)}
        title="Host Alumni Event"
        subtitle="Organize a webinar, guest lecture, reunion, or workshop"
        size="lg"
      >
        <form onSubmit={handleCreateEvent} className="space-y-4">
          <Field label="Event Title" required>
            <Input
              placeholder="e.g. AI Systems at Scale: Industry Perspectives"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Event Type">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="input text-sm"
              >
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Event Format / Mode">
              <select
                value={newMode}
                onChange={(e) => setNewMode(e.target.value)}
                className="input text-sm"
              >
                <option value="online">Online / Virtual Meeting</option>
                <option value="in_person">In-Person on Campus</option>
                <option value="hybrid">Hybrid (Campus + Stream)</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Starts At" required>
              <input
                type="datetime-local"
                value={newStartsAt}
                onChange={(e) => setNewStartsAt(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                className="input text-sm"
                required
              />
            </Field>

            <Field label="Ends At" required>
              <input
                type="datetime-local"
                value={newEndsAt}
                onChange={(e) => setNewEndsAt(e.target.value)}
                min={newStartsAt || new Date().toISOString().slice(0, 16)}
                className="input text-sm"
                required
              />
            </Field>
          </div>

          {newMode !== 'online' && (
            <Field label="Campus Venue / Room">
              <Input
                placeholder="e.g. Mechanical Seminar Hall / Tech Auditorium"
                value={newVenue}
                onChange={(e) => setNewVenue(e.target.value)}
              />
            </Field>
          )}

          {newMode !== 'in_person' && (
            <Field label="Virtual Meeting Link (Google Meet / Zoom / Teams)">
              <Input
                type="url"
                placeholder="https://meet.google.com/xyz-abcd-efg"
                value={newMeetingLink}
                onChange={(e) => setNewMeetingLink(e.target.value)}
              />
            </Field>
          )}

          <Field label="Attendee Capacity (0 for unlimited)">
            <Input
              type="number"
              min="0"
              value={newCapacity}
              onChange={(e) => setNewCapacity(e.target.value)}
            />
          </Field>

          <Field label="Event Description & Key Agenda" required>
            <Textarea
              rows={4}
              placeholder="Outline the agenda, topics covered, target audience, and what attendees will learn..."
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              required
            />
          </Field>

          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" type="button" onClick={() => setHostModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={isHosting}>
              Submit Event Proposal
            </Button>
          </div>
        </form>
      </Modal>

      {/* Event Details & Attendees Modal */}
      {selectedEvent && (
        <Modal
          open={!!selectedEvent}
          onClose={() => setSelectedEvent(null)}
          title={selectedEvent.title}
          subtitle={`${EVENT_TYPE_LABELS[selectedEvent.type] || selectedEvent.type} • ${selectedEvent.mode}`}
          size="lg"
        >
          <div className="space-y-6">
            {/* Time & Venue Banner */}
            <div className="rounded-2xl bg-primary-50/70 p-4 text-xs dark:bg-primary-500/10">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary-600" />
                  <div>
                    <p className="font-bold text-slate-800 dark:text-slate-200">
                      {new Date(selectedEvent.startsAt).toLocaleString()}
                    </p>
                    <p className="muted">to {new Date(selectedEvent.endsAt).toLocaleTimeString()}</p>
                  </div>
                </div>

                {selectedEvent.venue && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary-600" />
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-200">Venue</p>
                      <p className="muted">{selectedEvent.venue}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Revealed Meeting Link (only for Going RSVPs / organizers / staff) */}
            {selectedEvent.meetingLink && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50/50 p-4 dark:bg-emerald-500/10">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-emerald-800 dark:text-emerald-300">
                      Video Meeting Link Unlocked
                    </p>
                    <p className="text-xs text-emerald-700/80 dark:text-emerald-400">
                      Join the call at the scheduled event start time.
                    </p>
                  </div>
                  <a
                    href={selectedEvent.meetingLink}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary btn-sm flex items-center gap-1 font-bold"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Join Meeting
                  </a>
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                About this Event
              </h4>
              <p className="whitespace-pre-line text-sm text-slate-700 leading-relaxed dark:text-slate-300">
                {selectedEvent.description}
              </p>
            </div>

            {/* RSVP Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-white/5">
              <div className="flex items-center gap-2 text-xs">
                <Users className="h-4 w-4 text-slate-400" />
                <span className="font-bold">{selectedEvent.goingCount || 0} attending</span>
                {selectedEvent.capacity > 0 && (
                  <span className="muted">
                    ({selectedEvent.spotsLeft} remaining of {selectedEvent.capacity} capacity)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {selectedEvent.myRsvp?.status === 'going' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-rose-600 text-xs"
                    onClick={() => handleCancelRsvp(selectedEvent._id)}
                  >
                    Cancel RSVP
                  </Button>
                ) : selectedEvent.myRsvp?.status === 'waitlisted' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-rose-600 text-xs"
                    onClick={() => handleCancelRsvp(selectedEvent._id)}
                  >
                    Leave Waitlist
                  </Button>
                ) : selectedEvent.status === 'scheduled' ? (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={isRsvping}
                    onClick={() => handleRsvp(selectedEvent._id)}
                  >
                    {selectedEvent.spotsLeft > 0 || selectedEvent.capacity === 0
                      ? 'RSVP (Going)'
                      : 'Join Waitlist'}
                  </Button>
                ) : null}
              </div>
            </div>

            {/* Staff Approval Actions (if pending) */}
            {isStaff && selectedEvent.status === 'pending_approval' && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-50/50 p-4 dark:bg-amber-500/5">
                <p className="text-xs font-bold text-amber-800 dark:text-amber-200 mb-2">
                  Staff Approval Queue
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      await approveEvent(selectedEvent._id);
                      toast.success('Event approved and scheduled!');
                      setSelectedEvent(null);
                    }}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" /> Approve Event
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-rose-600"
                    onClick={async () => {
                      const reason = window.prompt('Reason for rejecting event proposal:');
                      if (!reason) return;
                      await rejectEvent({ id: selectedEvent._id, reason });
                      toast.success('Event rejected');
                      setSelectedEvent(null);
                    }}
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Reject Proposal
                  </Button>
                </div>
              </div>
            )}

            {/* Attendees and Check-In (Organizer / Staff View) */}
            {isOrganizerOrStaff && (
              <div className="border-t border-slate-100 pt-4 dark:border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold flex items-center gap-2">
                    <Users className="h-4 w-4" /> Attendee Roster & Check-In
                  </h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportAttendeesCSV}
                    disabled={!attendeesData?.attendees?.length}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" /> Export CSV
                  </Button>
                </div>

                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5 rounded-2xl border border-slate-200 dark:border-white/10">
                  {attendeesData?.attendees?.length === 0 ? (
                    <p className="p-4 text-center text-xs muted">No RSVPs recorded yet.</p>
                  ) : (
                    attendeesData.attendees.map((item) => (
                      <div
                        key={item._id}
                        className="p-3 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <Avatar user={item.user} size="xs" />
                          <div>
                            <p className="font-bold">{item.user?.name}</p>
                            <p className="muted text-[11px]">
                              {item.user?.department} • {item.user?.role}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Badge color={item.status === 'going' ? 'success' : 'warning'}>
                            {item.status}
                          </Badge>
                          {item.checkedInAt ? (
                            <span className="flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle className="h-3.5 w-3.5" /> Checked In
                            </span>
                          ) : (
                            <Button
                              variant="soft"
                              size="sm"
                              onClick={() => handleCheckIn(item.user?._id)}
                            >
                              Check In
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
