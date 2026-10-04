import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  Award,
  Calendar,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  GraduationCap,
  Layers,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import {
  useGetAchievementsQuery,
  useGetAchievementStatsQuery,
  useResolveAchievementHideMutation,
} from '../../services/api';
import { exportAchievementsFile } from '../../services/reports';
import { selectUser } from '../../features/authSlice';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CategoryBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Skeleton,
  cn,
} from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import AchievementCard from './AchievementCard';
import AchievementForm from './AchievementForm';
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_LEVELS,
  ACHIEVEMENT_POST_ROLES,
  ACHIEVEMENT_STATS_ROLES,
  DEPARTMENTS,
} from '../../utils/constants';
import { errMsg, fmtDate } from '../../utils/format';

export default function Achievements() {
  const me = useSelector(selectUser);
  const [searchParams, setSearchParams] = useSearchParams();

  const canPost = ACHIEVEMENT_POST_ROLES.includes(me?.role);
  const canViewStats = ACHIEVEMENT_STATS_ROLES.includes(me?.role);
  const isStudent = me?.role === 'student' || me?.role === 'club_admin';
  const isAdmin = me?.role === 'admin';

  // Filters from query params
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [category, setCategory] = useState(searchParams.get('category') || '');
  const [level, setLevel] = useState(searchParams.get('level') || '');
  const [dept, setDept] = useState(searchParams.get('dept') || '');
  const [featured, setFeatured] = useState(searchParams.get('featured') === 'true');
  const [mineOnly, setMineOnly] = useState(searchParams.get('mine') === 'true');
  const [activeTab, setActiveTab] = useState('feed'); // 'feed' | 'requests'
  const [page, setPage] = useState(1);

  // Form modal
  const [formOpen, setFormOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Resolve hide request
  const [resolveHide] = useResolveAchievementHideMutation();

  const queryParams = {
    page,
    limit: 12,
    q: q || undefined,
    category: category || undefined,
    level: level || undefined,
    department: dept || undefined,
    featured: featured ? 'true' : undefined,
    mine: mineOnly ? 'true' : undefined,
  };

  const { data, isFetching, error, refetch } = useGetAchievementsQuery(queryParams);
  const { data: statsData } = useGetAchievementStatsQuery(undefined, { skip: !canViewStats });

  const achievements = data?.items || [];
  const total = data?.total || 0;
  const pages = data?.pages || 1;

  // Pending hide requests (for Principal or HOD poster)
  const pendingRequests = achievements
    .filter((a) => a.canEdit && a.hideRequests?.length > 0)
    .flatMap((a) => a.hideRequests.map((r) => ({ ...r, achievement: a })));

  const handleExport = async (format) => {
    try {
      setExporting(true);
      const filename = await exportAchievementsFile(
        {
          category: category || undefined,
          level: level || undefined,
          department: dept || undefined,
        },
        format
      );
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      toast.error(errMsg(err, 'Export failed'));
    } finally {
      setExporting(false);
    }
  };

  const handleResolveRequest = async (achievementId, reqId, action) => {
    try {
      await resolveHide({ id: achievementId, reqId, action }).unwrap();
      toast.success(action === 'approve' ? 'Student removed from achievement' : 'Request rejected');
      refetch();
    } catch (err) {
      toast.error(errMsg(err, 'Failed to update request'));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Trophy}
        title="Student Achievements"
        subtitle="Official recognitions, competition victories, hackathons, and academic honors."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canViewStats && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting}
                  onClick={() => handleExport('csv')}
                  icon={FileSpreadsheet}
                >
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting}
                  onClick={() => handleExport('pdf')}
                  icon={FileText}
                >
                  PDF
                </Button>
              </div>
            )}
            {canPost && (
              <Button icon={Plus} onClick={() => setFormOpen(true)}>
                Post Achievement
              </Button>
            )}
          </div>
        }
      />

      {/* Staff Stats Strip */}
      {canViewStats && statsData && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-soft">
              <Trophy className="h-6 w-6" />
            </div>
            <div>
              <p className="text-2xl font-extrabold text-ink dark:text-primary-50">{statsData.thisYear}</p>
              <p className="text-xs text-ink-muted">Honors this year</p>
            </div>
          </Card>
          <Card className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-600 to-indigo-700 text-white shadow-soft">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <p className="text-2xl font-extrabold text-ink dark:text-primary-50">{statsData.total}</p>
              <p className="text-xs text-ink-muted">All-time recognitions</p>
            </div>
          </Card>
          <Card className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-soft">
              <Award className="h-6 w-6" />
            </div>
            <div>
              <p className="text-2xl font-extrabold text-ink dark:text-primary-50 capitalize">
                {statsData.byLevel?.[0]?.key || 'National'}
              </p>
              <p className="text-xs text-ink-muted">
                Top level ({statsData.byLevel?.[0]?.count || 0} awards)
              </p>
            </div>
          </Card>
          <Card className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-600 to-pink-700 text-white shadow-soft">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div>
              <p className="truncate text-base font-extrabold text-ink dark:text-primary-50">
                {statsData.byDepartment?.[0]?.key || 'Active'}
              </p>
              <p className="text-xs text-ink-muted">Leading department</p>
            </div>
          </Card>
        </div>
      )}

      {/* Tabs if there are pending hide requests for this poster */}
      {canPost && pendingRequests.length > 0 && (
        <div className="flex gap-2 border-b border-white/40 pb-2 dark:border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab('feed')}
            className={cn('chip font-bold', activeTab === 'feed' ? 'chip-active' : '')}
          >
            All Achievements
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className={cn('chip font-bold relative', activeTab === 'requests' ? 'chip-active' : '')}
          >
            Student Opt-out Requests
            <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] text-white">
              {pendingRequests.length}
            </span>
          </button>
        </div>
      )}

      {activeTab === 'requests' ? (
        <Card className="space-y-4">
          <h3 className="section-title">Pending Student Opt-out / Hide Requests</h3>
          <p className="text-xs text-ink-muted">
            Students who were tagged in an achievement and submitted a privacy request to be removed from the post.
          </p>
          <div className="divide-y divide-white/20">
            {pendingRequests.map((req) => (
              <div key={req._id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-ink dark:text-primary-50">
                    {req.student?.name || 'A student'} on post: "{req.achievement.title}"
                  </p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Reason: {req.reason || 'No specific reason provided.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="soft"
                    size="sm"
                    className="text-emerald-700 dark:text-emerald-300"
                    onClick={() => handleResolveRequest(req.achievement._id, req._id, 'approve')}
                    icon={Check}
                  >
                    Approve Removal
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-rose-600 dark:text-rose-400"
                    onClick={() => handleResolveRequest(req.achievement._id, req._id, 'reject')}
                    icon={X}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <>
          {/* Filter Bar */}
          <Card className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {/* Search input */}
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search achievements, competitions, organizers, or students..."
                  className="input pl-10"
                />
              </div>

              {/* Quick toggle pills */}
              <div className="flex flex-wrap items-center gap-2">
                {isStudent && (
                  <button
                    type="button"
                    onClick={() => {
                      setMineOnly(!mineOnly);
                      setPage(1);
                    }}
                    className={cn('chip font-bold', mineOnly ? 'chip-active' : '')}
                  >
                    <Trophy className="h-3.5 w-3.5" />
                    My Achievements
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setFeatured(!featured);
                    setPage(1);
                  }}
                  className={cn('chip font-bold', featured ? 'chip-active' : '')}
                >
                  <Star className="h-3.5 w-3.5" />
                  Featured Only
                </button>

                {(q || category || level || dept || featured || mineOnly) && (
                  <button
                    type="button"
                    onClick={() => {
                      setQ('');
                      setCategory('');
                      setLevel('');
                      setDept('');
                      setFeatured(false);
                      setMineOnly(false);
                      setPage(1);
                    }}
                    className="chip text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Dropdown filters for category, level, department */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/80 dark:border-white/10">
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPage(1);
                }}
                className="input text-xs !py-1.5 !px-3 w-auto cursor-pointer border border-slate-200/90 dark:border-white/10 bg-white/85 dark:bg-[#131427]/85 text-ink dark:text-primary-50 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="" className="bg-white text-ink dark:bg-[#131427] dark:text-primary-50">All Categories</option>
                {ACHIEVEMENT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value} className="bg-white text-ink dark:bg-[#131427] dark:text-primary-50">
                    {c.label}
                  </option>
                ))}
              </select>

              <select
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value);
                  setPage(1);
                }}
                className="input text-xs !py-1.5 !px-3 w-auto cursor-pointer border border-slate-200/90 dark:border-white/10 bg-white/85 dark:bg-[#131427]/85 text-ink dark:text-primary-50 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="" className="bg-white text-ink dark:bg-[#131427] dark:text-primary-50">All Levels</option>
                {ACHIEVEMENT_LEVELS.map((lvl) => (
                  <option key={lvl.value} value={lvl.value} className="bg-white text-ink dark:bg-[#131427] dark:text-primary-50">
                    {lvl.label}
                  </option>
                ))}
              </select>

              <select
                value={dept}
                onChange={(e) => {
                  setDept(e.target.value);
                  setPage(1);
                }}
                className="input text-xs !py-1.5 !px-3 w-auto cursor-pointer border border-slate-200/90 dark:border-white/10 bg-white/85 dark:bg-[#131427]/85 text-ink dark:text-primary-50 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="" className="bg-white text-ink dark:bg-[#131427] dark:text-primary-50">All Departments</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d} className="bg-white text-ink dark:bg-[#131427] dark:text-primary-50">
                    {d}
                  </option>
                ))}
              </select>

              <span className="ml-auto text-xs text-ink-muted">
                Showing <b>{achievements.length}</b> of <b>{total}</b>
              </span>
            </div>
          </Card>

          {/* Grid / Empty / Loading */}
          {error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : isFetching && !achievements.length ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="h-64 animate-pulse bg-white/40 dark:bg-white/5" />
              ))}
            </div>
          ) : achievements.length === 0 ? (
            <Card className="py-16 text-center">
              <Trophy className="mx-auto h-14 w-14 text-amber-500 opacity-60" />
              <h3 className="mt-4 text-base font-bold text-ink dark:text-primary-50">No achievements found</h3>
              <p className="mt-1 text-xs text-ink-muted max-w-sm mx-auto">
                {mineOnly
                  ? "You haven't been tagged in any posted achievements yet."
                  : 'Try broadening your search or filter options.'}
              </p>
              {canPost && !mineOnly && (
                <Button className="mt-5" onClick={() => setFormOpen(true)} icon={Plus}>
                  Post the first achievement
                </Button>
              )}
            </Card>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {achievements.map((a) => (
                  <AchievementCard key={a._id} achievement={a} />
                ))}
              </div>

              {pages > 1 && (
                <Pagination page={page} pages={pages} onChange={setPage} />
              )}
            </div>
          )}
        </>
      )}

      {/* Creation / Edit Form Modal */}
      {formOpen && (
        <AchievementForm
          open={formOpen}
          onClose={() => {
            setFormOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

