import { useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Calendar,
  Clock,
  Video,
  CheckCircle,
  XCircle,
  Star,
  MessageCircle,
  Plus,
  Trash2,
  CheckSquare,
  Square,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { selectUser } from '../../features/authSlice';
import {
  useGetMentorshipRequestsQuery,
  useRespondMentorshipRequestMutation,
  useCancelMentorshipRequestMutation,
  useCompleteMentorshipMutation,
  useRateMentorshipMutation,
  useUpdateMentorshipGoalsMutation,
  useGetSlotsQuery,
  useCreateSlotsMutation,
  useDeleteMentorshipSlotMutation,
  useBookSessionMutation,
  useGetMentorshipSessionsQuery,
  useRescheduleSessionMutation,
  useCancelSessionMutation,
  useCompleteSessionMutation,
  useUpdateSessionNotesMutation,
  useMessageMentorMutation,
} from '../../services/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Skeleton,
} from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Field, Input, Select, Textarea } from '../../components/ui/form';

const DOMAIN_LABELS = {
  software_engineering: 'Software Engineering',
  cybersecurity: 'Cybersecurity',
  data_science: 'Data Science & AI',
  core_engineering: 'Core Engineering',
  higher_studies: 'Higher Studies & MS',
  government_exams: 'Govt & Civil Exams',
  entrepreneurship: 'Entrepreneurship',
  other: 'General Mentorship',
};

const STATUS_COLORS = {
  pending: 'warning',
  accepted: 'success',
  declined: 'danger',
  completed: 'primary',
  cancelled: 'neutral',
  expired: 'neutral',
};

