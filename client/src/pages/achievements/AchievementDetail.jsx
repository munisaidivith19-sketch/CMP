import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Award,
  CalendarDays,
  ExternalLink,
  EyeOff,
  Heart,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  User,
  Users,
} from 'lucide-react';
import {
  useCongratulateAchievementMutation,
  useDeleteAchievementMutation,
  useGetAchievementQuery,
  useRequestAchievementHideMutation,
  useRestoreAchievementMutation,
  useToggleFeaturedAchievementMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CategoryBadge,
  EmptyState,
  ErrorState,
  PageLoader,
  cn,
} from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/form';
import AchievementForm from './AchievementForm';
import {
  ACHIEVEMENT_GRADIENTS,
  ACHIEVEMENT_LEVEL_COLORS,
  ACHIEVEMENT_LEVEL_LABELS,
  ACHIEVEMENT_POSITION_LABELS,
} from '../../utils/constants';
import { errMsg, fmtDate } from '../../utils/format';

export default function AchievementDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useSelector(selectUser);

  const { data: a, isLoading, error, refetch } = useGetAchievementQuery(id);
  const [congratulate] = useCongratulateAchievementMutation();
  const [toggleFeatured, { isLoading: togglingFeature }] = useToggleFeaturedAchievementMutation();
  const [deleteAchievement, { isLoading: deleting }] = useDeleteAchievementMutation();
  const [restoreAchievement, { isLoading: restoring }] = useRestoreAchievementMutation();
  const [requestHide, { isLoading: submittingHide }] = useRequestAchievementHideMutation();

  const [activePhoto, setActivePhoto] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [hideModal, setHideModal] = useState(false);
  const [hideReason, setHideReason] = useState('');

  if (isLoading) return <PageLoader />;
  if (error || !a) return <ErrorState error={error || 'Achievement not found'} onRetry={refetch} />;

  const cover = a.images?.[activePhoto]?.url || a.images?.[0]?.url;
  const grad = ACHIEVEMENT_GRADIENTS[a.category] || 'from-primary-700 to-indigo-900';
  const levelColor = ACHIEVEMENT_LEVEL_COLORS[a.level] || 'primary';
  const levelLabel = ACHIEVEMENT_LEVEL_LABELS[a.level] || a.level;
  const positionLabel = ACHIEVEMENT_POSITION_LABELS[a.position] || a.position;

  const onCongratulate = async () => {
    try {
      await congratulate(a._id).unwrap();
    } catch {
      /* handled */
    }
  };

  const onToggleFeature = async () => {
    try {
      const res = await toggleFeatured(a._id).unwrap();
      toast.success(res.isFeatured ? 'Achievement marked as Featured! ⭐' : 'Unfeatured');
    } catch (err) {
      toast.error(errMsg(err, 'Failed to update feature state'));
    }
  };

  const onDelete = async () => {
    try {
      await deleteAchievement(a._id).unwrap();
      toast.success('Achievement deleted');
      navigate('/achievements');
    } catch (err) {
      toast.error(errMsg(err, 'Failed to delete'));
    }
  };

  const onRestore = async () => {
    try {
      await restoreAchievement(a._id).unwrap();
      toast.success('Achievement restored');
      refetch();
    } catch (err) {
      toast.error(errMsg(err, 'Failed to restore'));
    }
  };

  const onSubmitHideRequest = async (e) => {
    e.preventDefault();
    try {
      await requestHide({ id: a._id, reason: hideReason }).unwrap();
      toast.success('Privacy removal request submitted to the department head.');
      setHideModal(false);
      refetch();
    } catch (err) {
      toast.error(errMsg(err, 'Failed to submit request'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Top navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/achievements"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-muted hover:text-ink dark:hover:text-primary-100"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Achievements
        </Link>

        {/* Management actions */}
        <div className="flex flex-wrap items-center gap-2">
          {a.canFeature && (
            <Button
              variant="outline"
              size="sm"
              loading={togglingFeature}
              onClick={onToggleFeature}
              icon={Star}
              className={a.isFeatured ? 'text-amber-700 dark:text-amber-300' : ''}
            >
              {a.isFeatured ? 'Unfeature' : 'Feature on Top'}
            </Button>
          )}

          {a.canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} icon={Pencil}>
              Edit
            </Button>
          )}

          {a.canDelete && !a.isDeleted && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirm(true)}
              icon={Trash2}
              className="text-rose-600 dark:text-rose-400"
            >
              Delete
            </Button>
          )}

          {a.canRestore && (
            <Button variant="primary" size="sm" onClick={onRestore} loading={restoring} icon={RotateCcw}>
              Restore
            </Button>
          )}
        </div>
      </div>

      {/* Main card */}
      <Card className="overflow-hidden p-0">
        {/* Banner with cover photo or graphic */}
        <div className={cn('relative w-full overflow-hidden bg-gradient-to-br text-white', grad, 'min-h-[260px] sm:min-h-[340px] flex flex-col justify-end p-6 sm:p-8')}>
          {cover ? (
            <img src={cover} alt={a.title} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
              <Trophy className="h-40 w-40 text-white" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

          <div className="relative z-10 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={a.category} onDark className="shadow-sm" />
              <Badge color={levelColor} onDark className="shadow-sm">
                {levelLabel} Level
              </Badge>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-ink shadow dark:bg-slate-900/90 dark:text-primary-100">
                <Award className="h-3.5 w-3.5 text-amber-500" />
                {positionLabel}
              </span>
              {a.isFeatured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1 text-xs font-extrabold text-white shadow-glow">
                  <Star className="h-3 w-3 fill-white" /> Featured
                </span>
              )}
              {a.isDeleted && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white">
                  Deleted (Admin Archive)
                </span>
              )}
            </div>

            <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
              {a.title}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-white/90">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                {fmtDate(a.achievedOn)}
              </span>
              {a.eventName && <span>• {a.eventName}</span>}
              {a.organizer && <span>• Organized by {a.organizer}</span>}
              {a.departments?.length > 0 && (
                <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] backdrop-blur">
                  {a.departments.join(', ')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Photo thumbnails if multiple */}
        {a.images?.length > 1 && (
          <div className="flex gap-2 overflow-x-auto border-b border-white/40 bg-slate-50/50 p-4 dark:border-white/10 dark:bg-white/[0.02]">
            {a.images.map((img, idx) => (
              <button
                key={img.url + idx}
                type="button"
                onClick={() => setActivePhoto(idx)}
                className={cn(
                  'h-16 w-24 shrink-0 overflow-hidden rounded-xl border-2 transition-all',
                  activePhoto === idx
                    ? 'border-primary-500 ring-2 ring-primary-500/20'
                    : 'border-transparent opacity-70 hover:opacity-100'
                )}
              >
                <img src={img.url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="p-6 sm:p-8 space-y-6">
          {/* Description */}
          <div>
            <h3 className="section-title mb-2">About the Achievement</h3>
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">
              {a.description}
            </p>
          </div>

          {/* External link if provided */}
          {a.externalLink && (
            <div>
              <a
                href={a.externalLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary-500/30 bg-primary-500/10 px-4 py-2 text-xs font-bold text-primary-700 hover:bg-primary-500/20 dark:text-primary-300"
              >
                <ExternalLink className="h-4 w-4" /> View External Proof / Coverage
              </a>
            </div>
          )}

          {/* Featured students section */}
          <div className="border-t border-white/40 pt-6 dark:border-white/10">
            <h3 className="section-title mb-3">Honored Students ({a.students?.length || 0})</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(a.students || []).map((s) => (
                <Link
                  key={s._id}
                  to={`/people/${s._id}`}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/60 p-3 transition-colors hover:border-primary-400 hover:bg-white dark:border-white/10 dark:bg-white/5"
                >
                  <Avatar user={s} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink dark:text-primary-100">{s.name}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {s.rollNo ? `${s.rollNo} • ` : ''}
                      {s.department || ''}
                    </p>
                    {s.year && <p className="text-[11px] text-ink-muted">Year {s.year}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Posted By attribution */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4 dark:bg-white/[0.03]">
            <div className="flex items-center gap-3">
              <Avatar user={a.postedBy} size="sm" />
              <div>
                <p className="text-xs font-bold text-ink dark:text-primary-100">
                  Posted by {a.postedBy?.name || 'Department Head'}
                </p>
                <p className="text-[11px] text-ink-muted">
                  {a.postedBy?.designation || (a.postedBy?.role === 'principal' ? 'Principal' : 'Head of Department')}
                  {a.postedBy?.department ? ` • ${a.postedBy.department}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCongratulate}
                className={cn(
                  'inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-bold shadow-soft transition-all active:scale-95',
                  a.congratulated
                    ? 'bg-rose-500 text-white'
                    : 'bg-white text-ink hover:bg-slate-100 dark:bg-ink dark:text-primary-100 dark:hover:bg-white/10'
                )}
              >
                <Heart className={cn('h-4 w-4', a.congratulated ? 'fill-white' : '')} />
                <span>{a.congratulationCount > 0 ? `${a.congratulationCount} Congratulations` : 'Congratulate'}</span>
              </button>

              {/* Student privacy opt-out button */}
              {a.isMine && (
                <div>
                  {a.myHideRequest === 'pending' ? (
                    <span className="inline-flex items-center gap-1 rounded-xl bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                      Opt-out Request Pending
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setHideModal(true)}
                      className="text-xs text-ink-muted hover:text-rose-600 underline"
                    >
                      Request removal from this post
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Edit Form Modal */}
      {editOpen && (
        <AchievementForm
          open={editOpen}
          onClose={() => {
            setEditOpen(false);
            refetch();
          }}
          achievement={a}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={onDelete}
        title="Delete Achievement"
        text="This will remove the achievement from the public feed. Administrators can restore it if needed."
        confirmText="Delete"
        danger
        loading={deleting}
      />

      {/* Student hide request modal */}
      <Modal
        open={hideModal}
        onClose={() => setHideModal(false)}
        title="Request Privacy Removal"
        subtitle="Submit a request to the poster or Principal to have your name removed from this achievement post."
        footer={
          <>
            <Button variant="ghost" onClick={() => setHideModal(false)}>
              Cancel
            </Button>
            <Button onClick={onSubmitHideRequest} loading={submittingHide}>
              Submit Request
            </Button>
          </>
        }
      >
        <form onSubmit={onSubmitHideRequest} className="space-y-3">
          <Textarea
            label="Reason (Optional)"
            rows={3}
            value={hideReason}
            onChange={(e) => setHideReason(e.target.value)}
            placeholder="Please specify why you would like to be removed..."
          />
        </form>
      </Modal>
    </div>
  );
}

