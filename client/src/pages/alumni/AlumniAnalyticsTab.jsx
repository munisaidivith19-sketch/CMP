import { useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  Download,
  Users,
  ShieldCheck,
  Briefcase,
  Calendar,
  Sparkles,
  Star,
  MapPin,
  Building,
  GraduationCap,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useGetAlumniAnalyticsQuery } from '../../services/api';
import {
  Badge,
  Button,
  Card,
  ProgressBar,
  Skeleton,
  StatCard,
} from '../../components/ui/primitives';

export default function AlumniAnalyticsTab() {
  const [range, setRange] = useState('12w');
  const { data, isLoading, refetch } = useGetAlumniAnalyticsQuery({ range });

  const handleExportCSV = () => {
    window.open('/api/alumni/analytics/export', '_blank');
    toast.success('Downloading Alumni Directory CSV...');
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }

  const totals = data?.totals || {};
  const mentorship = data?.mentorship || {};
  const jobs = data?.jobs || {};
  const events = data?.events || {};
  const chapters = data?.chapters || {};

  return (
    <div className="space-y-6">
      {/* Top Banner with Export CSV */}
      <Card className="p-5 sm:p-6 bg-gradient-to-r from-primary-500/10 via-fuchsia-500/10 to-transparent">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-extrabold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary-600" /> Alumni Network Intelligence & Insights
            </h3>
            <p className="text-xs muted mt-1">
              Executive analytics on alumni verification, mentorship capacity, career referrals, and engagement.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="input text-xs sm:w-auto"
            >
              <option value="4w">Last 4 Weeks</option>
              <option value="12w">Last 12 Weeks</option>
              <option value="1y">Last 1 Year</option>
            </select>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              className="font-bold text-xs shrink-0"
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Export Directory CSV
            </Button>
          </div>
        </div>
      </Card>

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-4 flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Alumni</p>
          <p className="text-2xl font-extrabold text-ink mt-1">{totals.alumni || 0}</p>
          <p className="text-[10px] text-emerald-600 font-semibold mt-1">
            {totals.verified || 0} Verified
          </p>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active Mentors</p>
          <p className="text-2xl font-extrabold text-primary-600 dark:text-primary-400 mt-1">
            {totals.mentors || 0}
          </p>
          <p className="text-[10px] muted mt-1">
            {mentorship.capacityUtilisation ? `${Math.round(mentorship.capacityUtilisation * 100)}% Utilisation` : 'Ready'}
          </p>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Job Referrals</p>
          <p className="text-2xl font-extrabold text-ink mt-1">{totals.openToReferrals || 0}</p>
          <p className="text-[10px] text-blue-600 font-semibold mt-1">Alumni Willing</p>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Acceptance Rate</p>
          <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
            {mentorship.acceptanceRate ? `${Math.round(mentorship.acceptanceRate * 100)}%` : '0%'}
          </p>
          <p className="text-[10px] muted mt-1">
            ~{mentorship.medianResponseHours || 24}h avg response
          </p>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Open Jobs</p>
          <p className="text-2xl font-extrabold text-ink mt-1">{jobs.open || 0}</p>
          <p className="text-[10px] text-primary-600 font-semibold mt-1">
            {jobs.applications || 0} Applications
          </p>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Chapters</p>
          <p className="text-2xl font-extrabold text-ink mt-1">{chapters.count || 0}</p>
          <p className="text-[10px] text-slate-500 font-semibold mt-1">
            {chapters.members || 0} Members
          </p>
        </Card>
      </div>

      {/* Grid: Demographics Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Alumni by Department */}
        <Card className="p-5 sm:p-6 space-y-4">
          <h4 className="text-sm font-bold flex items-center gap-2">
            <GraduationCap className="h-4 w-4" /> Alumni Distribution by Department
          </h4>

          <div className="space-y-3">
            {data?.byDepartment?.length === 0 ? (
              <p className="text-xs muted py-4 text-center">No department data yet</p>
            ) : (
              data?.byDepartment?.map((d) => {
                const pct = totals.alumni ? Math.round((d.count / totals.alumni) * 100) : 0;
                return (
                  <div key={d.department} className="space-y-1 text-xs">
                    <div className="flex justify-between font-semibold">
                      <span>{d.department}</span>
                      <span className="text-slate-500">
                        {d.count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden dark:bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary-500 to-indigo-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Alumni by Graduation Year */}
        <Card className="p-5 sm:p-6 space-y-4">
          <h4 className="text-sm font-bold flex items-center gap-2">
            <Clock className="h-4 w-4" /> Alumni by Graduation Batch
          </h4>

          <div className="space-y-3">
            {data?.byGradYear?.length === 0 ? (
              <p className="text-xs muted py-4 text-center">No batch data yet</p>
            ) : (
              data?.byGradYear?.map((y) => {
                const pct = totals.alumni ? Math.round((y.count / totals.alumni) * 100) : 0;
                return (
                  <div key={y.year} className="space-y-1 text-xs">
                    <div className="flex justify-between font-semibold">
                      <span>Class of {y.year}</span>
                      <span className="text-slate-500">
                        {y.count} alumni ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden dark:bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {/* Grid: Companies & Locations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Companies */}
        <Card className="p-5 sm:p-6 space-y-4">
          <h4 className="text-sm font-bold flex items-center gap-2">
            <Building className="h-4 w-4" /> Top Employer Organizations
          </h4>

          <div className="space-y-2">
            {data?.topCompanies?.length === 0 ? (
              <p className="text-xs muted py-4 text-center">No company data yet</p>
            ) : (
              data?.topCompanies?.map((c, i) => (
                <div
                  key={c.company || i}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 text-xs font-semibold dark:bg-white/5"
                >
                  <span className="flex items-center gap-2 text-ink">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-[10px] font-bold text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">
                      {i + 1}
                    </span>
                    {c.company}
                  </span>
                  <Badge color="primary">{c.count} Alumni</Badge>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Top Locations */}
        <Card className="p-5 sm:p-6 space-y-4">
          <h4 className="text-sm font-bold flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Geographic Hubs
          </h4>

          <div className="space-y-2">
            {data?.topLocations?.length === 0 ? (
              <p className="text-xs muted py-4 text-center">No location data yet</p>
            ) : (
              data?.topLocations?.map((loc, i) => (
                <div
                  key={loc.location || i}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 text-xs font-semibold dark:bg-white/5"
                >
                  <span className="flex items-center gap-2 text-ink">
                    <MapPin className="h-4 w-4 text-primary-600" />
                    {loc.location}
                  </span>
                  <Badge color="info">{loc.count} Alumni</Badge>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Mentorship Health & Top Mentors */}
      <Card className="p-5 sm:p-6 space-y-5">
        <h4 className="text-sm font-bold flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Mentorship Program Performance & Leaderboard
        </h4>

        {/* Status Pills */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-center text-xs">
          <div className="rounded-2xl bg-amber-50 p-3 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <p className="font-bold">Pending</p>
            <p className="text-lg font-extrabold mt-0.5">
              {mentorship.requestsByStatus?.pending || 0}
            </p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
            <p className="font-bold">Accepted</p>
            <p className="text-lg font-extrabold mt-0.5">
              {mentorship.requestsByStatus?.accepted || 0}
            </p>
          </div>
          <div className="rounded-2xl bg-primary-50 p-3 text-primary-800 dark:bg-primary-500/10 dark:text-primary-300">
            <p className="font-bold">Completed</p>
            <p className="text-lg font-extrabold mt-0.5">
              {mentorship.requestsByStatus?.completed || 0}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3 text-slate-700 dark:bg-white/5 dark:text-slate-300">
            <p className="font-bold">Sessions Held</p>
            <p className="text-lg font-extrabold mt-0.5">
              {mentorship.sessionsCompleted || 0}
            </p>
          </div>
          <div className="rounded-2xl bg-rose-50 p-3 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
            <p className="font-bold">Declined</p>
            <p className="text-lg font-extrabold mt-0.5">
              {mentorship.requestsByStatus?.declined || 0}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3 text-slate-500 dark:bg-white/5">
            <p className="font-bold">Expired</p>
            <p className="text-lg font-extrabold mt-0.5">
              {mentorship.requestsByStatus?.expired || 0}
            </p>
          </div>
        </div>

        {/* Top Mentors Ranked */}
        {mentorship.topMentors?.length > 0 && (
          <div className="border-t border-slate-100 pt-4 dark:border-white/5 space-y-3">
            <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Highest-Rated Alumni Mentors
            </h5>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mentorship.topMentors.map((m, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-white/5"
                >
                  <div>
                    <p className="font-bold text-xs text-ink">{m.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {m.completed || 0} completed mentorships
                    </p>
                  </div>

                  <span className="flex items-center gap-1 text-xs font-bold text-amber-500">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {m.avgRating ? m.avgRating.toFixed(1) : '5.0'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
