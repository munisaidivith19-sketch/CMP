import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { AlertTriangle, Download, FileText, Loader2, School } from 'lucide-react';
import { useGetAttendanceReportQuery, useGetReportOptionsQuery, useGetReportPeriodsQuery } from '../../services/api';
import { downloadAttendanceReport } from '../../services/reports';
import { selectUser } from '../../features/authSlice';
import { Button, Card, CardHeader, EmptyState, ErrorState, Skeleton, Tabs, cn } from '../../components/ui/primitives';
import { MiniStat, PercentBadge } from '../../components/insights';
import { ACADEMIC_YEARS, YEAR_LABELS } from '../../utils/constants';
import { errMsg, todayKey } from '../../utils/format';

/** Report types per scope. "Current data" exists only for Our Class. */
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
    { value: 'date', label: 'Particular date' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'semester', label: 'Semester' },
    { value: 'custom', label: 'Custom' },
  ],
};

const SCOPES = [
  { value: 'class', label: 'Our Class' },
  { value: 'handling', label: 'Handling Class' },
];

const to12h = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Present / absent list for a period, already ordered by roll number on the server. */
function StudentList({ title, students, tone }) {
  return (
    <div className="min-w-0">
      <p className={cn('mb-2 text-[11px] font-bold uppercase tracking-wide', tone)}>
        {title} ({students.length})
      </p>
      {students.length ? (
        <ol className="space-y-1 text-sm">
          {students.map((s, i) => (
            <li key={`${s.rollNo}-${i}`} className="flex gap-2">
              <span className="w-5 shrink-0 text-right muted">{i + 1}.</span>
              <span className="shrink-0 tabular-nums muted">{s.rollNo || '—'}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm muted">None.</p>
      )}
    </div>
  );
}

/**
 * Attendance reports.
 *
 * Faculty choose a SCOPE first:
 *  - Our Class — the class they are Class In-Charge of. No subject, section or
 *    department is chosen: the class comes from the account. Only a date and a
 *    period ("All Periods" or one of the class's real timetable periods), or a
 *    window, or "Current data" (today's finished periods).
 *  - Handling Class — one of the subjects they teach and one of that subject's
 *    sections, both listed from their real teaching assignments.
 * An HOD picks year, section and semester inside their own department.
 *
 * Every option list comes from the server, and the server re-authorizes the
 * request and decides which periods have finished — the browser clock is never
 * consulted, and a refusal is shown exactly as the server phrased it.
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
  const [semester, setSemester] = useState('');
  const [date, setDate] = useState(todayKey());
  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayKey());
  const [downloading, setDownloading] = useState(false);

  // Faculty start on Our Class when they have one, otherwise on Handling Class.
  useEffect(() => {
    if (!isFaculty || scope || !options) return;
    setScope(options.ourClass ? 'class' : 'handling');
    setType(options.ourClass ? 'current' : 'period');
  }, [isFaculty, scope, options]);

  const facultyScope = isFaculty ? scope || 'handling' : null;
  const isClass = facultyScope === 'class';
  const types = isFaculty ? TYPES[facultyScope] : TYPES.handling;
  const subjects = options?.subjects || [];
  const subject = subjects.find((s) => s._id === subjectId);
  // Handling Class: the sections of the chosen subject. HOD: the department's sections.
  const sections = isFaculty ? subject?.sections || [] : options?.sections || [];

  useEffect(() => {
    if (facultyScope === 'handling' && !subjectId && subjects.length) setSubjectId(subjects[0]._id);
  }, [facultyScope, subjects, subjectId]);
  useEffect(() => {
    if (sections.length === 1) setSection(sections[0]);
    else if (section && !sections.includes(section)) setSection('');
  }, [sections, section]);

  const changeScope = (value) => {
    setScope(value);
    setType(value === 'class' ? 'current' : 'period');
    setPeriod('all');
  };

  const needsDate = type === 'period' || type === 'date';
  const needsPeriod = type === 'period';

  // The Period dropdown: "All Periods" + the class's real periods on that date.
  const periodQuery = isClass
    ? { scope: 'class', date }
    : facultyScope === 'handling'
      ? { scope: 'handling', subjectId, section, date }
      : { date, ...(year ? { year } : {}), ...(section ? { section } : {}), ...(semester ? { semester } : {}) };
  const canListPeriods = needsPeriod && (isClass ? Boolean(options?.ourClass) : isFaculty ? Boolean(subjectId && section) : Boolean(section));
  const { data: periodList, isFetching: loadingPeriods } = useGetReportPeriodsQuery(periodQuery, { skip: !canListPeriods });
  const periods = periodList?.periods || [];

  // A specific period that is not on the new subject/section's list falls back to All Periods.
  useEffect(() => {
    if (!needsPeriod) return;
    if (period === 'all' || !periods.length) return;
    if (!periods.some((p) => String(p.period) === String(period))) setPeriod('all');
  }, [needsPeriod, periods, period]);

  const params = useMemo(() => {
    const p = {};
    if (isFaculty) {
      p.scope = facultyScope;
      if (facultyScope === 'handling') {
        if (subjectId) p.subjectId = subjectId;
        if (section) p.section = section;
      }
    } else {
      if (year) p.year = year;
      if (section) p.section = section;
      if (semester) p.semester = semester;
    }
    if (needsDate) p.date = date;
    if (needsPeriod && period) p.period = period;
    if (type === 'custom') {
      if (from) p.from = from;
      if (to) p.to = to;
    }
    return p;
  }, [isFaculty, facultyScope, subjectId, section, year, semester, needsDate, needsPeriod, date, period, type, from, to]);

  const missing = (() => {
    if (isClass && !options?.ourClass) return 'no-class';
    if (facultyScope === 'handling' && !(subjectId && section)) return 'Pick the subject and section the report should cover.';
    if (!isFaculty && needsPeriod && !section) return 'Pick the section this period report should cover.';
    if (needsPeriod && !period) return 'Pick a period.';
    if (type === 'custom' && !(from && to)) return 'Choose a start date and an end date.';
    return null;
  })();
  const ready = !missing;
  const { data, isFetching, error } = useGetAttendanceReportQuery({ type, ...params }, { skip: !ready || (isFaculty && !scope) });

  const download = async () => {
    setDownloading(true);
    try {
      const name = await downloadAttendanceReport(type, params);
      toast.success(`Downloaded ${name}`);
    } catch (e) {
      // downloadAttendanceReport throws a plain Error carrying the server's
      // own message (e.g. "This period ends at 09:15").
      toast.error(e?.message || errMsg(e));
    } finally {
      setDownloading(false);
    }
  };

  if (loadingOptions || (isFaculty && !scope)) return <Skeleton className="h-64 rounded-[28px]" />;
  if (optionsError) return <ErrorState error={optionsError} onRetry={refetch} />;

  const ourClass = options?.ourClass;
  const selectClass = 'input w-full rounded-xl py-1.5 text-xs sm:w-auto';
  const field = 'w-full sm:w-auto';

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Attendance reports"
          subtitle={
            isFaculty
              ? isClass
                ? ourClass
                  ? `Our Class · ${ourClass.department} · ${YEAR_LABELS[ourClass.year]} · Section ${ourClass.section} · Semester ${ourClass.semester}`
                  : 'Our Class'
                : 'Handling Class · the subjects and sections you teach'
              : `${options?.department || 'Your department'} — year, section and semester within your own department.`
          }
        />

        <div className="mb-4 flex flex-wrap items-end gap-2">
          {isFaculty && (
            <div className={field}>
              <label className="label" htmlFor="rp-scope">Scope</label>
              <select id="rp-scope" className={selectClass} value={facultyScope} onChange={(e) => changeScope(e.target.value)}>
                {SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <Tabs tabs={types} value={type} onChange={setType} className="mb-4 max-w-full" />

        {missing === 'no-class' ? (
          <EmptyState
            icon={School}
            title="No class is currently assigned to you as Class In-Charge."
            text="Choose Handling Class for the subjects you teach."
          />
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            {facultyScope === 'handling' && (
              <>
                <div className={field}>
                  <label className="label" htmlFor="rp-subject">Subject</label>
                  <select
                    id="rp-subject"
                    className={selectClass}
                    value={subjectId}
                    onChange={(e) => {
                      setSubjectId(e.target.value);
                      setSection('');
                    }}
                  >
                    {!subjects.length && <option value="">No subject classes are currently assigned to you.</option>}
                    {subjects.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.code} · {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={field}>
                  <label className="label" htmlFor="rp-section">Section</label>
                  <select id="rp-section" className={selectClass} value={section} onChange={(e) => setSection(e.target.value)}>
                    <option value="">Choose section</option>
                    {sections.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {!isFaculty && (
              <>
                <div className={field}>
                  <label className="label" htmlFor="rp-year">Year</label>
                  <select id="rp-year" className={selectClass} value={year} onChange={(e) => setYear(e.target.value)}>
                    <option value="">All years</option>
                    {(options?.years?.length ? options.years : ACADEMIC_YEARS).map((y) => (
                      <option key={y} value={y}>
                        {YEAR_LABELS[y] || `Year ${y}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={field}>
                  <label className="label" htmlFor="rp-section">Section</label>
                  <select id="rp-section" className={selectClass} value={section} onChange={(e) => setSection(e.target.value)}>
                    <option value="">All sections</option>
                    {sections.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className={field}>
                  <label className="label" htmlFor="rp-sem">Semester</label>
                  <select id="rp-sem" className={selectClass} value={semester} onChange={(e) => setSemester(e.target.value)}>
                    <option value="">All semesters</option>
                    {(options?.semesters || []).map((s) => (
                      <option key={s} value={s}>
                        Semester {s}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {needsDate && (
              <div className={field}>
                <label className="label" htmlFor="rp-date">Date</label>
                <input id="rp-date" type="date" max={todayKey()} className={selectClass} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            )}
            {needsPeriod && (
              <div className={field}>
                <label className="label" htmlFor="rp-period">Period</label>
                <select id="rp-period" className={selectClass} value={period} onChange={(e) => setPeriod(e.target.value)} disabled={loadingPeriods}>
                  <option value="all">All Periods</option>
                  {periods.map((p) => (
                    <option key={p.period} value={p.period}>
                      Period {p.period}
                      {p.subjectCode ? ` · ${p.subjectCode}` : ''} · {to12h(p.startTime)}
                      {p.completed ? '' : ' (not finished)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {type === 'custom' && (
              <>
                <div className={field}>
                  <label className="label" htmlFor="rp-from">Start date</label>
                  <input id="rp-from" type="date" max={to || todayKey()} className={selectClass} value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className={field}>
                  <label className="label" htmlFor="rp-to">End date</label>
                  <input id="rp-to" type="date" min={from || undefined} max={todayKey()} className={selectClass} value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </>
            )}
            {type === 'current' && (
              <p className="w-full text-xs muted sm:w-auto sm:flex-1 sm:pb-2">
                Today’s attendance from the periods that have already finished — the server’s clock decides; a running or future period is never included.
              </p>
            )}

            <Button icon={downloading ? Loader2 : Download} onClick={download} loading={downloading} disabled={!ready} className="w-full sm:w-auto">
              Download PDF
            </Button>
          </div>
        )}
      </Card>

      {missing === 'no-class' ? null : !ready ? (
        <Card>
          <EmptyState icon={FileText} title="Choose what the report covers" text={missing} />
        </Card>
      ) : isFetching && !data ? (
        <Skeleton className="h-48 rounded-[28px]" />
      ) : error ? (
        <Card>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <p className="font-semibold">Report not available</p>
              <p className="text-sm muted">{errMsg(error)}</p>
            </div>
          </div>
        </Card>
      ) : data ? (
        <Preview report={data} />
      ) : null}
    </div>
  );
}

/** On-screen preview of the same data the PDF contains. */
function Preview({ report }) {
  const h = report.header;
  const facts = [
    ['Scope', { class: 'Our Class', handling: 'Handling Class' }[h.scope]],
    ['Class In-Charge', h.classInCharge],
    ['Department', h.department],
    ['Year', h.year ? YEAR_LABELS[h.year] || `Year ${h.year}` : null],
    ['Section', h.section],
    ['Semester', h.semester],
    ['Subject', h.subject && `${h.subject}${h.subjectCode ? ` (${h.subjectCode})` : ''}`],
    ['Handling faculty', h.facultyName],
    ['Date', h.date],
    ['Range', h.from && `${h.from} → ${h.to}`],
    ['Period', h.period && `P${h.period} · ${to12h(h.startTime)} – ${to12h(h.endTime)}`],
  ].filter(([, v]) => v);

  return (
    <Card>
      <CardHeader title={report.title} subtitle={`Generated ${h.generatedAt} (server time)`} />
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {facts.map(([k, v]) => (
          <span key={k}>
            <span className="font-bold">{k}:</span> <span className="muted">{v}</span>
          </span>
        ))}
      </div>

      {report.type === 'period' ? (
        report.notTaken ? (
          <EmptyState icon={AlertTriangle} title="Attendance was not taken for this period" />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat label="Students" value={report.totals.total} />
              <MiniStat label="Present" value={report.totals.present} />
              <MiniStat label="Absent" value={report.totals.absent} />
              <MiniStat label="Attendance" value={`${report.totals.percentage}%`} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <StudentList title="Present students" students={report.present} tone="text-emerald-600 dark:text-emerald-400" />
              <StudentList title="Absent students" students={report.absent} tone="text-rose-600 dark:text-rose-400" />
            </div>
          </>
        )
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Periods held" value={report.totals.periodsConducted} />
            <MiniStat label="Present" value={report.totals.present} />
            <MiniStat label="Absent" value={report.totals.absent} />
            <MiniStat label="Attendance" value={`${report.totals.percentage}%`} />
          </div>

          {report.students?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="px-2 py-2">Student</th>
                    <th className="px-2 py-2">Roll no</th>
                    <th className="px-2 py-2">Sec</th>
                    <th className="px-2 py-2 text-right">Held</th>
                    <th className="px-2 py-2 text-right">Present</th>
                    <th className="px-2 py-2 text-right">Absent</th>
                    <th className="px-2 py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/60 dark:divide-white/5">
                  {report.students.map((s, i) => (
                    <tr key={`${s.rollNo}-${i}`} className="table-row">
                      <td className="px-2 py-2 font-semibold">{s.name}</td>
                      <td className="px-2 py-2 muted">{s.rollNo || '—'}</td>
                      <td className="px-2 py-2 muted">{s.section || '—'}</td>
                      <td className="px-2 py-2 text-right">{s.totalPeriods}</td>
                      <td className="px-2 py-2 text-right">{s.presentPeriods}</td>
                      <td className="px-2 py-2 text-right">{s.absentPeriods}</td>
                      <td className="px-2 py-2 text-right">
                        <PercentBadge value={s.percentage} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={FileText} title="Nothing recorded for this window yet" />
          )}

          {/* Period-level detail, shown when the report is opened. */}
          {report.periods?.length > 0 && (
            <div className="mt-6 space-y-5">
              {report.periods.map((p) => (
                <div key={p.period} className="rounded-2xl bg-white/50 p-4 dark:bg-white/5">
                  <p className="mb-3 text-sm font-bold">
                    Period {p.period} · {p.subjectCode} {p.subject}
                    <span className="ml-2 text-xs font-normal muted">
                      {to12h(p.startTime)} – {to12h(p.endTime)} · Sec {p.section}
                      {p.facultyName ? ` · ${p.facultyName}` : ''}
                    </span>
                  </p>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <StudentList title="Present" students={p.present} tone="text-emerald-600 dark:text-emerald-400" />
                    <StudentList title="Absent" students={p.absent} tone="text-rose-600 dark:text-rose-400" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
