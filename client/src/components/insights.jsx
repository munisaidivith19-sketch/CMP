import { format } from 'date-fns';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GlassTooltip } from './charts';
import { Badge, cn } from './ui/primitives';

/* ── Reporting window picker ────────────────────────────────────── */
export const RANGES = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'semester', label: 'Semester' },
  { value: 'custom', label: 'Custom' },
];

/** value = { range, from, to } → query params for the analytics API. */
export const rangeParams = ({ range, from, to }) =>
  range === 'custom' ? { range, ...(from ? { from } : {}), ...(to ? { to } : {}) } : { range };

export function RangeFilter({ value, onChange, ranges = RANGES, className }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="glass inline-flex gap-1 rounded-2xl p-1" role="tablist" aria-label="Reporting period">
        {ranges.map((r) => (
          <button
            key={r.value}
            role="tab"
            aria-selected={value.range === r.value}
            onClick={() => onChange({ ...value, range: r.value })}
            className={cn(
              'rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all duration-300 ease-smooth',
              value.range === r.value ? 'bg-white text-primary-600 shadow-soft dark:bg-white/10 dark:text-white' : 'text-ink-soft hover:text-ink'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      {value.range === 'custom' && (
        <div className="flex items-center gap-2">
          <input type="date" aria-label="From date" value={value.from || ''} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} className="input w-auto rounded-xl py-1.5 text-xs" />
          <span className="text-xs muted">to</span>
          <input type="date" aria-label="To date" value={value.to || ''} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} className="input w-auto rounded-xl py-1.5 text-xs" />
        </div>
      )}
    </div>
  );
}

/** Label a bucket key ('2026-09-24' or '2026-09') for chart axes. */
export function bucketLabel(key, groupBy = 'day') {
  if (!key) return '';
  if (/^\d{4}-\d{2}$/.test(key)) return format(new Date(`${key}-01T00:00:00`), 'MMM yy');
  const d = new Date(`${key}T00:00:00`);
  return groupBy === 'week' ? `Wk ${format(d, 'dd MMM')}` : format(d, 'dd MMM');
}

/* ── Attendance ring ────────────────────────────────────────────── */
export function PercentRing({ value = 0, size = 132, stroke = 12, threshold = 75, label = 'overall', sub }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const color = pct >= threshold ? '#22c38e' : pct >= threshold - 10 ? '#f5a524' : '#f43f5e';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${pct}% ${label}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(108,93,211,0.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-extrabold tracking-tight">{pct.toFixed(pct % 1 ? 1 : 0)}%</span>
        <span className="text-[11px] font-semibold muted">{sub || label}</span>
      </div>
    </div>
  );
}

export function PercentBadge({ value, threshold = 75 }) {
  const color = value >= threshold ? 'success' : value >= threshold - 10 ? 'warning' : 'danger';
  return <Badge color={color}>{Number(value || 0).toFixed(value % 1 ? 1 : 0)}%</Badge>;
}

/* ── Trend charts ───────────────────────────────────────────────── */
const PALETTE = ['#6c5dd3', '#f0609e', '#22b8c9', '#f5a524'];

/** Smooth area chart for count series. series = [{ key, name, color? }] */
export function TrendArea({ data = [], series, xKey = 'bucket', groupBy, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`ta-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color || PALETTE[i]} stopOpacity={0.4} />
              <stop offset="100%" stopColor={s.color || PALETTE[i]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="4 6" />
        <XAxis dataKey={xKey} tickFormatter={(k) => bucketLabel(k, groupBy)} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip content={<GlassTooltip labelFormatter={(k) => bucketLabel(k, groupBy)} />} />
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color || PALETTE[i]}
            strokeWidth={3}
            fill={`url(#ta-${s.key})`}
            activeDot={{ r: 5, strokeWidth: 3, stroke: '#fff' }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Attendance % over time with the minimum-attendance line. */
export function PercentTrend({ data = [], xKey = 'bucket', yKey = 'percentage', groupBy, threshold = 75, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="4 6" />
        <XAxis dataKey={xKey} tickFormatter={(k) => bucketLabel(k, groupBy)} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
        <Tooltip content={<GlassTooltip labelFormatter={(k) => bucketLabel(k, groupBy)} />} />
        <ReferenceLine y={threshold} stroke="#f43f5e" strokeDasharray="6 6" label={{ value: `${threshold}%`, position: 'insideTopRight', fill: '#f43f5e', fontSize: 11 }} />
        <Line type="monotone" dataKey={yKey} name="attendance %" stroke="#6c5dd3" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6, strokeWidth: 3, stroke: '#fff' }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal percentage bars (subjects / sections). rows = [{ label, value, sub? }] */
export function PercentBars({ rows = [], threshold = 75 }) {
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pct = Math.max(0, Math.min(100, r.value || 0));
        const tone = pct >= threshold ? 'from-emerald-400 to-teal-500' : pct >= threshold - 10 ? 'from-amber-400 to-orange-500' : 'from-rose-400 to-pink-500';
        return (
          <div key={r.key || r.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate font-semibold">{r.label}</span>
              <span className="shrink-0 font-bold">
                {pct.toFixed(pct % 1 ? 1 : 0)}%{r.sub && <span className="ml-1.5 font-medium muted">{r.sub}</span>}
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-primary-500/10">
              <div className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-smooth', tone)} style={{ width: `${pct}%` }} />
              <span className="absolute top-0 h-full w-0.5 bg-rose-400/70" style={{ left: `${threshold}%` }} aria-hidden />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Small stat tile (inside cards) ─────────────────────────────── */
export function MiniStat({ label, value, hint, tone = 'text-primary-600 bg-primary-500/10', icon: Icon }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/50 p-3 dark:bg-white/5">
      {Icon && (
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tone)}>
          <Icon className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide muted">{label}</p>
        <p className="text-lg font-extrabold leading-tight">{value ?? '—'}</p>
        {hint && <p className="truncate text-[11px] muted">{hint}</p>}
      </div>
    </div>
  );
}

/* ── Status badge helper (gate pass, lost & found, corrections) ─── */
const STATUS_COLORS = {
  pending: 'warning',
  approved: 'success',
  active: 'info',
  completed: 'neutral',
  rejected: 'danger',
  revoked: 'danger',
  expired: 'neutral',
  cancelled: 'neutral',
  lost: 'danger',
  found: 'info',
  possible_match: 'warning',
  under_verification: 'primary',
  returned: 'success',
  closed: 'neutral',
  present: 'success',
  absent: 'danger',
};
export function StatusBadge({ status, label }) {
  return <Badge color={STATUS_COLORS[status] || 'neutral'}>{label || String(status).replace(/_/g, ' ')}</Badge>;
}
