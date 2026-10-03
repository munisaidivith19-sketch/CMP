import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSelector } from 'react-redux';
import { AlertTriangle, FileText, GraduationCap } from 'lucide-react-native';
import { Card, Chip, EmptyState, ErrorState, Loading, Segmented, SectionTitle, T, pctColor } from './ui';
import DateField from './DateField';
import { errMsg, useGetAttendanceReportQuery, useGetReportOptionsQuery, useGetReportPeriodsQuery } from '../services/api';
import { selectUser } from '../store/authSlice';
import { YEAR_LABELS, colors, fonts } from '../theme';
import { to12h } from '../utils/format';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const TYPES = {
  class: [
    { value: 'current', label: 'Current data' },
    { value: 'period', label: 'Date & period' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'semester', label: 'Semester' },
    { value: 'custom', label: 'Custom' },
  ],
  handling: [
    { value: 'period', label: 'Period' },
    { value: 'date', label: 'Date' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'semester', label: 'Semester' },
    { value: 'custom', label: 'Custom' },
  ],
};

function Names({ title, list, color }) {
  return (
    <View style={{ gap: 2 }}>
      <T v="label" style={{ color }}>
        {title} ({list.length})
      </T>
      {list.length ? list.map((s, i) => <T key={`${s.rollNo}-${i}`} v="small">{`${i + 1}. ${s.rollNo || '—'} · ${s.name}`}</T>) : <T v="small">None.</T>}
    </View>
  );
}

/**
 * Attendance reports on mobile — the same server-authorized reports as the web
 * app, shown in-app. Faculty choose a scope first: Our Class (their Class
 * In-Charge class; date + period only) or Handling Class (their own subject +
 * section). An HOD / college-wide account picks year / section / semester.
 * The server decides scope and which periods have finished.
 */
