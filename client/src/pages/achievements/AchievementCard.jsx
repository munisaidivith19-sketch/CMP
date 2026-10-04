import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, CalendarDays, ExternalLink, Heart, MapPin, Sparkles, Star, Trophy, Users } from 'lucide-react';
import { Avatar, AvatarStack, Badge, Button, Card, CategoryBadge, cn } from '../../components/ui/primitives';
import { useCongratulateAchievementMutation } from '../../services/api';
import {
  ACHIEVEMENT_CATEGORY_LABELS,
  ACHIEVEMENT_GRADIENTS,
  ACHIEVEMENT_LEVEL_COLORS,
  ACHIEVEMENT_LEVEL_LABELS,
  ACHIEVEMENT_POSITION_LABELS,
} from '../../utils/constants';
import { fmtDate } from '../../utils/format';

export default function AchievementCard({ achievement: a, compact = false }) {
  const [congratulate] = useCongratulateAchievementMutation();
  const [optimistic, setOptimistic] = useState({
    congratulated: a.congratulated,
    count: a.congratulationCount || 0,
  });

  const onCongratulate = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const next = !optimistic.congratulated;
    setOptimistic({
      congratulated: next,
      count: optimistic.count + (next ? 1 : -1),
    });
    try {
      const res = await congratulate(a._id).unwrap();
      setOptimistic({ congratulated: res.congratulated, count: res.congratulationCount });
    } catch {
      // Revert if API fails
      setOptimistic({ congratulated: a.congratulated, count: a.congratulationCount || 0 });
    }
  };

  const cover = a.images?.[0]?.url;
  const grad = ACHIEVEMENT_GRADIENTS[a.category] || 'from-primary-700 to-indigo-900';
  const levelColor = ACHIEVEMENT_LEVEL_COLORS[a.level] || 'primary';
  const levelLabel = ACHIEVEMENT_LEVEL_LABELS[a.level] || a.level;
  const positionLabel = ACHIEVEMENT_POSITION_LABELS[a.position] || a.position;

  return (
    <Card hover className="group flex flex-col justify-between overflow-hidden p-0">
      <Link to={`/achievements/${a._id}`} className="block">
        <div className={cn('relative w-full overflow-hidden bg-gradient-to-br text-white', grad, compact ? 'h-28' : 'h-40')}>
          {cover ? (
            <img
              src={cover}
              alt={a.title}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-smooth group-hover:scale-105"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-25">
              <Trophy className="h-20 w-20 text-white" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

          {/* Badges on banner */}
          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold text-ink shadow dark:bg-slate-900/90 dark:text-primary-100">
              <Award className="h-3 w-3 text-amber-500" />
              {positionLabel}
            </span>
            <Badge color={levelColor} onDark className="shadow-sm">
              {levelLabel}
            </Badge>
          </div>

          {a.isFeatured && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-0.5 text-[10px] font-extrabold text-white shadow-glow">
              <Star className="h-3 w-3 fill-white" /> Featured
            </span>
          )}

          <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-xs text-white/90">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
              <CalendarDays className="h-3 w-3" />
              {fmtDate(a.achievedOn)}
            </span>
            {a.departments?.length > 0 && (
              <span className="truncate text-[10px] font-bold uppercase tracking-wider text-white/80">
                {a.departments.join(', ')}
              </span>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-2 flex items-center gap-2">
            <CategoryBadge category={a.category} />
            {a.eventName && (
              <span className="truncate text-xs font-medium text-ink-muted">
                {a.eventName}
              </span>
            )}
          </div>

          <h3 className="line-clamp-2 text-base font-bold text-ink transition-colors group-hover:text-primary-600 dark:text-primary-50 dark:group-hover:text-primary-300">
            {a.title}
          </h3>

          <p className={cn('mt-1.5 text-xs leading-relaxed text-ink-soft', compact ? 'line-clamp-1' : 'line-clamp-2')}>
            {a.description}
          </p>

          {/* Students featured */}
          <div className="mt-3.5 flex items-center justify-between border-t border-white/40 pt-3 dark:border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <AvatarStack users={a.students || []} max={3} size="xs" />
              <span className="truncate text-xs font-semibold text-ink dark:text-primary-100">
                {a.students?.length === 1
                  ? a.students[0].name
                  : a.students?.length > 1
                  ? `${a.students[0].name} +${a.students.length - 1}`
                  : 'Student'}
              </span>
            </div>
            {a.isMine && (
              <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-bold text-primary-700 dark:text-primary-300">
                You
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Footer action */}
      <div className="flex items-center justify-between border-t border-white/40 px-4 py-2.5 dark:border-white/10 sm:px-5">
        <button
          type="button"
          onClick={onCongratulate}
          aria-label="Congratulate"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all duration-200 active:scale-95',
            optimistic.congratulated
              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
              : 'text-ink-muted hover:bg-slate-100 hover:text-ink dark:hover:bg-white/5'
          )}
        >
          <Heart className={cn('h-3.5 w-3.5', optimistic.congratulated ? 'fill-rose-500 text-rose-500' : '')} />
          <span>{optimistic.count > 0 ? `${optimistic.count} Congratulations` : 'Congratulate'}</span>
        </button>

        <Button to={`/achievements/${a._id}`} variant="ghost" size="sm" className="!px-2 text-xs">
          View details
        </Button>
      </div>
    </Card>
  );
}

