import { useEffect, useState } from 'react';
import { BookOpen, ClipboardList, Users } from 'lucide-react';
import { useGetMyClassAttendanceQuery, useGetMyClassOptionsQuery } from '../../services/api';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { MiniStat, PercentBadge, RangeFilter, rangeParams } from '../../components/insights';
import { YEAR_LABELS } from '../../utils/constants';

/**
 * "My Classes": attendance for the subjects and sections the signed-in faculty
 * member actually handles.
 *
 * Both dropdowns are built from the server's own list of their teaching
 * assignments — the Section list depends on the chosen Subject, so a subject
 * taught to A and C never offers B. The backend re-checks the subject/section
 * pair on every read, so these lists are a convenience, not the boundary.
 */
export default function MyClasses() {
  const { data: options, isLoading: loadingOptions, error: optionsError, refetch } = useGetMyClassOptionsQuery();
  const [subjectId, setSubjectId] = useState('');
  const [section, setSection] = useState('');
  const [range, setRange] = useState({ range: 'semester' });

  const subjects = options?.subjects || [];
  const subject = subjects.find((s) => s._id === subjectId);
  const sections = subject?.sections || [];

  // Pick the first subject automatically, and its only section when it has one.
  useEffect(() => {
    if (!subjectId && subjects.length) setSubjectId(subjects[0]._id);
  }, [subjects, subjectId]);
  useEffect(() => {
    if (sections.length === 1) setSection(sections[0]);
    else if (section && !sections.includes(section)) setSection('');
  }, [sections, section]);

  const ready = Boolean(subjectId && section);
  const { data, isFetching, error } = useGetMyClassAttendanceQuery(
    { subjectId, section, ...rangeParams(range) },
    { skip: !ready }
  );

  if (loadingOptions) return <Skeleton className="h-64 rounded-[28px]" />;
  if (optionsError) return <ErrorState error={optionsError} onRetry={refetch} />;

  if (!subjects.length) {
    return (
      <Card>
        <EmptyState
          icon={BookOpen}
          title="No classes assigned to you yet"
          text="Your subjects and sections appear here as soon as you are scheduled for a period in the timetable."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="My classes"
        subtitle="Attendance for the subjects and sections you handle"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Subject"
              className="input w-full rounded-xl py-1.5 text-xs sm:w-auto"
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setSection('');
              }}
            >
              {subjects.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Section"
              className="input w-full rounded-xl py-1.5 text-xs sm:w-auto"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              <option value="">Choose section</option>
              {sections.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <RangeFilter value={range} onChange={setRange} />
          </div>
        }
      />

      {!ready ? (
        <EmptyState icon={Users} title="Choose a section" text="Pick one of the sections you teach this subject to." />
      ) : isFetching && !data ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} />
      ) : data ? (
        <div className={cn(isFetching && 'opacity-60')}>
          <p className="mb-3 text-xs font-semibold muted">
            {[data.class.department, YEAR_LABELS[data.class.year] || `Year ${data.class.year}`, `Section ${data.class.section}`, `Semester ${data.class.semester}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Students" value={data.overall.totalStudents} />
            <MiniStat label="Periods held" value={data.overall.classesConducted} />
            <MiniStat label="Below 75%" value={data.belowThreshold.length} />
            <MiniStat label="Class average" value={`${data.overall.percentage}%`} hint="Σ present ÷ Σ conducted" />
          </div>

          {data.students.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="px-2 py-2">Student</th>
                    <th className="px-2 py-2">Roll no</th>
                    <th className="px-2 py-2">Department</th>
                    <th className="px-2 py-2">Year</th>
                    <th className="px-2 py-2">Sec</th>
                    <th className="px-2 py-2 text-right">Present</th>
                    <th className="px-2 py-2 text-right">Absent</th>
                    <th className="px-2 py-2 text-right">Held</th>
                    <th className="px-2 py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/60 dark:divide-white/5">
                  {data.students.map((s) => (
                    <tr key={s._id} className="table-row">
                      <td className="px-2 py-2 font-semibold">{s.name}</td>
                      <td className="px-2 py-2 muted">{s.rollNo || '—'}</td>
                      <td className="px-2 py-2 muted">{s.department}</td>
                      <td className="px-2 py-2 muted">{s.year || '—'}</td>
                      <td className="px-2 py-2 muted">{s.section || '—'}</td>
                      <td className="px-2 py-2 text-right">{s.presentPeriods}</td>
                      <td className="px-2 py-2 text-right">{s.absentPeriods}</td>
                      <td className="px-2 py-2 text-right">{s.totalPeriods}</td>
                      <td className="px-2 py-2 text-right">
                        <PercentBadge value={s.percentage} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ClipboardList} title="No students in this class yet" />
          )}
        </div>
      ) : null}
    </Card>
  );
}
