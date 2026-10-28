// Small UI pieces in the web portal's style (class names from client/src/index.css).
import { Loader2 } from 'lucide-react';

export const cn = (...c) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', loading, icon: Icon, children, className, ...props }) {
  return (
    <button className={cn('btn', `btn-${variant}`, className)} disabled={loading || props.disabled} {...props}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Card({ className, children, ...props }) {
  return (
    <section className={cn('card', className)} {...props}>
      {children}
    </section>
  );
}

const TONES = {
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  error: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  pending: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  neutral: 'bg-slate-500/10 text-ink-soft',
  primary: 'bg-primary-500/15 text-primary-700 dark:text-primary-300',
};
export const toneClass = (tone) => TONES[tone] || TONES.neutral;

export function Badge({ tone = 'neutral', icon: Icon, children, className }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', toneClass(tone), className)}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {children}
    </span>
  );
}

/** A status pill with a coloured dot (server / scanner state). */
export function StatusDot({ tone = 'neutral', label, detail }) {
  const dot = { success: 'bg-emerald-500', error: 'bg-rose-500', warning: 'bg-amber-500', pending: 'bg-sky-500 animate-pulse', neutral: 'bg-slate-400' }[tone];
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm" title={detail || label}>
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot)} aria-hidden />
      <span className="truncate font-semibold">{label}</span>
    </span>
  );
}

export function Stat({ icon: Icon, label, value, hint, tone = 'primary' }) {
  return (
    <Card className="flex items-start gap-4">
      <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', toneClass(tone))}>
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide muted">{label}</p>
        <p className="text-3xl font-extrabold tabular-nums leading-tight">{value ?? '—'}</p>
        {hint && <p className="mt-0.5 text-xs muted">{hint}</p>}
      </div>
    </Card>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-primary-500', className)} aria-label="Loading" />;
}

export function Initials({ name, className }) {
  const text = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  return <span className={cn('flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 font-extrabold text-white', className)}>{text}</span>;
}

export const YEAR_LABELS = { 1: 'I Year', 2: 'II Year', 3: 'III Year', 4: 'IV Year' };
export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const studentLine = (s) => [s?.rollNo, s?.department, YEAR_LABELS[s?.year] || (s?.year ? `Year ${s.year}` : null), s?.section ? `Sec ${s.section}` : null].filter(Boolean).join(' · ');
