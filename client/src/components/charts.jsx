import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import { catStyle } from '../utils/constants';

export function GlassTooltip({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-2xl px-3.5 py-2.5 text-xs">
      {label !== undefined && <p className="mb-1 font-bold">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey || p.name} className="flex items-center gap-2 capitalize">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="muted">{p.name}:</span> <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

const monthLabel = (m) => format(new Date(`${m}-01T00:00:00`), 'MMM');

/** Two-series smooth area chart: registrations vs events per month. */
export function EngagementChart({ data = [], height = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="gReg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6c5dd3" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#6c5dd3" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gEv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0609e" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#f0609e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="4 6" />
        <XAxis dataKey="month" tickFormatter={monthLabel} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip content={<GlassTooltip labelFormatter={(m) => format(new Date(`${m}-01T00:00:00`), 'MMMM yyyy')} />} />
        <Area type="monotone" name="registrations" dataKey="registrations" stroke="#6c5dd3" strokeWidth={3} fill="url(#gReg)" activeDot={{ r: 6, strokeWidth: 3, stroke: '#fff' }} />
        <Area type="monotone" name="events" dataKey="events" stroke="#f0609e" strokeWidth={3} fill="url(#gEv)" activeDot={{ r: 6, strokeWidth: 3, stroke: '#fff' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Donut of registrations per event category. */
export function CategoryDonut({ data = [], height = 200 }) {
  const rows = data.filter((d) => d.registrations > 0);
  const total = rows.reduce((s, d) => s + d.registrations, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={rows} dataKey="registrations" nameKey="category" innerRadius="68%" outerRadius="100%" paddingAngle={3} cornerRadius={8} stroke="none">
              {rows.map((d) => (
                <Cell key={d.category} fill={catStyle(d.category).hex} />
              ))}
            </Pie>
            <Tooltip content={<GlassTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-extrabold">{total}</span>
          <span className="text-[11px] muted">registrations</span>
        </div>
      </div>
      <div className="w-full space-y-2">
        {rows.slice(0, 6).map((d) => (
          <div key={d.category} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-semibold capitalize">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: catStyle(d.category).hex }} />
              {d.category}
            </span>
            <span className="font-bold">{total ? Math.round((d.registrations / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Rounded vertical bars. */
export function RoundedBars({ data = [], xKey, yKey, name, height = 240, color = '#6c5dd3', tickFormatter }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id={`bar-${yKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={1} />
            <stop offset="100%" stopColor={color} stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="4 6" />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false} tickFormatter={tickFormatter} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip content={<GlassTooltip labelFormatter={tickFormatter} />} />
        <Bar dataKey={yKey} name={name || yKey} fill={`url(#bar-${yKey})`} radius={[10, 10, 10, 10]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