export default function AttendanceReports() {
  const me = useSelector(selectUser);
  const isFaculty = me.role === 'faculty';
  const { data: options, isLoading: loadingOptions, error: optionsError, refetch } = useGetReportOptionsQuery();

  const [scope, setScope] = useState(null);
  const [type, setType] = useState('period');
  const [subjectId, setSubjectId] = useState('');
  const [section, setSection] = useState('');
  const [year, setYear] = useState('');
  const [date, setDate] = useState(new Date());
  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(new Date());

  useEffect(() => {
    if (!isFaculty || scope || !options) return;
    setScope(options.ourClass ? 'class' : 'handling');
    setType(options.ourClass ? 'current' : 'period');
  }, [isFaculty, scope, options]);

  const facultyScope = isFaculty ? scope || 'handling' : null;
  const isClass = facultyScope === 'class';
  const subjects = options?.subjects || [];
  const subject = subjects.find((s) => s._id === subjectId);
  const sections = isFaculty ? subject?.sections || [] : options?.sections || [];
  useEffect(() => {
    if (facultyScope === 'handling' && !subjectId && subjects.length) setSubjectId(subjects[0]._id);
  }, [facultyScope, subjects, subjectId]);
  useEffect(() => {
    if (sections.length === 1) setSection(sections[0]);
    else if (section && !sections.includes(section)) setSection('');
  }, [sections, section]);

  const needsDate = type === 'period' || type === 'date';
  const needsPeriod = type === 'period';
  const day = ymd(date);
  const periodQuery = isClass ? { scope: 'class', date: day } : isFaculty ? { scope: 'handling', subjectId, section, date: day } : { date: day, section, ...(year ? { year } : {}) };
  const canListPeriods = needsPeriod && (isClass ? Boolean(options?.ourClass) : Boolean(isFaculty ? subjectId && section : section));
  const { data: periodList } = useGetReportPeriodsQuery(periodQuery, { skip: !canListPeriods });

  const params = { ...(isFaculty ? { scope: facultyScope } : {}) };
  if (facultyScope === 'handling') Object.assign(params, subjectId ? { subjectId } : {}, section ? { section } : {});
  if (!isFaculty) Object.assign(params, year ? { year } : {}, section ? { section } : {});
  if (needsDate) params.date = day;
  if (needsPeriod) params.period = period;
  if (type === 'custom') Object.assign(params, from ? { from: ymd(from) } : {}, to ? { to: ymd(to) } : {});

  const blocked =
    (isClass && !options?.ourClass) ||
    (facultyScope === 'handling' && !(subjectId && section)) ||
    (!isFaculty && needsPeriod && !section) ||
    (type === 'custom' && !(from && to));
  const { data: report, isFetching, error } = useGetAttendanceReportQuery({ type, ...params }, { skip: blocked || (isFaculty && !scope) });

  if (loadingOptions || (isFaculty && !scope)) return <Loading />;
  if (optionsError) return <ErrorState error={optionsError} onRetry={refetch} />;

  return (
    <>
      {isFaculty ? (
        <Segmented
          value={facultyScope}
          onChange={(v) => {
            setScope(v);
            setType(v === 'class' ? 'current' : 'period');
            setPeriod('all');
          }}
          options={[
            { value: 'class', label: 'Our Class' },
            { value: 'handling', label: 'Handling Class' },
          ]}
        />
      ) : null}
      <Segmented value={type} onChange={setType} options={TYPES[isClass ? 'class' : 'handling']} />

      {isClass && !options?.ourClass ? (
        <Card>
          <EmptyState icon={GraduationCap} title="No class is currently assigned to you as Class In-Charge." text="Choose Handling Class for the subjects you teach." />
        </Card>
      ) : (
        <Card style={{ gap: 10 }}>
          {isClass && options?.ourClass ? (
            <T v="small">
              Our Class · {options.ourClass.department} · {YEAR_LABELS[options.ourClass.year]} · Sec {options.ourClass.section} · Sem {options.ourClass.semester}
            </T>
          ) : null}
          {facultyScope === 'handling' ? (
            <>
              <T v="label">Subject</T>
              {subjects.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {subjects.map((s) => (
                    <Chip key={s._id} label={s.code} active={subjectId === s._id} onPress={() => { setSubjectId(s._id); setSection(''); }} />
                  ))}
                </View>
              ) : (
                <T v="small">No subject classes are currently assigned to you.</T>
              )}
              <T v="label">Section</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {sections.map((s) => (
                  <Chip key={s} label={`Section ${s}`} active={section === s} onPress={() => setSection(s)} />
                ))}
              </View>
            </>
          ) : null}
          {!isFaculty ? (
            <>
              <T v="label">Year</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Chip label="All" active={!year} onPress={() => setYear('')} />
                {(options?.years || []).map((y) => (
                  <Chip key={y} label={YEAR_LABELS[y] || `Year ${y}`} active={String(year) === String(y)} onPress={() => setYear(String(y))} />
                ))}
              </View>
              <T v="label">Section</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Chip label="All" active={!section} onPress={() => setSection('')} />
                {sections.map((s) => (
                  <Chip key={s} label={s} active={section === s} onPress={() => setSection(s)} />
                ))}
              </View>
            </>
          ) : null}
          {needsDate ? <DateField label="Date" value={date} onChange={setDate} maximumDate={new Date()} /> : null}
          {needsPeriod ? (
            <>
              <T v="label">Period</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Chip label="All Periods" active={period === 'all'} onPress={() => setPeriod('all')} />
                {(periodList?.periods || []).map((p) => (
                  <Chip
                    key={p.period}
                    label={`P${p.period} · ${to12h(p.startTime)}${p.completed ? '' : ' ⏳'}`}
                    active={String(period) === String(p.period)}
                    onPress={() => setPeriod(String(p.period))}
                  />
                ))}
              </View>
            </>
          ) : null}
          {type === 'custom' ? (
            <>
              <DateField label="Start date" value={from} onChange={setFrom} maximumDate={to || new Date()} />
              <DateField label="End date" value={to} onChange={setTo} minimumDate={from || undefined} maximumDate={new Date()} />
            </>
          ) : null}
          {type === 'current' ? <T v="small">Today’s completed periods only — the server’s clock decides.</T> : null}
        </Card>
      )}

      {blocked ? null : isFetching && !report ? (
        <Loading />
      ) : error ? (
        <Card style={{ flexDirection: 'row', gap: 10 }}>
          <AlertTriangle size={18} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <T style={{ fontFamily: fonts.bold }}>Report not available</T>
            <T v="small">{errMsg(error)}</T>
          </View>
        </Card>
      ) : report ? (
        <View style={{ gap: 10, opacity: isFetching ? 0.6 : 1 }}>
          <Card style={{ gap: 2 }}>
            <T v="h3">{report.title}</T>
            <T v="small">
              {[report.header.department, report.header.year && YEAR_LABELS[report.header.year], report.header.section && `Sec ${report.header.section}`, report.header.semester && `Sem ${report.header.semester}`]
                .filter(Boolean)
                .join(' · ')}
            </T>
            {report.header.classInCharge ? <T v="small">Class In-Charge: {report.header.classInCharge}</T> : null}
            <T v="small">Generated {report.header.generatedAt} (server time)</T>
          </Card>

          {report.type === 'period' ? (
            report.notTaken ? (
              <Card>
                <EmptyState icon={FileText} title="Attendance was not taken for this period" />
              </Card>
            ) : (
              <Card style={{ gap: 8 }}>
                <T v="small">
                  P{report.header.period} · {report.header.subjectCode} {report.header.subject} · {to12h(report.header.startTime)} – {to12h(report.header.endTime)} · {report.header.facultyName}
                </T>
                <Names title="PRESENT STUDENTS" list={report.present} color={colors.success} />
                <Names title="ABSENT STUDENTS" list={report.absent} color={colors.danger} />
              </Card>
            )
          ) : (
            <>
              <Card>
                <T v="small">
                  {report.totals.periodsConducted} periods · {report.totals.present} present · {report.totals.absent} absent · {report.totals.percentage}%
                </T>
              </Card>
              {(report.periods || []).map((p) => (
                <Card key={p.period} style={{ gap: 6 }}>
                  <T style={{ fontFamily: fonts.bold }}>
                    Period {p.period} · {p.subjectCode} {p.subject}
                  </T>
                  <T v="small">
                    {to12h(p.startTime)} – {to12h(p.endTime)} · {p.facultyName || '—'}
                  </T>
                  <Names title="PRESENT" list={p.present} color={colors.success} />
                  <Names title="ABSENT" list={p.absent} color={colors.danger} />
                </Card>
              ))}
              {report.students?.length ? <SectionTitle title="Students" /> : null}
              {(report.students || []).map((s, i) => (
                <Card key={`${s.rollNo}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T numberOfLines={1} style={{ fontFamily: fonts.bold }}>
                      {s.name}
                    </T>
                    <T v="small">
                      {s.rollNo || '—'} · {s.presentPeriods}/{s.totalPeriods} present · {s.absentPeriods} absent
                    </T>
                  </View>
                  <T style={{ fontFamily: fonts.bold, color: s.totalPeriods ? pctColor(s.percentage) : colors.soft }}>{s.totalPeriods ? `${s.percentage}%` : '—'}</T>
                </Card>
              ))}
            </>
          )}
        </View>
      ) : null}
    </>
  );
}
