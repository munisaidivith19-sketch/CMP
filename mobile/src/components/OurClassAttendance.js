import { useState } from 'react';
import { View } from 'react-native';
import { GraduationCap, Users } from 'lucide-react-native';
import { Card, EmptyState, ErrorState, Loading, Segmented, SectionTitle, T, pctColor } from './ui';
import DateField from './DateField';
import { useGetOurClassAttendanceQuery } from '../services/api';
import { YEAR_LABELS, colors, fonts } from '../theme';
import { to12h } from '../utils/format';

const RANGES = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'semester', label: 'Semester' },
  { value: 'custom', label: 'Custom' },
];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Stat({ label, value }) {
  return (
    <View style={{ flex: 1, minWidth: 120, padding: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.6)' }}>
      <T v="small">{label}</T>
      <T v="h3">{value}</T>
    </View>
  );
}

/**
 * "Our Class" on mobile: the complete attendance of the faculty member's Class
 * In-Charge class. No subject is chosen — the class comes from the account on
 * the server, exactly as on the web — only the reporting window.
 */
export default function OurClassAttendance() {
  const [range, setRange] = useState('day');
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(new Date());
  const custom = range === 'custom';
  const params = custom ? { range, ...(from ? { from: ymd(from) } : {}), ...(to ? { to: ymd(to) } : {}) } : { range };
  const { data, isLoading, isFetching, error, refetch } = useGetOurClassAttendanceQuery(params, { skip: custom && !(from && to) });

  return (
    <>
      <Segmented value={range} onChange={setRange} options={RANGES} />
      {custom ? (
        <Card style={{ gap: 10 }}>
          <DateField label="Start date" value={from} onChange={setFrom} maximumDate={to || new Date()} />
          <DateField label="End date" value={to} onChange={setTo} minimumDate={from || undefined} maximumDate={new Date()} />
        </Card>
      ) : null}

      {custom && !(from && to) ? (
        <Card>
          <EmptyState icon={Users} title="Choose a start and an end date" />
        </Card>
      ) : isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.class ? (
        <Card>
          <EmptyState
            icon={GraduationCap}
            title="No class is currently assigned to you as Class In-Charge."
            text="Your administrator sets your Class In-Charge section, year and semester."
          />
        </Card>
      ) : (
        <View style={{ gap: 12, opacity: isFetching ? 0.6 : 1 }}>
          <Card style={{ gap: 4 }}>
            <T v="label" style={{ color: colors.primary }}>
              OUR CLASS
            </T>
            <T v="h3">{data.class.department}</T>
            <T v="small">
              {YEAR_LABELS[data.class.year]} · Section {data.class.section} · Semester {data.class.semester}
            </T>
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Stat label="Students" value={data.overall.totalStudents} />
            <Stat label="Periods held" value={data.overall.classesConducted} />
            <Stat label="Present / absent" value={`${data.overall.presentPeriods} / ${data.overall.absentPeriods}`} />
            <Stat label="Class attendance" value={`${data.overall.percentage}%`} />
          </View>

          <SectionTitle title="Periods" />
          {data.sessions.length ? (
            data.sessions.map((p) => (
              <Card key={p._id} style={{ gap: 2 }}>
                <T v="label" style={{ color: colors.primary }}>
                  {range === 'day' ? '' : `${p.date} · `}P{p.period} · {p.subjectCode}
                </T>
                <T style={{ fontFamily: fonts.bold }}>{p.subject}</T>
                <T v="small">
                  {to12h(p.startTime)} – {to12h(p.endTime)} · {p.facultyName || '—'}
                </T>
                <T v="small">
                  <T v="small" style={{ color: colors.success, fontFamily: fonts.bold }}>{p.present} present</T> ·{' '}
                  <T v="small" style={{ color: colors.danger, fontFamily: fonts.bold }}>{p.absent} absent</T>
                </T>
              </Card>
            ))
          ) : (
            <Card>
              <T v="small">No completed attendance records are available for this period.</T>
            </Card>
          )}

          <SectionTitle title="Students" />
          {data.students.map((s) => (
            <Card key={s._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1} style={{ fontFamily: fonts.bold }}>
                  {s.name}
                </T>
                <T v="small" numberOfLines={1}>
                  {s.rollNo || '—'} · Y{s.year} · Sec {s.section} · Sem {s.semester ?? '—'}
                </T>
                <T v="small">
                  {s.presentPeriods}/{s.totalPeriods} present · {s.absentPeriods} absent
                </T>
              </View>
              <T style={{ fontFamily: fonts.bold, color: s.totalPeriods ? pctColor(s.percentage) : colors.soft }}>
                {s.totalPeriods ? `${s.percentage}%` : '—'}
              </T>
            </Card>
          ))}
        </View>
      )}
    </>
  );
}
