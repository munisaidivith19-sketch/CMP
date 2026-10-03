import { useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Briefcase,
  Search,
  Plus,
  MapPin,
  Clock,
  ExternalLink,
  Users,
  CheckCircle,
  XCircle,
  FileText,
  AlertCircle,
  Sparkles,
  ChevronRight,
  Send,
  Building,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { selectUser } from '../../features/authSlice';
import {
  useGetAlumniJobsQuery,
  useCreateAlumniJobMutation,
  useCloseAlumniJobMutation,
  useReopenAlumniJobMutation,
  useRemoveAlumniJobMutation,
  useApplyToJobMutation,
  useGetJobApplicationsQuery,
  useGetMyApplicationsQuery,
  useUpdateApplicationMutation,
  useWithdrawApplicationMutation,
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

const JOB_TYPE_LABELS = {
  full_time: 'Full Time',
  internship: 'Internship',
  part_time: 'Part Time',
  contract: 'Contract',
};

const WORK_MODE_LABELS = {
  onsite: 'Onsite',
  remote: 'Remote',
  hybrid: 'Hybrid',
};

const APPLICATION_STATUS_COLORS = {
  applied: 'neutral',
  referred: 'info',
  shortlisted: 'success',
  rejected: 'danger',
  hired: 'success',
  withdrawn: 'neutral',
};

export default function AlumniJobsTab() {
  const currentUser = useSelector(selectUser);
  const isStudent = currentUser?.role === 'student' || currentUser?.role === 'club_admin';
  const canPost = ['alumni', 'faculty', 'hod', 'admin', 'principal'].includes(currentUser?.role);

  // Filters
  const [search, setSearch] = useState('');
  const [jobType, setJobType] = useState('');
  const [workMode, setWorkMode] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  // Active Job Drawer
  const [selectedJob, setSelectedJob] = useState(null);

  // Post Modal
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newType, setNewType] = useState('full_time');
  const [newWorkMode, setNewWorkMode] = useState('hybrid');
  const [newDescription, setNewDescription] = useState('');
  const [newSkills, setNewSkills] = useState('');
  const [newApplyMode, setNewApplyMode] = useState('referral');
  const [newExternalUrl, setNewExternalUrl] = useState('');
  const [newDeadline, setNewDeadline] = useState('');

  // Apply State
  const [applyNote, setApplyNote] = useState('');
  const [applyResumeUrl, setApplyResumeUrl] = useState('');
  const [applyReferral, setApplyReferral] = useState(true);

  // RTK Query
  const { data: jobsData, isLoading } = useGetAlumniJobsQuery({
    search: search.trim() || undefined,
    type: jobType || undefined,
    workMode: workMode || undefined,
    mine: mineOnly || undefined,
  });
  const jobs = Array.isArray(jobsData) ? jobsData : jobsData?.items || [];

  const { data: myAppsData } = useGetMyApplicationsQuery(undefined, { skip: !isStudent });
  const myApps = Array.isArray(myAppsData) ? myAppsData : myAppsData?.items || [];

  const [createJob, { isLoading: isPosting }] = useCreateAlumniJobMutation();
  const [closeJob] = useCloseAlumniJobMutation();
  const [reopenJob] = useReopenAlumniJobMutation();
  const [removeJob] = useRemoveAlumniJobMutation();
  const [applyToJob, { isLoading: isApplying }] = useApplyToJobMutation();
  const [updateApplication] = useUpdateApplicationMutation();
  const [withdrawApplication] = useWithdrawApplicationMutation();

  // Selected job applicants (if poster/staff)
  const isPosterOrStaff =
    selectedJob &&
    (selectedJob.poster?._id === currentUser?._id ||
      selectedJob.poster === currentUser?._id ||
      ['admin', 'hod'].includes(currentUser?.role));

  const { data: applicantsData, refetch: refetchApplicants } = useGetJobApplicationsQuery(
    selectedJob?._id,
    { skip: !isPosterOrStaff }
  );
  const applicants = Array.isArray(applicantsData) ? applicantsData : applicantsData?.items || [];

  // Student's application for the selected job
  const myCurrentApp = selectedJob && myApps.find((a) => a.job?._id === selectedJob._id || a.job === selectedJob._id);

  const handleCreateJob = async (e) => {
    e.preventDefault();
    if (!newDeadline) {
      toast.error('Please pick an application deadline');
      return;
    }
    try {
      await createJob({
        title: newTitle.trim(),
        company: newCompany.trim(),
        location: newLocation.trim(),
        type: newType,
        workMode: newWorkMode,
        description: newDescription.trim(),
        skills: newSkills.split(',').map((s) => s.trim()).filter(Boolean),
        applyMode: newApplyMode,
        externalUrl: newApplyMode === 'external_link' ? newExternalUrl.trim() : undefined,
        deadline: new Date(newDeadline).toISOString(),
      }).unwrap();
      toast.success('Opportunity posted successfully!');
      setPostModalOpen(false);
      // Reset form
      setNewTitle('');
      setNewCompany('');
      setNewLocation('');
      setNewDescription('');
      setNewSkills('');
      setNewExternalUrl('');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to post opportunity');
    }
  };

  const handleApply = async (e) => {
    e.preventDefault();
    if (!selectedJob) return;
    try {
      await applyToJob({
        id: selectedJob._id,
        note: applyNote.trim(),
        resumeUrl: applyResumeUrl.trim() || undefined,
        referralRequested: applyReferral,
      }).unwrap();
      toast.success(
        selectedJob.applyMode === 'external_link'
          ? 'Application intent recorded! Redirecting to company portal...'
          : 'Application submitted! The alumni poster has been notified.'
      );
      if (selectedJob.applyMode === 'external_link' && selectedJob.externalUrl) {
        window.open(selectedJob.externalUrl, '_blank', 'noreferrer');
      }
      setSelectedJob(null);
      setApplyNote('');
      setApplyResumeUrl('');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to apply');
    }
  };

  const handleWithdraw = async (appId) => {
    if (!window.confirm('Are you sure you want to withdraw your application?')) return;
    try {
      await withdrawApplication(appId).unwrap();
      toast.success('Application withdrawn');
      setSelectedJob(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to withdraw application');
    }
  };

  const handleStatusUpdate = async (appId, newStatus) => {
    try {
      await updateApplication({ id: appId, status: newStatus }).unwrap();
      toast.success(`Candidate marked as ${newStatus}`);
      refetchApplicants();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update applicant status');
    }
  };

  return (
    <div className="space-y-6">
      {/* Search & Actions Bar */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search opportunities by title, company, skills..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-10 text-sm"
              />
            </div>

            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              className="input text-xs sm:w-auto"
            >
              <option value="">All Job Types</option>
              {Object.entries(JOB_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <select
              value={workMode}
              onChange={(e) => setWorkMode(e.target.value)}
              className="input text-xs sm:w-auto"
            >
              <option value="">All Work Modes</option>
              {Object.entries(WORK_MODE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            {canPost && (
              <label className="flex cursor-pointer items-center gap-2 text-xs select-none">
                <input
                  type="checkbox"
                  checked={mineOnly}
                  onChange={(e) => setMineOnly(e.target.checked)}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="font-medium text-slate-700 dark:text-slate-300">My Postings</span>
              </label>
            )}

            {canPost && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setPostModalOpen(true)}
                className="shrink-0 font-bold"
              >
                <Plus className="mr-1 h-4 w-4" /> Post Opportunity
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Jobs Grid / List */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </Card>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No Opportunities Found"
          text="No jobs or internships match your filter criteria at this time."
          action={
            canPost && (
              <Button variant="primary" size="sm" onClick={() => setPostModalOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Share First Opportunity
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => {
            const isClosed = job.status === 'closed' || job.status === 'expired';
            const daysLeft = Math.ceil((new Date(job.deadline) - new Date()) / (1000 * 60 * 60 * 24));
            const hasApplied = myApps.some((a) => a.job?._id === job._id || a.job === job._id);

            return (
              <Card
                key={job._id}
                hover
                onClick={() => setSelectedJob(job)}
                className={`flex flex-col justify-between border border-slate-200/70 p-5 transition-all duration-300 hover:shadow-lg dark:border-white/10 ${
                  isClosed ? 'opacity-70' : ''
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="line-clamp-1 text-base font-bold text-ink dark:text-white hover:text-primary-600 dark:hover:text-primary-400">
                        {job.title}
                      </h3>
                      <p className="mt-0.5 font-semibold text-primary-600 dark:text-primary-400 text-xs">
                        {job.company}
                      </p>
                    </div>
                    <Badge color={job.type === 'internship' ? 'info' : 'primary'}>
                      {JOB_TYPE_LABELS[job.type] || job.type}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {job.location} ({WORK_MODE_LABELS[job.workMode] || job.workMode})
                    </span>
                  </div>

                  <p className="mt-3 line-clamp-2 text-xs text-slate-600 leading-relaxed dark:text-slate-300">
                    {job.description}
                  </p>

                  {/* Skills tags */}
                  {job.skills?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {job.skills.slice(0, 3).map((s) => (
                        <span
                          key={s}
                          className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-white/10 dark:text-slate-300"
                        >
                          {s}
                        </span>
                      ))}
                      {job.skills.length > 3 && (
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400 dark:bg-white/10">
                          +{job.skills.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs dark:border-white/5">
                  <div className="flex items-center gap-2">
                    <Avatar user={job.poster} size="xs" />
                    <span className="line-clamp-1 font-medium text-slate-500 dark:text-slate-400">
                      {job.poster?.name || 'Alumni'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-semibold">
                    {hasApplied && (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                        <CheckCircle className="h-3.5 w-3.5" /> Applied
                      </span>
                    )}
                    {job.applyMode === 'referral' && (
                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                        Referral
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Post Opportunity Modal */}
      <Modal
        open={postModalOpen}
        onClose={() => setPostModalOpen(false)}
        title="Post Career Opportunity"
        subtitle="Share job or internship openings with students and junior alumni"
        size="lg"
      >
        <form onSubmit={handleCreateJob} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Job Title" required>
              <Input
                placeholder="e.g. Associate Software Engineer"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                required
              />
            </Field>

            <Field label="Company / Organization" required>
              <Input
                placeholder="e.g. Google India / Zoho"
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                required
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Job Type">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="input text-sm"
              >
                {Object.entries(JOB_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Work Mode">
              <select
                value={newWorkMode}
                onChange={(e) => setNewWorkMode(e.target.value)}
                className="input text-sm"
              >
                {Object.entries(WORK_MODE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Location" required>
              <Input
                placeholder="e.g. Bengaluru / Chennai"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                required
              />
            </Field>
          </div>

          <Field label="Job Description & Responsibilities" required>
            <Textarea
              rows={4}
              placeholder="Describe the role, key responsibilities, requirements, and interview process..."
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              required
            />
          </Field>

          <Field label="Required Skills (comma separated)">
            <Input
              placeholder="e.g. Python, React, Docker, SQL"
              value={newSkills}
              onChange={(e) => setNewSkills(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Application Process">
              <select
                value={newApplyMode}
                onChange={(e) => setNewApplyMode(e.target.value)}
                className="input text-sm"
              >
                <option value="referral">Internal Referral (Students submit note/resume)</option>
                <option value="external_link">External Career Site Link</option>
              </select>
            </Field>

            <Field label="Application Deadline" required>
              <input
                type="date"
                value={newDeadline}
                onChange={(e) => setNewDeadline(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="input text-sm"
                required
              />
            </Field>
          </div>

          {newApplyMode === 'external_link' && (
            <Field label="External Job Portal URL" required>
              <Input
                type="url"
                placeholder="https://company.com/careers/job-1234"
                value={newExternalUrl}
                onChange={(e) => setNewExternalUrl(e.target.value)}
                required
              />
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" type="button" onClick={() => setPostModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={isPosting}>
              Publish Opportunity
            </Button>
          </div>
        </form>
      </Modal>

      {/* Job Details & Applications Drawer Modal */}
      {selectedJob && (
        <Modal
          open={!!selectedJob}
          onClose={() => setSelectedJob(null)}
          title={selectedJob.title}
          subtitle={`${selectedJob.company} • ${selectedJob.location} (${selectedJob.workMode})`}
          size="lg"
        >
          <div className="space-y-6">
            {/* Metadata Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 text-xs dark:border-white/5">
              <div className="flex items-center gap-2">
                <Avatar user={selectedJob.poster} size="sm" />
                <div>
                  <p className="font-bold">{selectedJob.poster?.name}</p>
                  <p className="muted">Posted on {new Date(selectedJob.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge color={selectedJob.type === 'internship' ? 'info' : 'primary'}>
                  {JOB_TYPE_LABELS[selectedJob.type] || selectedJob.type}
                </Badge>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                  Deadline: {new Date(selectedJob.deadline).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Description */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                Description
              </h4>
              <p className="whitespace-pre-line text-sm text-slate-700 leading-relaxed dark:text-slate-300">
                {selectedJob.description}
              </p>
            </div>

            {/* Skills */}
            {selectedJob.skills?.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Required Skills
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {selectedJob.skills.map((s) => (
                    <span
                      key={s}
                      className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-200"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Application Section for Students */}
            {isStudent && (
              <div className="rounded-2xl border border-primary-500/20 bg-primary-50/40 p-4 dark:bg-primary-500/5">
                {myCurrentApp ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        <div>
                          <p className="text-sm font-bold">You have applied for this role</p>
                          <p className="text-xs muted">
                            Submitted on {new Date(myCurrentApp.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <Badge color={APPLICATION_STATUS_COLORS[myCurrentApp.status] || 'neutral'}>
                        Status: {myCurrentApp.status}
                      </Badge>
                    </div>

                    {myCurrentApp.posterNote && (
                      <div className="rounded-xl bg-white p-3 text-xs shadow-sm dark:bg-white/5">
                        <p className="font-bold text-primary-600 dark:text-primary-400">Note from Poster:</p>
                        <p className="mt-0.5 text-slate-700 dark:text-slate-300">{myCurrentApp.posterNote}</p>
                      </div>
                    )}

                    {myCurrentApp.status !== 'withdrawn' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleWithdraw(myCurrentApp._id)}
                        className="text-xs text-rose-600"
                      >
                        Withdraw Application
                      </Button>
                    )}
                  </div>
                ) : (
                  <form onSubmit={handleApply} className="space-y-3">
                    <h4 className="font-bold text-sm text-ink flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-primary-600" /> Submit Application
                    </h4>

                    <Field label="Why are you a good fit?" hint="Brief pitch to the alumni poster (up to 500 chars)">
                      <Textarea
                        rows={3}
                        placeholder="I have experience with React, built 2 production full-stack apps, and would love to contribute..."
                        value={applyNote}
                        onChange={(e) => setApplyNote(e.target.value.slice(0, 500))}
                      />
                    </Field>

                    <Field label="Resume / Portfolio URL (optional)" hint="Google Drive, Dropbox, or Portfolio Link">
                      <Input
                        type="url"
                        placeholder="https://drive.google.com/file/d/..."
                        value={applyResumeUrl}
                        onChange={(e) => setApplyResumeUrl(e.target.value)}
                      />
                    </Field>

                    {selectedJob.applyMode === 'referral' && (
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold select-none">
                        <input
                          type="checkbox"
                          checked={applyReferral}
                          onChange={(e) => setApplyReferral(e.target.checked)}
                          className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span>Request internal referral directly from the alumni poster</span>
                      </label>
                    )}

                    <Button variant="primary" type="submit" loading={isApplying} className="w-full justify-center">
                      {selectedJob.applyMode === 'external_link' ? 'Proceed to External Application' : 'Submit Application'}
                    </Button>
                  </form>
                )}
              </div>
            )}

            {/* Poster / Staff Management View: Applicants Table */}
            {isPosterOrStaff && (
              <div className="border-t border-slate-100 pt-4 dark:border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold flex items-center gap-2">
                    <Users className="h-4 w-4" /> Applicants ({applicants.length})
                  </h4>
                  <div className="flex gap-2">
                    {selectedJob.status === 'open' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await closeJob(selectedJob._id);
                          toast.success('Job closed');
                          setSelectedJob(null);
                        }}
                      >
                        Close Applications
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await reopenJob(selectedJob._id);
                          toast.success('Job reopened');
                          setSelectedJob(null);
                        }}
                      >
                        Reopen Job
                      </Button>
                    )}
                  </div>
                </div>

                {applicants.length === 0 ? (
                  <p className="text-xs muted text-center py-4">No student applications received yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-white/5 overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10">
                    {applicants.map((app) => (
                      <div key={app._id} className="p-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <Avatar user={app.student} size="sm" />
                          <div>
                            <p className="font-bold text-sm text-ink dark:text-white">{app.student?.name}</p>
                            <p className="text-slate-500 dark:text-slate-400">
                              {app.student?.department} • Year {app.student?.year || '—'} • {app.student?.email}
                            </p>
                            {app.note && <p className="mt-1 text-slate-700 italic dark:text-slate-300">"{app.note}"</p>}
                            {app.resumeUrl && (
                              <a
                                href={app.resumeUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex items-center gap-1 font-semibold text-primary-600 hover:underline"
                              >
                                <FileText className="h-3 w-3" /> View Resume
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <select
                            value={app.status}
                            onChange={(e) => handleStatusUpdate(app._id, e.target.value)}
                            className="input text-xs font-semibold py-1 px-2"
                          >
                            <option value="applied">Applied</option>
                            <option value="referred">Referred</option>
                            <option value="shortlisted">Shortlisted</option>
                            <option value="rejected">Rejected</option>
                            <option value="hired">Hired</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
