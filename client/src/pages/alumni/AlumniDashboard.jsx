import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  GraduationCap,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Users,
  Clock,
  Calendar,
  Briefcase,
  Star,
  Compass,
  Plus,
  Video,
  ExternalLink,
  CheckCircle,
  XCircle,
  MessageCircle,
  ArrowRight,
  TrendingUp,
  FileText,
  Radio,
  Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { selectUser } from '../../features/authSlice';
import {
  useGetAlumniDashboardQuery,
  useRespondMentorshipRequestMutation,
  useCreateSlotsMutation,
  useCompleteSessionMutation,
  useUpsertAlumniProfileMutation,
} from '../../services/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  StatCard,
} from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Field, Input, Select, Textarea } from '../../components/ui/form';

export default function AlumniDashboard() {
  const currentUser = useSelector(selectUser);

  // Queries & Mutations
  const { data, isLoading, error, refetch } = useGetAlumniDashboardQuery();
  const [respondRequest, { isLoading: isResponding }] = useRespondMentorshipRequestMutation();
  const [createSlots, { isLoading: isCreatingSlot }] = useCreateSlotsMutation();
  const [completeSession] = useCompleteSessionMutation();
  const [upsertProfile, { isLoading: isUpdatingProfile }] = useUpsertAlumniProfileMutation();

  // Modals state
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [slotDate, setSlotDate] = useState('');
  const [slotDuration, setSlotDuration] = useState('30');
  const [slotMode, setSlotMode] = useState('video');
  const [slotLink, setSlotLink] = useState('');
  const [slotNote, setSlotNote] = useState('');

  const [respondModalReq, setRespondModalReq] = useState(null);
  const [respondStatus, setRespondStatus] = useState('accepted');
  const [respondNote, setRespondNote] = useState('');

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-44 rounded-[32px]" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-[28px]" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  const {
    profile = {},
    attention = [],
    stats = {},
    pendingRequests = [],
    upcomingSessions = [],
    myJobs = [],
    hostingEvents = [],
    rsvpEvents = [],
    chapterPosts = [],
  } = data || {};

  const handleToggleMentorship = async () => {
    try {
      await upsertProfile({
        mentorshipAvailable: !profile.mentorshipAvailable,
      }).unwrap();
      toast.success(
        profile.mentorshipAvailable
          ? 'Mentorship paused. You will not receive new requests.'
          : 'Mentorship activated! Students can now request 1-on-1 guidance.'
      );
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update mentorship status');
    }
  };

  const handleCreateSlot = async (e) => {
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
      setSlotModalOpen(false);
      setSlotDate('');
      setSlotLink('');
      setSlotNote('');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to publish slot');
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
          ? 'Mentorship request accepted! Student can now book sessions.'
          : 'Mentorship request declined'
      );
      setRespondModalReq(null);
      setRespondNote('');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update request');
    }
  };

  return (
    <div className="space-y-6 animate-fade-up">
      {/* ── Hero / Greeting ─────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-primary-500 via-primary-600 to-indigo-700 p-6 text-white shadow-glow sm:p-8">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-purple-400/20 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold text-white backdrop-blur">
                <GraduationCap className="h-3.5 w-3.5" /> Alumni Portal
              </span>
              {profile.isVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/25 px-2.5 py-0.5 text-[10px] font-bold text-emerald-100 backdrop-blur">
                  <ShieldCheck className="h-3 w-3" /> Verified Alumnus
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/25 px-2.5 py-0.5 text-[10px] font-bold text-amber-100 backdrop-blur">
                  <Clock className="h-3 w-3" /> Verification Pending
                </span>
              )}
            </div>

            <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
              Welcome back, {currentUser?.name}!
            </h1>
            <p className="mt-2 text-sm text-white/85 leading-relaxed">
              Stay connected with your alma mater, mentor aspiring juniors, share career
              opportunities, and join regional alumni chapters.
            </p>

            {/* Quick Actions */}
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Button
                variant="plain"
                className="bg-white text-primary-600 shadow-lg hover:bg-white/90 hover:-translate-y-0.5 font-bold"
                onClick={() => setSlotModalOpen(true)}
              >
                <Plus className="mr-1 h-4 w-4" /> Publish Open Slot
              </Button>

              <Button
                variant="plain"
                className={`border border-white/30 backdrop-blur font-bold transition-all ${
                  profile.mentorshipAvailable
                    ? 'bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/35'
                    : 'bg-white/15 text-white hover:bg-white/25'
                }`}
                loading={isUpdatingProfile}
                onClick={handleToggleMentorship}
              >
                <Radio className={`mr-1.5 h-3.5 w-3.5 ${profile.mentorshipAvailable ? 'text-emerald-300' : 'text-slate-300'}`} />
                Mentorship: {profile.mentorshipAvailable ? 'Accepting Mentees' : 'Paused'}
              </Button>

              <Link
                to="/alumni?tab=jobs"
                className="btn btn-outline border-white/30 bg-white/15 text-white backdrop-blur hover:bg-white/25 font-bold"
              >
                <Briefcase className="mr-1.5 h-4 w-4" /> Share Job Opening
              </Link>

              <Link
                to="/alumni"
                className="btn btn-ghost text-white/90 hover:bg-white/15 hover:text-white"
              >
                Alumni Network Hub →
              </Link>
            </div>
          </div>

          {/* Profile mini status card */}
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-md sm:min-w-[240px]">
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">Profile Strength</p>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-black">{profile.completeness || 0}%</span>
              <span className="text-xs font-medium text-white/80">
                {profile.completeness >= 80 ? 'Excellent' : 'Needs updates'}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-all duration-500"
                style={{ width: `${profile.completeness || 0}%` }}
              />
            </div>
            <Link
              to="/alumni?tab=my_profile"
              className="mt-3 block text-right text-xs font-bold text-white/90 hover:text-white hover:underline"
            >
              Edit Profile Details →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Attention / Action Banners ──────────────────────────── */}
      {attention.length > 0 && (
        <div className="space-y-3">
          {attention.map((item, idx) => (
            <div
              key={idx}
              className={`flex items-start justify-between gap-3 rounded-2xl border p-4 transition-all ${
                item.level === 'danger'
                  ? 'border-rose-500/30 bg-rose-50/70 text-rose-900 dark:bg-rose-500/10 dark:text-rose-200'
                  : item.level === 'warning'
                  ? 'border-amber-500/30 bg-amber-50/70 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
                  : 'border-primary-500/30 bg-primary-50/70 text-primary-900 dark:bg-primary-500/10 dark:text-primary-200'
              }`}
            >
              <div className="flex items-start gap-3">
                {item.level === 'danger' ? (
                  <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                ) : item.level === 'warning' ? (
                  <Clock className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                ) : (
                  <Sparkles className="h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400 mt-0.5" />
                )}
                <p className="text-sm font-semibold leading-relaxed">{item.message}</p>
              </div>

              {item.link && (
                <Link
                  to={item.link}
                  className="shrink-0 rounded-xl px-3 py-1 text-xs font-bold hover:underline"
                >
                  Action →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 9 Stat KPI Cards ────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <StatCard
          icon={ShieldCheck}
          label="Verification"
          value={profile.isVerified ? 'Verified' : 'Pending'}
          hint={profile.isVerified ? 'Directory verified' : 'Awaiting campus review'}
          gradient={profile.isVerified ? 'from-emerald-400 to-teal-500' : 'from-amber-400 to-orange-500'}
          delay={0}
        />

        <StatCard
          icon={Sparkles}
          label="Completeness"
          value={`${profile.completeness || 0}%`}
          hint="Profile strength score"
          gradient="from-violet-400 to-indigo-500"
          delay={40}
        />

        <StatCard
          icon={Users}
          label="Active Mentees"
          value={`${stats.activeMentees || 0} / ${stats.menteeCapacity || 3}`}
          hint="Mentee pairing capacity"
          gradient="from-sky-400 to-blue-500"
          delay={80}
        />

        <StatCard
          icon={Clock}
          label="Pending Requests"
          value={stats.pendingRequests || 0}
          hint="Mentees waiting response"
          gradient="from-pink-400 to-rose-500"
          delay={120}
        />

        <StatCard
          icon={Calendar}
          label="Upcoming Sessions"
          value={stats.upcomingSessions || 0}
          hint="1-on-1 calls next 7 days"
          gradient="from-indigo-400 to-purple-600"
          delay={160}
        />

        <StatCard
          icon={Star}
          label="Mentor Rating"
          value={stats.ratingAvg > 0 ? `${stats.ratingAvg.toFixed(1)} ★` : '—'}
          hint={`${stats.ratingCount || 0} completed reviews`}
          gradient="from-amber-400 to-yellow-500"
          delay={200}
        />

        <StatCard
          icon={Briefcase}
          label="Opportunities Posted"
          value={stats.jobsPosted || 0}
          hint={`${stats.applicants || 0} student applicants`}
          gradient="from-teal-400 to-emerald-600"
          delay={240}
        />

        <StatCard
          icon={Compass}
          label="Active Chapters"
          value={stats.chapters || 0}
          hint="Batch, dept, city hubs"
          gradient="from-fuchsia-400 to-pink-500"
          delay={280}
        />
      </section>

      {/* ── Main Dashboard Content Columns ──────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Pending Requests & Upcoming Sessions */}
        <div className="space-y-6">
          {/* Pending Mentorship Requests */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                <h3 className="text-base font-bold text-ink dark:text-white">
                  Pending Mentorship Requests ({pendingRequests.length})
                </h3>
              </div>
              <Link
                to="/alumni?tab=mentorship"
                className="text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400"
              >
                View All →
              </Link>
            </div>

            {pendingRequests.length === 0 ? (
              <p className="py-6 text-center text-xs muted">
                No student mentorship requests awaiting your response.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {pendingRequests.map((req) => (
                  <div key={req._id} className="py-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Avatar user={req.student} size="sm" />
                        <div>
                          <p className="text-sm font-bold text-ink dark:text-white">
                            {req.student?.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {req.student?.department} • Year {req.student?.year || '—'}
                          </p>
                        </div>
                      </div>

                      <Badge color="warning">Pending</Badge>
                    </div>

                    <p className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-700 italic dark:bg-white/5 dark:text-slate-300">
                      "{req.message}"
                    </p>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setRespondModalReq(req);
                          setRespondStatus('declined');
                        }}
                        className="text-xs"
                      >
                        Decline
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          setRespondModalReq(req);
                          setRespondStatus('accepted');
                        }}
                        className="text-xs font-bold"
                      >
                        <Check className="mr-1 h-3.5 w-3.5" /> Accept Request
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Upcoming 1-on-1 Sessions */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-base font-bold text-ink dark:text-white">
                  Upcoming 1-on-1 Mentorship Sessions ({upcomingSessions.length})
                </h3>
              </div>
              <Link
                to="/alumni?tab=mentorship"
                className="text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400"
              >
                Manage Calendar →
              </Link>
            </div>

            {upcomingSessions.length === 0 ? (
              <EmptyState
                icon={Calendar}
                title="No Upcoming Sessions"
                text="Accepted mentees will book time on your published calendar slots."
                action={
                  <Button
                    variant="soft"
                    size="sm"
                    onClick={() => setSlotModalOpen(true)}
                    className="font-bold text-xs"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Publish New Slot
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {upcomingSessions.map((sess) => {
                  const start = new Date(sess.scheduledAt);
                  return (
                    <div
                      key={sess._id}
                      className="py-3.5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar user={sess.student} size="sm" />
                        <div>
                          <p className="text-sm font-bold text-ink dark:text-white">
                            {sess.student?.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {start.toLocaleDateString(undefined, {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}{' '}
                            at{' '}
                            {start.toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {sess.meetingLink && (
                          <a
                            href={sess.meetingLink}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-soft btn-sm text-xs font-bold"
                          >
                            <Video className="mr-1 h-3.5 w-3.5" /> Join Call
                          </a>
                        )}

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            if (window.confirm('Mark this session completed?')) {
                              await completeSession({ id: sess._id, outcome: 'completed' });
                              toast.success('Session completed!');
                            }
                          }}
                          className="text-xs"
                        >
                          Mark Done
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Opportunities & Chapter Feeds */}
        <div className="space-y-6">
          {/* My Job Postings */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <div className="flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-base font-bold text-ink dark:text-white">
                  Your Career Postings ({myJobs.length})
                </h3>
              </div>
              <Link
                to="/alumni?tab=jobs"
                className="text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400"
              >
                Post Opportunity →
              </Link>
            </div>

            {myJobs.length === 0 ? (
              <p className="py-6 text-center text-xs muted">
                You haven't posted any jobs or referral openings yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {myJobs.map((job) => (
                  <div
                    key={job._id}
                    className="py-3 flex items-center justify-between text-xs"
                  >
                    <div>
                      <p className="font-bold text-sm text-ink dark:text-white">{job.title}</p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {job.company} • Deadline:{' '}
                        {job.deadline ? new Date(job.deadline).toLocaleDateString() : 'Rolling'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge color={job.status === 'open' ? 'success' : 'neutral'}>
                        {job.status}
                      </Badge>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-white/10 dark:text-slate-300">
                        {job.applicationCount || 0} applicants
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Chapter Network Activity */}
          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <div className="flex items-center gap-2">
                <Compass className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                <h3 className="text-base font-bold text-ink dark:text-white">
                  Chapter Activity & Feeds
                </h3>
              </div>
              <Link
                to="/alumni?tab=chapters"
                className="text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400"
              >
                Explore Hubs →
              </Link>
            </div>

            {chapterPosts.length === 0 ? (
              <p className="py-6 text-center text-xs muted">
                No recent chapter posts. Join chapters to connect with batchmates and peers!
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {chapterPosts.map((post) => (
                  <div key={post._id} className="py-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Avatar user={post.author} size="xs" />
                        <span className="font-bold text-ink dark:text-white">
                          {post.author?.name}
                        </span>
                        {post.chapter && (
                          <Badge color="primary" size="xs">
                            {post.chapter.name}
                          </Badge>
                        )}
                      </div>
                      <span className="text-[10px] muted">
                        {new Date(post.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <p className="line-clamp-2 text-slate-700 leading-relaxed dark:text-slate-300">
                      {post.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Publish Slot Modal ──────────────────────────────────── */}
      <Modal
        open={slotModalOpen}
        onClose={() => setSlotModalOpen(false)}
        title="Publish Mentorship Time Slot"
        subtitle="Mentees can pick this slot from your available schedule"
        size="md"
      >
        <form onSubmit={handleCreateSlot} className="space-y-4">
          <Field label="Session Start Date & Time" required>
            <input
              type="datetime-local"
              value={slotDate}
              onChange={(e) => setSlotDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="input text-sm"
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Duration (minutes)">
              <select
                value={slotDuration}
                onChange={(e) => setSlotDuration(e.target.value)}
                className="input text-sm"
              >
                <option value="15">15 Minutes (Quick sync)</option>
                <option value="30">30 Minutes (Standard)</option>
                <option value="45">45 Minutes (In-depth)</option>
                <option value="60">60 Minutes (Full review)</option>
              </select>
            </Field>

            <Field label="Meeting Format">
              <select
                value={slotMode}
                onChange={(e) => setSlotMode(e.target.value)}
                className="input text-sm"
              >
                <option value="video">Google Meet / Video Link</option>
                <option value="in_person">In-Person Campus Meet</option>
                <option value="phone">Phone Call</option>
              </select>
            </Field>
          </div>

          <Field label="Meeting Link / Venue">
            <Input
              placeholder="https://meet.google.com/xyz-abcd-efg"
              value={slotLink}
              onChange={(e) => setSlotLink(e.target.value)}
            />
          </Field>

          <Field label="Mentor Note (optional)">
            <Input
              placeholder="e.g. Please bring your resume or GitHub link"
              value={slotNote}
              onChange={(e) => setSlotNote(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => setSlotModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={isCreatingSlot}>
              Publish Slot
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Respond to Mentorship Request Modal ─────────────────── */}
      {respondModalReq && (
        <Modal
          open={!!respondModalReq}
          onClose={() => setRespondModalReq(null)}
          title={respondStatus === 'accepted' ? 'Accept Mentorship Request' : 'Decline Request'}
          subtitle={`Student: ${respondModalReq.student?.name} (${respondModalReq.student?.department})`}
          size="sm"
        >
          <form onSubmit={handleRespond} className="space-y-4">
            <Field label="Response Note (Optional)" hint="Add a note or instruction for the student">
              <Textarea
                rows={3}
                placeholder={
                  respondStatus === 'accepted'
                    ? 'Excited to mentor you! Please book an available time slot on my calendar.'
                    : 'Currently at full capacity, please reach out again next term.'
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
    </div>
  );
}

