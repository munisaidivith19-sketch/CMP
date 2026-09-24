import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { initials } from '../../utils/format';
import { catStyle } from '../../utils/constants';

export const cn = (...c) => c.filter(Boolean).join(' ');

/* ── Button ─────────────────────────────────────────────────────── */
const SIZES = { sm: 'px-3 py-1.5 text-xs rounded-xl', md: '', lg: 'px-6 py-3 text-base' };

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading, icon: Icon, children, className, to, ...props },
  ref
) {
  const classes = cn('btn', `btn-${variant}`, SIZES[size], className);
  const content = (
    <>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </>
  );
  if (to) {
    return (
      <Link ref={ref} to={to} className={classes} {...props}>
        {content}
      </Link>
    );
  }
  return (
    <button ref={ref} className={classes} disabled={loading || props.disabled} {...props}>
      {content}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, variant = 'ghost', ...props }) {
  return (
    <button aria-label={label} title={label} className={cn('btn-icon', `btn-${variant}`, className)} {...props}>
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

/* ── Card ───────────────────────────────────────────────────────── */
export function Card({ className, hover, children, as: Tag = 'div', ...props }) {
  return (
    <Tag className={cn('card', hover && 'card-hover', className)} {...props}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, action, className }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div>
        <h3 className="section-title">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ── Badge ──────────────────────────────────────────────────────── */
const BADGES = {
  primary: 'bg-primary-500/10 text-primary-600 dark:text-primary-300',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  neutral: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
};

export function Badge({ color = 'primary', className, children, icon: Icon }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold capitalize', BADGES[color], className)}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function CategoryBadge({ category, className }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold capitalize', catStyle(category).soft, className)}>
      {String(category).replace('-', ' ')}
    </span>
  );
}

/* ── Avatar ─────────────────────────────────────────────────────── */
const AVATAR_SIZES = { xs: 'h-7 w-7 text-[10px]', sm: 'h-9 w-9 text-xs', md: 'h-11 w-11 text-sm', lg: 'h-16 w-16 text-lg', xl: 'h-24 w-24 text-2xl' };
const GRADS = [
  'from-violet-400 to-indigo-500',
  'from-pink-400 to-rose-500',
  'from-sky-400 to-blue-500',
  'from-amber-400 to-orange-500',
  'from-emerald-400 to-teal-500',
  'from-fuchsia-400 to-purple-500',
];

export function Avatar({ user, src, name, size = 'md', className, ring }) {
  const n = name || user?.name || '?';
  const img = src || user?.avatar || user?.logo;
  const grad = GRADS[(n.charCodeAt(0) + n.length) % GRADS.length];
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-2xl font-bold text-white',
        AVATAR_SIZES[size],
        !img && `bg-gradient-to-br ${grad}`,
        ring && 'ring-4 ring-white/80 dark:ring-white/10',
        className
      )}
    >
      {img ? <img src={img} alt={n} className="h-full w-full object-cover" loading="lazy" /> : initials(n)}
    </span>
  );
}

export function AvatarStack({ users = [], max = 4, size = 'xs' }) {
  const shown = users.slice(0, max);
  return (
    <div className="flex -space-x-2">
      {shown.map((u) => (
        <Avatar key={u._id} user={u} size={size} className="ring-2 ring-white dark:ring-[#17182e]" />
      ))}
      {users.length > max && (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-2xl bg-primary-100 text-[10px] font-bold text-primary-700 ring-2 ring-white dark:bg-primary-500/20 dark:text-primary-200 dark:ring-[#17182e]">
          +{users.length - max}
        </span>
      )}
    </div>
  );
}

/* ── Loading / empty ────────────────────────────────────────────── */
export function Spinner({ className }) {
  return <Loader2 className={cn('h-6 w-6 animate-spin text-primary-500', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-2xl bg-white/60 dark:bg-white/[0.06]', className)} />;
}

export function EmptyState({ icon: Icon, title, text, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-[28px] px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-400/20 to-fuchsia-400/20 text-primary-500">
          <Icon className="h-7 w-7" />
        </div>
      )}
      <h3 className="text-base font-bold">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-sm muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Card className="text-center">
      <p className="font-semibold text-rose-600 dark:text-rose-300">{error?.data?.message || 'Could not load data'}</p>
      {onRetry && (
        <Button variant="soft" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Card>
  );
}

/* ── Page header ────────────────────────────────────────────────── */
export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-glow">
            <Icon className="h-6 w-6" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/* ── Stat card (dashboard) ──────────────────────────────────────── */
export function StatCard({ icon: Icon, label, value, hint, gradient = 'from-primary-400 to-primary-600', delay = 0 }) {
  return (
    <Card hover className="group relative overflow-hidden animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className={cn('absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition-opacity duration-500 group-hover:opacity-40', gradient)} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide muted">{label}</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight">{value ?? '—'}</p>
          {hint && <p className="mt-1 text-xs font-medium muted">{hint}</p>}
        </div>
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-transform duration-500 ease-smooth group-hover:rotate-6 group-hover:scale-110', gradient)}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </Card>
  );
}

/* ── Tabs & pagination ──────────────────────────────────────────── */
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cn('glass inline-flex gap-1 overflow-x-auto rounded-2xl p-1 scrollbar-none', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300 ease-smooth',
            value === t.value
              ? 'bg-white text-primary-600 shadow-soft dark:bg-white/10 dark:text-white'
              : 'text-ink-soft hover:text-ink dark:text-slate-400 dark:hover:text-white'
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] text-primary-600 dark:text-primary-200">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pages, onChange }) {
  if (!pages || pages <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <span className="glass rounded-xl px-3 py-1.5 text-xs font-bold">
        {page} / {pages}
      </span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </div>
  );
}

export function ProgressBar({ value, max, className }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-primary-500/10', className)}>
      <div
        className={cn(
          'h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-smooth',
          pct >= 100 ? 'from-rose-400 to-rose-500' : pct > 75 ? 'from-amber-400 to-orange-500' : 'from-primary-400 to-fuchsia-500'
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
