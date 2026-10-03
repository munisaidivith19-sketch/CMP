import { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import {
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Lock,
  Globe,
  Users,
  Eye,
  Briefcase,
  MapPin,
  Mail,
  Phone,
  Linkedin,
  Github,
  Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { selectUser } from '../../features/authSlice';
import {
  useGetMyAlumniProfileQuery,
  useUpsertAlumniProfileMutation,
} from '../../services/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ProgressBar,
  Skeleton,
} from '../../components/ui/primitives';
import { Field, Input, Select, Textarea } from '../../components/ui/form';
import { MENTORSHIP_DOMAINS, PRIVACY_FIELDS, PRIVACY_LEVELS, DEFAULT_PRIVACY } from '../../utils/constants';

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

const PRIVACY_LABELS = {
  public: 'Public (Everyone)',
  mentees: 'Accepted Mentees & Staff',
  staff: 'Campus Staff Only',
  hidden: 'Hidden (Only Me)',
};

export default function AlumniProfileTab() {
  const currentUser = useSelector(selectUser);
  const { data: profile, isLoading } = useGetMyAlumniProfileQuery();
  const [upsertProfile, { isLoading: isSaving }] = useUpsertAlumniProfileMutation();

  // Form State
  const [gradYear, setGradYear] = useState('');
  const [company, setCompany] = useState('');
  const [designation, setDesignation] = useState('');
  const [currentLocation, setCurrentLocation] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [domains, setDomains] = useState([]);
  const [mentorshipAvailable, setMentorshipAvailable] = useState(true);
  const [maxActiveMentees, setMaxActiveMentees] = useState(3);
  const [openToReferrals, setOpenToReferrals] = useState(true);
  const [showInDirectory, setShowInDirectory] = useState(true);
  const [linkedin, setLinkedin] = useState('');
  const [github, setGithub] = useState('');
  const [privacy, setPrivacy] = useState(DEFAULT_PRIVACY);

  // Sync state when data loads
  useEffect(() => {
    if (profile) {
      setGradYear(profile.gradYear || currentUser?.year || '');
      setCompany(profile.company || '');
      setDesignation(profile.designation || '');
      setCurrentLocation(profile.currentLocation || '');
      setSkillsText(profile.skills?.join(', ') || '');
      setDomains(profile.domains || []);
      setMentorshipAvailable(profile.mentorshipAvailable ?? true);
      setMaxActiveMentees(profile.maxActiveMentees ?? 3);
      setOpenToReferrals(profile.openToReferrals ?? true);
      setShowInDirectory(profile.showInDirectory ?? true);
      setLinkedin(profile.social?.linkedin || '');
      setGithub(profile.social?.github || '');
      setPrivacy({ ...DEFAULT_PRIVACY, ...(profile.privacy || {}) });
    }
  }, [profile, currentUser]);

  // Completeness calculation
  const completeness = useMemo(() => {
    let score = 0;
    if (gradYear) score += 15;
    if (company) score += 20;
    if (designation) score += 15;
    if (currentLocation) score += 10;
    if (skillsText.trim()) score += 15;
    if (domains.length > 0) score += 15;
    if (linkedin || github) score += 10;
    return Math.min(100, score);
  }, [gradYear, company, designation, currentLocation, skillsText, domains, linkedin, github]);

  const handleDomainToggle = (d) => {
    setDomains((prev) => (prev.includes(d) ? prev.filter((item) => item !== d) : [...prev, d]));
  };

  const handlePrivacyChange = (field, level) => {
    setPrivacy((prev) => ({ ...prev, [field]: level }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const skillsArray = skillsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await upsertProfile({
        gradYear: gradYear ? Number(gradYear) : undefined,
        company: company.trim(),
        designation: designation.trim(),
        currentLocation: currentLocation.trim(),
        skills: skillsArray,
        domains,
        mentorshipAvailable,
        maxActiveMentees: Number(maxActiveMentees),
        openToReferrals,
        showInDirectory,
        privacy,
        social: {
          linkedin: linkedin.trim() || undefined,
          github: github.trim() || undefined,
        },
      }).unwrap();

      toast.success('Alumni profile and privacy matrix updated!');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update profile');
    }
  };

  if (isLoading) {
    return (
      <Card className="p-6 space-y-4">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Verification Status Banner */}
      {profile?.isVerified ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-50/60 p-4 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
          <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div>
            <p className="font-bold text-sm">Verified Alumni Profile</p>
            <p className="text-xs">
              Your profile is verified and visible in the campus alumni directory.
            </p>
          </div>
        </div>
      ) : profile?.rejectionReason ? (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-50/70 p-4 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle className="h-6 w-6 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-sm">Verification Action Needed</p>
            <p className="text-xs mt-0.5">
              Reason from reviewer: <span className="font-semibold">"{profile.rejectionReason}"</span>
            </p>
            <p className="text-xs mt-1 text-rose-600/90 dark:text-rose-400">
              Please update your graduation year, company, or details below and save to resubmit.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-50/60 p-4 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400 shrink-0" />
          <div>
            <p className="font-bold text-sm">Pending Verification</p>
            <p className="text-xs">
              Your alumni profile is awaiting confirmation by your department HOD or admin. Once approved, you'll be featured in the directory.
            </p>
          </div>
        </div>
      )}

      {/* Completeness Card */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div>
            <h3 className="font-bold text-sm">Profile Completeness</h3>
            <p className="text-xs muted">Complete profiles attract more mentorship requests and peer connections</p>
          </div>
          <span className="text-sm font-extrabold text-primary-600 dark:text-primary-400">
            {completeness}%
          </span>
        </div>
        <ProgressBar value={completeness} max={100} />
      </Card>

      {/* Main Profile Info */}
      <Card className="p-5 sm:p-6 space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Briefcase className="h-4 w-4" /> Professional & Academic Details
        </h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Graduation Year" required>
            <Input
              type="number"
              min="1970"
              max={new Date().getFullYear() + 1}
              value={gradYear}
              onChange={(e) => setGradYear(e.target.value)}
              placeholder="e.g. 2022"
              required
            />
          </Field>

          <Field label="Current Company / Organization" required>
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Google India / Qualcomm"
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Designation / Job Role" required>
            <Input
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="e.g. Senior Software Engineer"
              required
            />
          </Field>

          <Field label="Current Location (City, Country)">
            <Input
              value={currentLocation}
              onChange={(e) => setCurrentLocation(e.target.value)}
              placeholder="e.g. Bengaluru, India"
            />
          </Field>
        </div>

        <Field label="Skills & Technologies (comma separated)" hint="e.g. Python, Distributed Systems, Docker, System Design">
          <Input
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
            placeholder="Go, Kubernetes, Cloud Architecture, GraphQL"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="LinkedIn Profile URL">
            <Input
              type="url"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="https://linkedin.com/in/yourname"
            />
          </Field>

          <Field label="GitHub / Portfolio URL">
            <Input
              type="url"
              value={github}
              onChange={(e) => setGithub(e.target.value)}
              placeholder="https://github.com/yourname"
            />
          </Field>
        </div>
      </Card>

      {/* Mentorship Settings */}
      <Card className="p-5 sm:p-6 space-y-4">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Mentorship & Career Settings
        </h3>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Mentorship Focus Domains
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MENTORSHIP_DOMAINS.map((d) => (
              <label
                key={d}
                className={`flex items-center gap-2 rounded-xl p-2.5 border text-xs font-medium cursor-pointer transition-all ${
                  domains.includes(d)
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 font-bold'
                    : 'border-slate-200 hover:border-primary-300 dark:border-white/10'
                }`}
              >
                <input
                  type="checkbox"
                  checked={domains.includes(d)}
                  onChange={() => handleDomainToggle(d)}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                <span>{DOMAIN_LABELS[d] || d}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2 border-t border-slate-100 dark:border-white/5">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mentorshipAvailable}
                onChange={(e) => setMentorshipAvailable(e.target.checked)}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span>Available for Student Mentorship</span>
            </label>

            <Field label={`Max Active Mentees Capacity (${maxActiveMentees})`} hint="Maximum concurrent students you can mentor">
              <input
                type="range"
                min="0"
                max="10"
                value={maxActiveMentees}
                onChange={(e) => setMaxActiveMentees(e.target.value)}
                className="w-full accent-primary-600"
              />
            </Field>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
              <input
                type="checkbox"
                checked={openToReferrals}
                onChange={(e) => setOpenToReferrals(e.target.checked)}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span>Open to Company Job Referrals</span>
            </label>

            <label className="flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showInDirectory}
                onChange={(e) => setShowInDirectory(e.target.checked)}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span>Show Profile in Alumni Directory</span>
            </label>
          </div>
        </div>
      </Card>

      {/* 6-Field Privacy Matrix */}
      <Card className="p-5 sm:p-6 space-y-4">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <Lock className="h-4 w-4" /> Granular Privacy Matrix
          </h3>
          <p className="text-xs muted mt-0.5">
            Control exactly who can view your sensitive contact details and work identity.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-white/5 uppercase text-[10px] font-bold text-slate-500">
              <tr>
                <th className="p-3">Field</th>
                <th className="p-3">Visibility Level</th>
                <th className="p-3">Applies To</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {PRIVACY_FIELDS.map((field) => (
                <tr key={field} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                  <td className="p-3 font-bold capitalize text-ink">
                    {field}
                  </td>
                  <td className="p-3">
                    <select
                      value={privacy[field] || DEFAULT_PRIVACY[field]}
                      onChange={(e) => handlePrivacyChange(field, e.target.value)}
                      className="input text-xs font-semibold py-1 px-2.5"
                    >
                      {PRIVACY_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {PRIVACY_LABELS[lvl]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3 text-slate-500">
                    {privacy[field] === 'public'
                      ? 'Visible to all students, alumni, and staff'
                      : privacy[field] === 'mentees'
                      ? 'Visible only to accepted mentees and campus staff'
                      : privacy[field] === 'staff'
                      ? 'Visible only to verified faculty & HOD'
                      : 'Never displayed to others'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Live Preview: How Students See You */}
      <Card className="p-5 sm:p-6 space-y-3 bg-gradient-to-br from-primary-50/40 to-transparent dark:from-primary-500/5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Eye className="h-4 w-4" /> Live Preview: How Students See You
        </h4>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#1b1d3a]">
          <div className="flex items-center gap-3">
            <Avatar user={currentUser} size="lg" />
            <div>
              <h5 className="font-bold text-sm text-ink">{currentUser?.name}</h5>
              <p className="text-xs text-primary-600 dark:text-primary-400 font-semibold">
                {privacy.designation === 'hidden' ? '[Designation Hidden]' : designation || 'Role'} •{' '}
                {privacy.company === 'hidden' ? '[Company Hidden]' : company || 'Company'}
              </p>
              <p className="text-xs text-slate-500">
                Class of {gradYear || '—'} • {currentUser?.department}
              </p>
              {currentLocation && privacy.location !== 'hidden' && (
                <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3 w-3" /> {currentLocation}
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs dark:border-white/5">
            <span className="flex items-center gap-1 text-slate-500">
              <Mail className="h-3.5 w-3.5" />{' '}
              {privacy.email === 'public'
                ? currentUser?.email
                : privacy.email === 'mentees'
                ? 'Visible upon request acceptance'
                : 'Hidden'}
            </span>
            {currentUser?.phone && (
              <span className="flex items-center gap-1 text-slate-500">
                <Phone className="h-3.5 w-3.5" />{' '}
                {privacy.phone === 'public'
                  ? currentUser?.phone
                  : privacy.phone === 'mentees'
                  ? 'Visible upon request acceptance'
                  : 'Hidden'}
              </span>
            )}
            {linkedin && privacy.linkedin !== 'hidden' && (
              <span className="flex items-center gap-1 text-blue-600 font-medium">
                <Linkedin className="h-3.5 w-3.5" /> LinkedIn
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="primary" type="submit" loading={isSaving} className="font-bold">
          <Save className="mr-1.5 h-4 w-4" /> Save Profile & Settings
        </Button>
      </div>
    </form>
  );
}
