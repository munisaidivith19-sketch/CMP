import { useState, useMemo } from 'react';
import { useSelector } from 'react-redux';
import {
  Search,
  Filter,
  Star,
  Briefcase,
  MapPin,
  ShieldCheck,
  GraduationCap,
  MessageSquare,
  Sparkles,
  CheckCircle2,
  ExternalLink,
  Mail,
  Phone,
  Linkedin,
  Github,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useGetAlumniQuery,
  useGetAlumniFiltersQuery,
  useCreateMentorshipRequestMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Pagination,
  Skeleton,
} from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { MENTORSHIP_DOMAINS } from '../../utils/constants';

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

export default function AlumniDirectoryTab() {
  const currentUser = useSelector(selectUser);
  const isStudent = currentUser?.role === 'student' || currentUser?.role === 'club_admin';

  // Filters state
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [domain, setDomain] = useState('');
  const [mentorshipOnly, setMentorshipOnly] = useState(false);
  const [referralsOnly, setReferralsOnly] = useState(false);
  const [sort, setSort] = useState('rating');
  const [page, setPage] = useState(1);

  // Modals state
  const [profileModalUser, setProfileModalUser] = useState(null);
  const [requestModalMentor, setRequestModalMentor] = useState(null);
  const [requestDomain, setRequestDomain] = useState('');
  const [requestMessage, setRequestMessage] = useState('');

  // Queries
  const { data: filtersData } = useGetAlumniFiltersQuery();
  const queryParams = useMemo(() => {
    const p = { page, limit: 12, sort };
    if (search.trim()) p.search = search.trim();
    if (department) p.department = department;
    if (gradYear) p.gradYear = gradYear;
    if (domain) p.domain = domain;
    if (mentorshipOnly) p.mentorshipAvailable = true;
    if (referralsOnly) p.openToReferrals = true;
    return p;
  }, [page, sort, search, department, gradYear, domain, mentorshipOnly, referralsOnly]);

  const { data, isLoading, isFetching } = useGetAlumniQuery(queryParams);
  const [createMentorshipRequest, { isLoading: isSubmittingRequest }] = useCreateMentorshipRequestMutation();

  const handleOpenRequest = (alumniItem, e) => {
    e?.stopPropagation();
    setRequestModalMentor(alumniItem);
    setRequestDomain(alumniItem.domains?.[0] || 'software_engineering');
    setRequestMessage('');
  };

  const handleSendRequest = async (e) => {
    e.preventDefault();
    if (!requestModalMentor) return;
    if (requestMessage.trim().length < 5) {
      toast.error('Please write a brief note (at least 5 characters) explaining what you need guidance on.');
      return;
    }
    try {
      await createMentorshipRequest({
        alumni: requestModalMentor.user?._id || requestModalMentor.user,
        domain: requestDomain,
        message: requestMessage.trim(),
      }).unwrap();
      toast.success('Mentorship request sent! You will be notified when the alumni responds.');
      setRequestModalMentor(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to send mentorship request');
    }
  };

  const alumniList = data?.items || data?.alumni || [];
  const totalPages = data?.pages || 1;

  return (
    <div className="space-y-6">
      {/* Search & Filter Toolbar */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search alumni by name, company, designation, skills..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="input pl-10 text-sm"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setPage(1);
              }}
              className="input text-xs sm:w-auto"
            >
              <option value="">All Departments</option>
              {filtersData?.departments?.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              value={gradYear}
              onChange={(e) => {
                setGradYear(e.target.value);
                setPage(1);
              }}
              className="input text-xs sm:w-auto"
            >
              <option value="">All Batches</option>
              {filtersData?.gradYears?.map((y) => (
                <option key={y} value={y}>
                  Class of {y}
                </option>
              ))}
            </select>

            <select
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                setPage(1);
              }}
              className="input text-xs sm:w-auto"
            >
              <option value="">All Domains</option>
              {MENTORSHIP_DOMAINS.map((dm) => (
                <option key={dm} value={dm}>
                  {DOMAIN_LABELS[dm] || dm}
                </option>
              ))}
            </select>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="input text-xs sm:w-auto font-medium"
            >
              <option value="rating">Top Rated ★</option>
              <option value="recent">Recently Added</option>
              <option value="gradYear">Graduation Year</option>
              <option value="name">Name (A-Z)</option>
            </select>
          </div>
        </div>

        {/* Quick Checkbox Chips */}
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs dark:border-white/5">
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={mentorshipOnly}
              onChange={(e) => {
                setMentorshipOnly(e.target.checked);
                setPage(1);
              }}
              className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Available for Mentoring only
            </span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={referralsOnly}
              onChange={(e) => {
                setReferralsOnly(e.target.checked);
                setPage(1);
              }}
              className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Open to Job Referrals only
            </span>
          </label>

          {(department || gradYear || domain || mentorshipOnly || referralsOnly || search) && (
            <button
              onClick={() => {
                setSearch('');
                setDepartment('');
                setGradYear('');
                setDomain('');
                setMentorshipOnly(false);
                setReferralsOnly(false);
                setPage(1);
              }}
              className="ml-auto text-xs font-semibold text-rose-500 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </Card>

      {/* Directory Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-2xl" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-8 w-full rounded-xl" />
            </Card>
          ))}
        </div>
      ) : alumniList.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No Alumni Found"
          text="Try adjusting your search criteria or clearing filters to see more alumni mentors."
          action={
            (department || gradYear || domain || mentorshipOnly || referralsOnly || search) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setDepartment('');
                  setGradYear('');
                  setDomain('');
                  setMentorshipOnly(false);
                  setReferralsOnly(false);
                }}
              >
                Reset All Filters
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {alumniList.map((item) => {
            const u = item.user || {};
            const isFull = (item.activeMenteeCount || 0) >= (item.maxActiveMentees || 2);
            const canRequest = isStudent && item.mentorshipAvailable && !isFull;

            return (
              <Card
                key={item._id}
                hover
                onClick={() => setProfileModalUser(item)}
                className="group relative flex flex-col justify-between overflow-hidden border border-slate-200/70 p-5 transition-all duration-300 hover:shadow-lg dark:border-white/10"
              >
                <div>
                  {/* Top Bar: Avatar & Verification */}
                  <div className="flex items-start justify-between gap-3">
                    <Avatar user={u} size="lg" className="ring-2 ring-primary-500/20" />
                    <div className="flex flex-col items-end gap-1">
                      {item.isVerified && (
                        <span
                          title="Verified Campus Alumni"
                          className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                        >
                          <ShieldCheck className="h-3 w-3" /> Verified
                        </span>
                      )}
                      {item.ratingAvg > 0 && (
                        <span className="flex items-center gap-1 text-xs font-extrabold text-amber-500">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          {item.ratingAvg.toFixed(1)}
                          <span className="text-[10px] font-normal text-slate-400">
                            ({item.ratingCount})
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Name and Designation */}
                  <div className="mt-3">
                    <h3 className="line-clamp-1 font-bold text-ink dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400">
                      {u.name || 'Alumni Member'}
                    </h3>
                    <p className="mt-0.5 line-clamp-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                      {item.designation || 'Alumni'}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs font-semibold text-primary-600 dark:text-primary-400">
                      {item.company || u.department}
                    </p>
                  </div>

                  {/* Batch & Dept Badges */}
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    {item.gradYear && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                        Class of {item.gradYear}
                      </span>
                    )}
                    {u.department && (
                      <span className="rounded-md bg-primary-50 px-2 py-0.5 font-medium text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                        {u.department}
                      </span>
                    )}
                    {item.currentLocation && (
                      <span className="flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-slate-500 dark:bg-white/5 dark:text-slate-400">
                        <MapPin className="h-3 w-3" />
                        {item.currentLocation}
                      </span>
                    )}
                  </div>

                  {/* Mentorship Domains */}
                  {item.domains?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {item.domains.slice(0, 2).map((d) => (
                        <span
                          key={d}
                          className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                        >
                          {DOMAIN_LABELS[d] || d}
                        </span>
                      ))}
                      {item.domains.length > 2 && (
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/10">
                          +{item.domains.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Bottom Capacity & Action Bar */}
                <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/5">
                  <div className="flex items-center justify-between gap-2">
                    {item.mentorshipAvailable ? (
                      <span
                        className={`text-[11px] font-bold ${
                          isFull
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {isFull
                          ? 'Capacity Full'
                          : `${item.activeMenteeCount || 0}/${item.maxActiveMentees || 2} Mentees`}
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-slate-400">
                        Mentorship closed
                      </span>
                    )}

                    {item.openToReferrals && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                        Referrals
                      </span>
                    )}
                  </div>

                  {canRequest && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="mt-2.5 w-full justify-center text-xs font-bold"
                      onClick={(e) => handleOpenRequest(item, e)}
                    >
                      <Sparkles className="mr-1 h-3.5 w-3.5" /> Request Mentorship
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      <Pagination page={page} pages={totalPages} onChange={setPage} />

      {/* Profile Detail Modal */}
      {profileModalUser && (
        <Modal
          open={!!profileModalUser}
          onClose={() => setProfileModalUser(null)}
          title={profileModalUser.user?.name || 'Alumni Profile'}
          subtitle={`${profileModalUser.designation || 'Alumni'} at ${
            profileModalUser.company || profileModalUser.user?.department
          }`}
          size="md"
        >
          <div className="space-y-5">
            {/* Header Identity */}
            <div className="flex items-center gap-4">
              <Avatar user={profileModalUser.user} size="xl" />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold">{profileModalUser.user?.name}</h3>
                  {profileModalUser.isVerified && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                      <ShieldCheck className="h-3.5 w-3.5" /> Verified
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-primary-600 dark:text-primary-400">
                  {profileModalUser.designation} • {profileModalUser.company}
                </p>
                <p className="text-xs muted">
                  Class of {profileModalUser.gradYear} • {profileModalUser.user?.department}
                </p>
                {profileModalUser.currentLocation && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3.5 w-3.5" /> {profileModalUser.currentLocation}
                  </p>
                )}
              </div>
            </div>

            {/* Bio */}
            {profileModalUser.user?.bio && (
              <div className="rounded-2xl bg-slate-50 p-3.5 text-xs text-slate-700 dark:bg-white/5 dark:text-slate-300">
                <p className="font-semibold uppercase tracking-wider text-[10px] text-slate-400 mb-1">
                  About
                </p>
                <p className="leading-relaxed">{profileModalUser.user.bio}</p>
              </div>
            )}

            {/* Skills */}
            {profileModalUser.skills?.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Core Skills & Technologies
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {profileModalUser.skills.map((s) => (
                    <span
                      key={s}
                      className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Mentorship Domains */}
            {profileModalUser.domains?.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Mentorship Focus Areas
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {profileModalUser.domains.map((d) => (
                    <Badge key={d} color="primary">
                      {DOMAIN_LABELS[d] || d}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Privacy Respected Contact / Social */}
            <div className="border-t border-slate-100 pt-3 dark:border-white/5">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Connect
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                {profileModalUser.user?.email && (
                  <a
                    href={`mailto:${profileModalUser.user.email}`}
                    className="flex items-center gap-1.5 font-medium text-primary-600 hover:underline dark:text-primary-400"
                  >
                    <Mail className="h-3.5 w-3.5" /> {profileModalUser.user.email}
                  </a>
                )}
                {profileModalUser.user?.phone && (
                  <span className="flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-400">
                    <Phone className="h-3.5 w-3.5" /> {profileModalUser.user.phone}
                  </span>
                )}
                {profileModalUser.social?.linkedin && (
                  <a
                    href={profileModalUser.social.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-medium text-blue-600 hover:underline"
                  >
                    <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                  </a>
                )}
                {profileModalUser.social?.github && (
                  <a
                    href={profileModalUser.social.github}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-medium text-slate-700 hover:underline dark:text-slate-300"
                  >
                    <Github className="h-3.5 w-3.5" /> GitHub
                  </a>
                )}
              </div>
            </div>

            {/* Student Request Button inside modal */}
            {isStudent && profileModalUser.mentorshipAvailable && (
              <div className="pt-2">
                <Button
                  variant="primary"
                  className="w-full justify-center"
                  onClick={() => {
                    const m = profileModalUser;
                    setProfileModalUser(null);
                    handleOpenRequest(m);
                  }}
                >
                  <Sparkles className="mr-2 h-4 w-4" /> Request Mentorship with {profileModalUser.user?.name}
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Mentorship Request Modal */}
      {requestModalMentor && (
        <Modal
          open={!!requestModalMentor}
          onClose={() => setRequestModalMentor(null)}
          title="Request Mentorship"
          subtitle={`Reach out to ${requestModalMentor.user?.name || 'mentor'} for guidance`}
          size="md"
        >
          <form onSubmit={handleSendRequest} className="space-y-4">
            <div className="rounded-2xl bg-primary-50/70 p-3.5 text-xs text-primary-800 dark:bg-primary-500/10 dark:text-primary-200">
              <p className="font-bold">Tips for a great mentorship request:</p>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                <li>Be specific about what guidance or preparation you are seeking.</li>
                <li>Mention your current year, projects, or goals.</li>
                <li>Respect the alumni's time and busy schedule.</li>
              </ul>
            </div>

            <Field label="Guidance Domain / Topic" hint="Select the area you want advice on">
              <select
                value={requestDomain}
                onChange={(e) => setRequestDomain(e.target.value)}
                className="input text-sm"
                required
              >
                {requestModalMentor.domains?.map((d) => (
                  <option key={d} value={d}>
                    {DOMAIN_LABELS[d] || d}
                  </option>
                ))}
                {MENTORSHIP_DOMAINS.filter((d) => !requestModalMentor.domains?.includes(d)).map((d) => (
                  <option key={d} value={d}>
                    {DOMAIN_LABELS[d] || d}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Your Message to Mentor"
              hint={`${requestMessage.length}/500 characters (min 5)`}
            >
              <Textarea
                rows={4}
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value.slice(0, 500))}
                placeholder="Hi! I am working on distributed systems and would love advice on mock system design interviews..."
                required
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                type="button"
                onClick={() => setRequestModalMentor(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={isSubmittingRequest}
                disabled={requestMessage.trim().length < 5}
              >
                Send Mentorship Request
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