export default function AlumniMentorshipTab() {
  const navigate = useNavigate();
  const currentUser = useSelector(selectUser);
  const isAlumni = currentUser?.role === 'alumni';
  const isStudent = currentUser?.role === 'student' || currentUser?.role === 'club_admin';

  // Sub-tab view: 'requests', 'sessions', 'slots'
  const [subTab, setSubTab] = useState(isAlumni ? 'requests' : 'requests');

  // Modals state
  const [respondModalReq, setRespondModalReq] = useState(null);
  const [respondStatus, setRespondStatus] = useState('accepted');
  const [respondNote, setRespondNote] = useState('');

  const [bookingModalReq, setBookingModalReq] = useState(null);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [bookingAgenda, setBookingAgenda] = useState('');

  const [rateModalReq, setRateModalReq] = useState(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingReview, setRatingReview] = useState('');

  const [publishSlotsOpen, setPublishSlotsOpen] = useState(false);
  const [slotDate, setSlotDate] = useState('');
  const [slotDuration, setSlotDuration] = useState('30');
  const [slotMode, setSlotMode] = useState('video');
  const [slotLink, setSlotLink] = useState('');
  const [slotNote, setSlotNote] = useState('');

  const [notesDrawerSession, setNotesDrawerSession] = useState(null);
  const [sharedNotesText, setSharedNotesText] = useState('');
  const [privateNotesText, setPrivateNotesText] = useState('');
  const [newActionItem, setNewActionItem] = useState('');

  // Queries
  const { data: requestsData, isLoading: isLoadingRequests } = useGetMentorshipRequestsQuery();
  const requests = Array.isArray(requestsData) ? requestsData : requestsData?.items || [];

  const { data: sessionsData, isLoading: isLoadingSessions } = useGetMentorshipSessionsQuery();
  const sessions = Array.isArray(sessionsData) ? sessionsData : sessionsData?.items || [];

  const { data: openSlotsData, isLoading: isLoadingSlots } = useGetSlotsQuery(
    bookingModalReq ? { alumni: bookingModalReq.alumni?._id || bookingModalReq.alumni } : undefined,
    { skip: !bookingModalReq && !isAlumni }
  );
  const openSlots = Array.isArray(openSlotsData) ? openSlotsData : openSlotsData?.items || [];

  // Mutations
  const [respondRequest, { isLoading: isResponding }] = useRespondMentorshipRequestMutation();
  const [cancelRequest] = useCancelMentorshipRequestMutation();
  const [completeMentorship] = useCompleteMentorshipMutation();
  const [rateMentorship, { isLoading: isRating }] = useRateMentorshipMutation();
  const [updateGoals] = useUpdateMentorshipGoalsMutation();
  const [createSlots, { isLoading: isPublishingSlot }] = useCreateSlotsMutation();
  const [deleteSlot] = useDeleteMentorshipSlotMutation();
  const [bookSession, { isLoading: isBooking }] = useBookSessionMutation();
  const [completeSession] = useCompleteSessionMutation();
  const [updateSessionNotes, { isLoading: isSavingNotes }] = useUpdateSessionNotesMutation();
  const [messageMentor] = useMessageMentorMutation();

  const handleMessage = async (reqId) => {
    try {
      const res = await messageMentor(reqId).unwrap();
      if (res.conversationId) {
        navigate(`/chat/${res.conversationId}`);
      }
    } catch (err) {
      toast.error('Could not initiate direct chat conversation');
    }
  };

  const handleRespond = async (e) => {
    e.preventDefault();
    if (!respondModalReq) return;
    try {
      await respondRequest({
        id: respondModalReq._id,
        status: respondStatus,
        response: respondNote.trim() || undefined,
      }).unwrap();
      toast.success(
        respondStatus === 'accepted'
          ? 'Mentorship request accepted! The student has been notified.'
          : 'Request declined'
      );
      setRespondModalReq(null);
      setRespondNote('');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to respond to request');
    }
  };

  const handleBookSession = async (e) => {
    e.preventDefault();
    if (!selectedSlotId || !bookingModalReq) {
      toast.error('Please select an available calendar slot');
      return;
    }
    try {
      await bookSession({
        request: bookingModalReq._id,
        slot: selectedSlotId,
        agenda: bookingAgenda.trim() || undefined,
      }).unwrap();
      toast.success('Session booked successfully! Calendar invite and notification sent.');
      setBookingModalReq(null);
      setSelectedSlotId('');
      setBookingAgenda('');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to book session');
    }
  };

  const handleRate = async (e) => {
    e.preventDefault();
    if (!rateModalReq) return;
    try {
      await rateMentorship({
        id: rateModalReq._id,
        rating: ratingValue,
        review: ratingReview.trim() || undefined,
      }).unwrap();
      toast.success('Thank you for rating your mentorship experience!');
      setRateModalReq(null);
      setRatingReview('');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to submit rating');
    }
  };

  const handlePublishSlot = async (e) => {
    e.preventDefault();
    if (!slotDate) {
      toast.error('Please select start date and time');
      return;
    }
    try {
      await createSlots({
        slots: [
          {
            startsAt: new Date(slotDate).toISOString(),
            durationMin: Number(slotDuration),
            mode: slotMode,
            meetingLink: slotLink.trim() || undefined,
            note: slotNote.trim() || undefined,
          },
        ],
      }).unwrap();
      toast.success('Mentorship slot published on your calendar!');
      setPublishSlotsOpen(false);
      setSlotDate('');
      setSlotLink('');
      setSlotNote('');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to publish slot');
    }
  };

  const handleToggleGoal = async (req, goalIdx) => {
    const updatedGoals = req.goals.map((g, i) => (i === goalIdx ? { ...g, done: !g.done } : g));
    try {
      await updateGoals({ id: req._id, goals: updatedGoals }).unwrap();
      toast.success('Goal updated');
    } catch (err) {
      toast.error('Failed to update goal');
    }
  };

  const handleAddGoal = async (req, goalText) => {
    if (!goalText.trim()) return;
    if (req.goals?.length >= 5) {
      toast.error('Maximum 5 goals allowed per mentorship');
      return;
    }
    const updatedGoals = [...(req.goals || []), { text: goalText.trim(), done: false }];
    try {
      await updateGoals({ id: req._id, goals: updatedGoals }).unwrap();
      toast.success('Goal added');
    } catch (err) {
      toast.error('Failed to add goal');
    }
  };

  const handleSaveNotes = async () => {
    if (!notesDrawerSession) return;
    try {
      await updateSessionNotes({
        id: notesDrawerSession._id,
        sharedNotes: sharedNotesText,
        alumniPrivateNotes: isAlumni ? privateNotesText : undefined,
      }).unwrap();
      toast.success('Session notes saved');
      setNotesDrawerSession(null);
    } catch (err) {
      toast.error('Failed to save session notes');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Navigation Sub-Tabs */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="glass inline-flex gap-1 rounded-2xl p-1 scrollbar-none">
            <button
              onClick={() => setSubTab('requests')}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                subTab === 'requests'
                  ? 'bg-white text-primary-600 shadow-soft dark:bg-white/10 dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Mentorship Requests ({requests.length})
            </button>

            <button
              onClick={() => setSubTab('sessions')}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                subTab === 'sessions'
                  ? 'bg-white text-primary-600 shadow-soft dark:bg-white/10 dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              1-on-1 Sessions ({sessions.length})
            </button>

            {isAlumni && (
              <button
                onClick={() => setSubTab('slots')}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                  subTab === 'slots'
                    ? 'bg-white text-primary-600 shadow-soft dark:bg-white/10 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                Slot Manager
              </button>
            )}
          </div>

          {isAlumni && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setPublishSlotsOpen(true)}
              className="font-bold"
            >
              <Plus className="mr-1 h-4 w-4" /> Publish Open Slot
            </Button>
          )}
        </div>
      </Card>

      {/* ── Sub-tab 1: Mentorship Requests ─────────────────────── */}
      {subTab === 'requests' && (
        <div className="space-y-4">
          {isLoadingRequests ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-5 space-y-3">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-14 w-full" />
                </Card>
              ))}
            </div>
          ) : requests.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No Mentorship Requests"
              text={
                isStudent
                  ? 'Explore the Alumni Directory to request 1-on-1 mentorship with senior industry alumni.'
                  : 'You have no pending or active mentorship requests.'
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {requests.map((req) => {
                const partner = isAlumni ? req.student : req.alumni;
                const isAccepted = req.status === 'accepted';
                const isCompleted = req.status === 'completed';
                const isPending = req.status === 'pending';

                return (
                  <Card key={req._id} className="p-5 flex flex-col justify-between space-y-4">
                    <div>
                      {/* Partner Row */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Avatar user={partner} size="md" />
                          <div>
                            <h4 className="font-bold text-sm text-ink dark:text-white">{partner?.name}</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {partner?.department} • {partner?.designation || `Class of ${partner?.year}`}
                            </p>
                          </div>
                        </div>

                        <Badge color={STATUS_COLORS[req.status] || 'neutral'}>
                          {req.status}
                        </Badge>
                      </div>

                      {/* Domain Badge */}
                      <div className="mt-3">
                        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                          Focus: {DOMAIN_LABELS[req.domain] || req.domain}
                        </span>
                      </div>

                      {/* Message */}
                      <p className="mt-3 text-xs text-slate-700 italic leading-relaxed dark:text-slate-300">
                        "{req.message}"
                      </p>

                      {/* Mentor Response */}
                      {req.response && (
                        <div className="mt-3 rounded-xl bg-slate-50 p-2.5 text-xs dark:bg-white/5">
                          <p className="font-bold text-primary-600 dark:text-primary-400">Response:</p>
                          <p className="text-slate-600 dark:text-slate-300">{req.response}</p>
                        </div>
                      )}

                      {/* Interactive Goals Checklist (when accepted) */}
                      {isAccepted && (
                        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/5">
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                            Mentorship Goals ({req.goals?.filter((g) => g.done).length || 0}/
                            {req.goals?.length || 0})
                          </p>
                          <div className="space-y-1.5">
                            {req.goals?.map((g, idx) => (
                              <button
                                key={idx}
                                onClick={() => handleToggleGoal(req, idx)}
                                className="flex w-full items-center gap-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-primary-600"
                              >
                                {g.done ? (
                                  <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                                ) : (
                                  <Square className="h-4 w-4 text-slate-400 shrink-0" />
                                )}
                                <span className={g.done ? 'line-through text-slate-400' : ''}>
                                  {g.text}
                                </span>
                              </button>
                            ))}
                          </div>

                          {/* Add goal prompt */}
                          {(req.goals?.length || 0) < 5 && (
                            <button
                              onClick={() => {
                                const text = window.prompt('Enter new mentorship goal:');
                                if (text) handleAddGoal(req, text);
                              }}
                              className="mt-2 text-xs font-semibold text-primary-600 hover:underline flex items-center gap-1"
                            >
                              <Plus className="h-3.5 w-3.5" /> Add Goal
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Bar */}
                    <div className="border-t border-slate-100 pt-3 dark:border-white/5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex gap-2">
                        {/* Direct Chat shortcut */}
                        {isAccepted && (
                          <Button
                            variant="soft"
                            size="sm"
                            onClick={() => handleMessage(req._id)}
                            className="text-xs"
                          >
                            <MessageCircle className="mr-1 h-3.5 w-3.5" /> Message
                          </Button>
                        )}

                        {/* Student Book Session button */}
                        {isStudent && isAccepted && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setBookingModalReq(req)}
                            className="text-xs font-bold"
                          >
                            <Calendar className="mr-1 h-3.5 w-3.5" /> Book Session
                          </Button>
                        )}
                      </div>

                      <div className="flex gap-2">
                        {/* Alumni Accept / Decline for pending */}
                        {isAlumni && isPending && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-rose-600 text-xs"
                              onClick={() => {
                                setRespondModalReq(req);
                                setRespondStatus('declined');
                              }}
                            >
                              Decline
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              className="text-xs font-bold"
                              onClick={() => {
                                setRespondModalReq(req);
                                setRespondStatus('accepted');
                              }}
                            >
                              Accept Request
                            </Button>
                          </>
                        )}

                        {/* Student Cancel Request */}
                        {isStudent && isPending && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-500 text-xs"
                            onClick={async () => {
                              if (window.confirm('Cancel this request?')) {
                                await cancelRequest({ id: req._id });
                                toast.success('Request cancelled');
                              }
                            }}
                          >
                            Cancel
                          </Button>
                        )}

                        {/* Alumni Complete Mentorship */}
                        {isAlumni && isAccepted && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              if (window.confirm('Mark this mentorship as completed?')) {
                                await completeMentorship(req._id);
                                toast.success('Mentorship marked as completed');
                              }
                            }}
                            className="text-xs"
                          >
                            Mark Completed
                          </Button>
                        )}

                        {/* Student Rate Completed Mentorship */}
                        {isStudent && isCompleted && (
                          <div className="flex items-center gap-2">
                            {req.rating ? (
                              <span className="flex items-center gap-1 text-xs font-bold text-amber-500">
                                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                                {req.rating} / 5 Rated
                              </span>
                            ) : (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => setRateModalReq(req)}
                                className="text-xs font-bold"
                              >
                                <Star className="mr-1 h-3.5 w-3.5" /> Rate Mentor
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Sub-tab 2: 1-on-1 Sessions ──────────────────────────── */}
      {subTab === 'sessions' && (
        <div className="space-y-4">
          {isLoadingSessions ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-5 space-y-3">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-16 w-full" />
                </Card>
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No Booked Sessions"
              text="Once a mentorship request is accepted, students can book scheduled 1-on-1 sessions."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {sessions.map((sess) => {
                const partner = isAlumni ? sess.student : sess.alumni;
                const start = new Date(sess.startsAt);
                const isConfirmed = sess.status === 'confirmed';

                return (
                  <Card key={sess._id} className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Avatar user={partner} size="md" />
                        <div>
                          <h4 className="font-bold text-sm text-ink dark:text-white">{partner?.name}</h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {partner?.department} • {partner?.designation || `Class of ${partner?.year}`}
                          </p>
                        </div>
                      </div>

                      <Badge color={sess.status === 'confirmed' ? 'success' : 'neutral'}>
                        {sess.status}
                      </Badge>
                    </div>

                    <div className="rounded-2xl bg-slate-50 p-3 text-xs dark:bg-white/5 space-y-1">
                      <p className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
                        <Calendar className="h-3.5 w-3.5 text-primary-600" />
                        {start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} at {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="flex items-center gap-1.5 text-slate-500">
                        <Clock className="h-3.5 w-3.5" /> Duration: {sess.durationMin} minutes ({sess.mode})
                      </p>
                      {sess.agenda && (
                        <p className="text-slate-700 dark:text-slate-300 pt-1">
                          <span className="font-bold">Agenda:</span> {sess.agenda}
                        </p>
                      )}
                    </div>

                    {/* Meeting Link */}
                    {sess.meetingLink && isConfirmed && (
                      <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-50/50 p-2.5 text-xs dark:bg-emerald-500/10">
                        <span className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                          <Video className="h-3.5 w-3.5" /> Google Meet / Video Call
                        </span>
                        <a
                          href={sess.meetingLink}
                          target="_blank"
                          rel="noreferrer"
                          className="font-bold text-primary-600 hover:underline flex items-center gap-1"
                        >
                          Join <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}

                    {/* Action Items List */}
                    {sess.actionItems?.length > 0 && (
                      <div className="space-y-1 text-xs">
                        <p className="font-bold uppercase tracking-wider text-[10px] text-slate-400">
                          Action Items ({sess.actionItems.filter((a) => a.done).length}/{sess.actionItems.length})
                        </p>
                        {sess.actionItems.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            {item.done ? (
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Clock className="h-3.5 w-3.5 text-slate-400" />
                            )}
                            <span className={item.done ? 'line-through text-slate-400' : ''}>
                              {item.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Session Controls */}
                    <div className="border-t border-slate-100 pt-3 dark:border-white/5 flex items-center justify-between gap-2 text-xs">
                      <Button
                        variant="soft"
                        size="sm"
                        onClick={() => {
                          setNotesDrawerSession(sess);
                          setSharedNotesText(sess.sharedNotes || '');
                          setPrivateNotesText(sess.alumniPrivateNotes || '');
                        }}
                      >
                        <BookOpen className="mr-1 h-3.5 w-3.5" /> Notes & Action Items
                      </Button>

                      {isAlumni && isConfirmed && (
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={async () => {
                              await completeSession({ id: sess._id, outcome: 'completed' });
                              toast.success('Session marked completed!');
                            }}
                          >
                            Mark Completed
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Sub-tab 3: Slot Manager (Alumni Only) ─────────────────── */}
      {subTab === 'slots' && isAlumni && (
        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h3 className="font-bold text-sm">Your Published Calendar Slots</h3>
            <p className="text-xs muted mt-0.5">
              Open slots are visible to your mentees for scheduling 1-on-1 mentoring sessions.
            </p>
          </Card>

          {isLoadingSlots ? (
            <Skeleton className="h-20 w-full" />
          ) : openSlots.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No Slots Published"
              text="Publish slots to let accepted mentees book time directly on your calendar."
              action={
                <Button variant="primary" size="sm" onClick={() => setPublishSlotsOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Publish First Slot
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {openSlots.map((slot) => {
                const start = new Date(slot.startsAt);
                const isOpen = slot.status === 'open';

                return (
                  <Card key={slot._id} className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-xs text-ink dark:text-white">
                        {start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-[11px] muted">
                        {slot.durationMin} mins • {slot.mode}
                      </p>
                      <Badge color={isOpen ? 'success' : 'neutral'} className="mt-1">
                        {slot.status}
                      </Badge>
                    </div>

                    {isOpen && (
                      <button
                        onClick={async () => {
                          await deleteSlot(slot._id);
                          toast.success('Slot removed');
                        }}
                        className="btn-icon btn-ghost text-slate-400 hover:text-rose-500"
                        title="Delete open slot"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Accept / Decline Request Modal */}
      {respondModalReq && (
        <Modal
          open={!!respondModalReq}
          onClose={() => setRespondModalReq(null)}
          title={respondStatus === 'accepted' ? 'Accept Mentorship Request' : 'Decline Request'}
          subtitle={`Student: ${respondModalReq.student?.name} (${respondModalReq.student?.department})`}
          size="sm"
        >
          <form onSubmit={handleRespond} className="space-y-4">
            <Field label="Response Note (Optional)" hint="Add a welcoming note or suggestion">
              <Textarea
                rows={3}
                placeholder={
                  respondStatus === 'accepted'
                    ? 'Excited to mentor you! Feel free to book a slot on my calendar.'
                    : 'Currently at full capacity, please reach out next quarter.'
                }
                value={respondNote}
                onChange={(e) => setRespondNote(e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setRespondModalReq(null)}>
                Cancel
              </Button>
              <Button
                variant={respondStatus === 'accepted' ? 'primary' : 'danger'}
                type="submit"
                loading={isResponding}
              >
                Confirm {respondStatus === 'accepted' ? 'Acceptance' : 'Decline'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Book Session Modal (Student) */}
      {bookingModalReq && (
        <Modal
          open={!!bookingModalReq}
          onClose={() => setBookingModalReq(null)}
          title="Book Mentoring Session"
          subtitle={`Select an available time slot with ${bookingModalReq.alumni?.name}`}
          size="md"
        >
          <form onSubmit={handleBookSession} className="space-y-4">
            <Field label="Available Calendar Slots" required>
              {openSlots.length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 p-3 rounded-xl dark:bg-amber-500/10">
                  The mentor does not currently have open slots. Please message them to publish a time slot!
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {openSlots.filter((s) => s.status === 'open').map((slot) => {
                    const st = new Date(slot.startsAt);
                    const isSelected = selectedSlotId === slot._id;
                    return (
                      <div
                        key={slot._id}
                        onClick={() => setSelectedSlotId(slot._id)}
                        className={`cursor-pointer rounded-xl p-3 border text-xs flex items-center justify-between transition-all ${
                          isSelected
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 font-bold'
                            : 'border-slate-200 hover:border-primary-300 dark:border-white/10'
                        }`}
                      >
                        <div>
                          <p>
                            {st.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at {st.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <p className="muted text-[11px]">{slot.durationMin} mins • {slot.mode}</p>
                        </div>
                        {isSelected && <CheckCircle className="h-4 w-4 text-primary-600" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </Field>

            <Field label="Session Agenda & Discussion Topics">
              <Textarea
                rows={3}
                placeholder="What specific problems or code reviews would you like to cover in this session?"
                value={bookingAgenda}
                onChange={(e) => setBookingAgenda(e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setBookingModalReq(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={isBooking}
                disabled={!selectedSlotId}
              >
                Confirm Booking
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Publish Slot Modal (Alumni) */}
      <Modal
        open={publishSlotsOpen}
        onClose={() => setPublishSlotsOpen(false)}
        title="Publish Open Calendar Slot"
        subtitle="Open a 1-on-1 slot for your active mentees"
        size="md"
      >
        <form onSubmit={handlePublishSlot} className="space-y-4">
          <Field label="Start Date & Time" required>
            <input
              type="datetime-local"
              value={slotDate}
              onChange={(e) => setSlotDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="input text-sm"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration">
              <select
                value={slotDuration}
                onChange={(e) => setSlotDuration(e.target.value)}
                className="input text-sm"
              >
                <option value="15">15 Minutes</option>
                <option value="30">30 Minutes</option>
                <option value="45">45 Minutes</option>
                <option value="60">60 Minutes</option>
              </select>
            </Field>

            <Field label="Mode">
              <select
                value={slotMode}
                onChange={(e) => setSlotMode(e.target.value)}
                className="input text-sm"
              >
                <option value="video">Google Meet / Video</option>
                <option value="phone">Phone Call</option>
                <option value="in_person">In-Person on Campus</option>
              </select>
            </Field>
          </div>

          <Field label="Meeting Link (Google Meet / Zoom URL)">
            <Input
              type="url"
              placeholder="https://meet.google.com/abc-defg-hij"
              value={slotLink}
              onChange={(e) => setSlotLink(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => setPublishSlotsOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={isPublishingSlot}>
              Publish Slot
            </Button>
          </div>
        </form>
      </Modal>

      {/* Rate Mentor Modal */}
      {rateModalReq && (
        <Modal
          open={!!rateModalReq}
          onClose={() => setRateModalReq(null)}
          title="Rate Mentorship Experience"
          subtitle={`Mentor: ${rateModalReq.alumni?.name}`}
          size="sm"
        >
          <form onSubmit={handleRate} className="space-y-4">
            <div className="flex justify-center gap-2 py-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  onClick={() => setRatingValue(star)}
                  className="p-1 hover:scale-125 transition-transform"
                >
                  <Star
                    className={`h-8 w-8 ${
                      star <= ratingValue
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-slate-300 dark:text-slate-600'
                    }`}
                  />
                </button>
              ))}
            </div>

            <Field label="Review / Feedback" hint="Help other students understand this mentor's guidance">
              <Textarea
                rows={3}
                placeholder="The system design feedback was thorough and helped me crack my technical interview..."
                value={ratingReview}
                onChange={(e) => setRatingReview(e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setRateModalReq(null)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" loading={isRating}>
                Submit Rating
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Notes & Action Items Modal */}
      {notesDrawerSession && (
        <Modal
          open={!!notesDrawerSession}
          onClose={() => setNotesDrawerSession(null)}
          title="Session Notes & Action Items"
          subtitle="Collaborative takeaways from your mentoring session"
          size="md"
        >
          <div className="space-y-4">
            <Field label="Shared Meeting Notes" hint="Visible to both mentor and mentee">
              <Textarea
                rows={4}
                value={sharedNotesText}
                onChange={(e) => setSharedNotesText(e.target.value)}
                placeholder="Key takeaways, resources discussed, and recommended study material..."
              />
            </Field>

            {isAlumni && (
              <Field label="Private Alumni Notes" hint="Only visible to you (never shared with student)">
                <Textarea
                  rows={3}
                  value={privateNotesText}
                  onChange={(e) => setPrivateNotesText(e.target.value)}
                  placeholder="Candidate potential, personal observations, areas of improvement..."
                />
              </Field>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setNotesDrawerSession(null)}>
                Close
              </Button>
              <Button variant="primary" onClick={handleSaveNotes} loading={isSavingNotes}>
                Save Notes
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
