import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Calendar,
  CalendarCheck2,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Download,
  GraduationCap,
  Info,
  Layers,
  Lock,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import {
  useGetAttendanceSessionsQuery,
  useGetAttendanceSummaryQuery,
  useGetCorrectionsQuery,
  useGetLowAttendanceQuery,
  useGetReportOptionsQuery,
  useGetMyPeriodsQuery,
  useGetRosterQuery,
  useGetStudentAttendanceQuery,
  useGetSubjectAttendanceQuery,
  useGetSubjectsQuery,
  useGetSummaryFacultyQuery,
  useMarkClassAttendanceMutation,
  useNotifyLowAttendanceStudentMutation,
  useReviewCorrectionMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import {
  ACADEMIC_YEARS,
  ATTENDANCE_READ_ONLY,
  COLLEGE_WIDE,
  DEPARTMENTS,
  SECTIONS,
  SUMMARY_VIEW,
  YEAR_LABELS,
  semestersOfYear,
  yearOfSemester,
} from '../../utils/constants';
import { DailySummary, FacultyMarking } from './DailySummary';
import MyClasses from './MyClasses';
import OurClass from './OurClass';
import AttendanceReports from './AttendanceReports';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Skeleton,
  StatCard,
  Tabs,
  cn,
} from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { MiniStat, PercentBadge, PercentBars, RangeFilter, StatusBadge, rangeParams } from '../../components/insights';
import { errMsg, fmtClassDay, fmtDateTime, todayKey } from '../../utils/format';

/** Faculty pick from subjects they teach, an HOD from their department's, admin from all. */
const subjectScope = (me) =>
  me.role === 'faculty' ? { mine: 'true' } : me.role === 'hod' ? { department: me.department } : undefined;

const to12h = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const PERIOD_STATUS = {
  UPCOMING: { color: 'info', label: 'Upcoming', badgeClass: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20' },
  ACTIVE: { color: 'success', label: 'In Progress', badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 font-bold' },
  COMPLETED: { color: 'neutral', label: 'Completed', badgeClass: 'bg-white/5 text-ink-muted border border-white/10' },
};

/* ── Hero Dashboard Component ───────────────────────────────────── */
function AttendanceHeroDashboard({ onQuickMark }) {
  const me = useSelector(selectUser);
  const isHod = me.role === 'hod';
  const isAdmin = me.role === 'admin';
  const isFaculty = me.role === 'faculty';

  // 1. Low attendance count
  const { data: lowData } = useGetLowAttendanceQuery({ range: 'semester' });
  const atRiskCount = lowData?.students?.length ?? 0;

  // 2. Pending corrections
  const { data: pendingData } = useGetCorrectionsQuery({ status: 'pending', limit: 100 });
  const pendingCount = pendingData?.pagination?.total ?? 0;

  // 3. Today's summary (Health score)
  const summaryParams = {
    date: todayKey(),
    ...(isHod && me.department ? { department: me.department } : {}),
  };
  const { data: summaryData } = useGetAttendanceSummaryQuery(summaryParams);

  // 4. Today's periods (for faculty or HOD quick view)
  const { data: periodsData } = useGetMyPeriodsQuery(undefined, { pollingInterval: 30000 });
  const todayPeriods = periodsData?.periods || [];

  // 5. Faculty compliance (unmarked faculty today in HOD's department)
  const { data: facultySummary } = useGetSummaryFacultyQuery(
    { date: todayKey(), ...(isHod && me.department ? { department: me.department } : {}) },
    { skip: !isHod && !isAdmin }
  );

  const unmarkedFaculty = useMemo(() => {
    if (!facultySummary?.faculty) return [];
    return facultySummary.faculty.filter((f) => f.status === 'unmarked');
  }, [facultySummary]);

  const studentPct = summaryData?.students?.percentage ?? (atRiskCount === 0 ? 100 : Math.max(70, 95 - atRiskCount));

  return (
    <div className="space-y-4">
      {/* 4 KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={TrendingUp}
          label={isHod ? 'Dept Attendance Health' : 'Overall Health'}
          value={`${studentPct}%`}
          hint={
            summaryData?.students?.total
              ? `${summaryData.students.present} of ${summaryData.students.total} students present today`
              : 'Based on current term data'
          }
          gradient="from-violet-500 to-indigo-600"
        />

        <StatCard
          icon={AlertTriangle}
          label="Students At Risk"
          value={atRiskCount}
          hint={`Below ${lowData?.threshold || 75}% attendance threshold`}
          gradient="from-rose-500 to-pink-600"
        />

        <StatCard
          icon={ClipboardCheck}
          label="Today's Classes"
          value={todayPeriods.length > 0 ? todayPeriods.filter((p) => p.marked).length : summaryData?.students?.total ? 'Active' : '0'}
          hint={todayPeriods.length > 0 ? `${todayPeriods.filter((p) => p.marked).length} of ${todayPeriods.length} periods marked` : 'Class sessions tracking'}
          gradient="from-emerald-400 to-teal-600"
        />

        <StatCard
          icon={Clock}
          label="Pending Corrections"
          value={pendingCount}
          hint={pendingCount > 0 ? `${pendingCount} awaiting approval` : 'All requests reviewed'}
          gradient="from-amber-400 to-orange-500"
        />
      </div>

      {/* Faculty Compliance Alert (For HOD/Admin) */}
      {(isHod || isAdmin) && unmarkedFaculty.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-400">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold">Faculty Attendance Alert</p>
              <p className="text-xs text-ink-muted">
                {unmarkedFaculty.length} faculty member{unmarkedFaculty.length > 1 ? 's' : ''} in {me.department || 'the college'} haven't been marked today:
                {' '}
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  {unmarkedFaculty.slice(0, 3).map((f) => f.name).join(', ')}
                  {unmarkedFaculty.length > 3 ? ` +${unmarkedFaculty.length - 3} more` : ''}
                </span>
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-amber-800 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20 text-xs"
            onClick={() => onQuickMark('faculty')}
          >
            Mark Faculty Now →
          </Button>
        </div>
      )}

      {/* Today's Quick Mark Widget (For Faculty & HOD teaching classes) */}
      {todayPeriods.length > 0 && (
        <Card className="p-4 border border-white/10 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary-400" />
              <h4 className="text-sm font-bold tracking-tight">Today's Class Schedule & Quick Mark</h4>
            </div>
            <span className="text-xs text-ink-muted">{fmtClassDay(periodsData?.date, 'EEEE, dd MMM')}</span>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
            {todayPeriods.map((p) => {
              const st = PERIOD_STATUS[p.status] || PERIOD_STATUS.UPCOMING;
              const isActive = p.status === 'ACTIVE';

              return (
                <div
                  key={p.slotId}
                  className={cn(
                    'flex-shrink-0 w-64 rounded-2xl p-3.5 transition-all border flex flex-col justify-between',
                    isActive && !p.marked
                      ? 'bg-primary-500/10 border-primary-500/40 shadow-glow'
                      : p.marked
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-white/5 border-white/10'
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-primary-400">
                        Period {p.period}
                      </span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', st.badgeClass)}>
                        {p.marked ? '✓ Marked' : st.label}
                      </span>
                    </div>

                    <p className="font-bold text-sm text-ink truncate">{p.subject?.name}</p>
                    <p className="text-xs text-ink-muted truncate">
                      {p.subject?.code} · {p.department}
                      {p.section ? ` · Sec ${p.section}` : ''}
                    </p>
                    <p className="text-[11px] text-ink-muted mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {to12h(p.startTime)} – {to12h(p.endTime)}
                    </p>
                  </div>

                  <div className="mt-3 pt-2 border-t border-white/10">
                    {isActive ? (
                      <Button
                        size="sm"
                        variant={p.marked ? 'outline' : 'primary'}
                        className="w-full text-xs py-1"
                        icon={ClipboardCheck}
                        onClick={() => onQuickMark('mark', { slotId: p.slotId })}
                      >
                        {p.marked ? 'Update Sheet' : 'Take Attendance'}
                      </Button>
                    ) : p.marked ? (
                      <button
                        type="button"
                        onClick={() => onQuickMark('mark', { slotId: p.slotId })}
                        className="w-full rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 py-1 text-center text-xs font-semibold text-emerald-700 dark:text-emerald-400 transition-colors"
                      >
                        Review Marks →
                      </button>
                    ) : (
                      <span className="text-center block text-[11px] text-ink-muted font-medium py-1">
                        {p.status === 'UPCOMING' ? `Opens at ${to12h(p.startTime)}` : 'Period Ended'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── Smart Step-by-Step Class Wizard for Mark Attendance ─────────── */
function ClassSelectionWizard({
  cls,
  onClassChange,
  form,
  onFormChange,
  subjects,
  loadingSubjects,
  me,
}) {
  const isHod = me.role === 'hod';
  const availableYears = ACADEMIC_YEARS;
  const availableSemesters = cls.year ? semestersOfYear(cls.year) : [];

  // Filter subjects based on selected department, year, semester
  const filteredSubjects = useMemo(() => {
    return subjects.filter((s) => {
      const matchDept = !cls.department || s.department === cls.department;
      const matchYear = !cls.year || yearOfSemester(s.semester) === Number(cls.year);
      const matchSem = !cls.semester || s.semester === Number(cls.semester);
      return matchDept && matchYear && matchSem;
    });
  }, [subjects, cls]);

  const selectedSubject = subjects.find((s) => s._id === form.subjectId);
  const hasSections = (selectedSubject?.sections?.length || 0) > 0;

  // Track active wizard step (1 to 5)
  // 1: Department, 2: Year/Semester, 3: Subject, 4: Section, 5: Date & Period
  const currentStep = useMemo(() => {
    if (!cls.department) return 1;
    if (!cls.year || !cls.semester) return 2;
    if (!form.subjectId) return 3;
    if (hasSections && !form.section) return 4;
    return 5;
  }, [cls, form, hasSections]);

  const isStepComplete = (step) => {
    if (step === 1) return Boolean(cls.department);
    if (step === 2) return Boolean(cls.year && cls.semester);
    if (step === 3) return Boolean(form.subjectId);
    if (step === 4) return !hasSections || Boolean(form.section);
    if (step === 5) return Boolean(form.date && form.period);
    return false;
  };

  return (
    <Card className="p-5 border border-white/10 shadow-lg backdrop-blur-md space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-500 text-white text-xs font-bold">
              {currentStep}
            </span>
            <span>Class Selection Wizard</span>
          </h3>
          <p className="text-xs text-ink-muted">
            Configure department, class, subject and period step-by-step
          </p>
        </div>

        {/* Reset Button */}
        {(form.subjectId || cls.year) && (
          <Button
            size="sm"
            variant="ghost"
            icon={RotateCcw}
            onClick={() => {
              onClassChange({ year: '', semester: '' });
              onFormChange({ subjectId: '', section: '', period: '' });
            }}
            className="text-xs text-ink-soft hover:text-ink"
          >
            Reset Selection
          </Button>
        )}
      </div>

      {/* Stepper Progress Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { step: 1, title: 'Department', value: cls.department || 'Select' },
          { step: 2, title: 'Year & Sem', value: cls.year ? `Y${cls.year} · Sem ${cls.semester || '?'}` : 'Select' },
          { step: 3, title: 'Subject', value: selectedSubject ? selectedSubject.code : 'Select' },
          { step: 4, title: 'Section', value: hasSections ? (form.section ? `Sec ${form.section}` : 'Select') : 'All Sections' },
          { step: 5, title: 'Period', value: form.period ? `Period ${form.period}` : 'Select' },
        ].map((item) => {
          const done = isStepComplete(item.step);
          const active = currentStep === item.step;

          return (
            <div
              key={item.step}
              className={cn(
                'rounded-xl p-2.5 border transition-all text-left',
                active
                  ? 'border-primary-500/60 bg-primary-500/10 ring-1 ring-primary-500/30'
                  : done
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-white/5 bg-white/[0.02] opacity-60'
              )}
            >
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                <span>Step {item.step}</span>
                {done && <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
              </div>
              <p className="font-bold text-xs mt-0.5 truncate">{item.title}</p>
              <p className={cn('text-[11px] truncate', done ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-ink-muted')}>
                {item.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Wizard Step Controls */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 pt-1">
        {/* Step 1: Department */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-ink-muted block mb-1.5" htmlFor="w-dept">
            1. Department
          </label>
          <select
            id="w-dept"
            className="input w-full text-xs py-2 rounded-xl"
            value={cls.department}
            disabled={isHod}
            onChange={(e) => {
              onClassChange({ department: e.target.value });
              onFormChange({ subjectId: '', section: '' });
            }}
          >
            {isHod ? (
              <option value={me.department}>{me.department}</option>
            ) : (
              <>
                <option value="">Choose department</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        {/* Step 2: Year & Semester */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-ink-muted block mb-1.5" htmlFor="w-year">
              2. Year
            </label>
            <select
              id="w-year"
              className="input w-full text-xs py-2 rounded-xl"
              value={cls.year}
              disabled={!cls.department}
              onChange={(e) => {
                onClassChange({ year: e.target.value });
                onFormChange({ subjectId: '', section: '' });
              }}
            >
              <option value="">Year</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {YEAR_LABELS[y] || `Year ${y}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-ink-muted block mb-1.5" htmlFor="w-sem">
              Semester
            </label>
            <select
              id="w-sem"
              className="input w-full text-xs py-2 rounded-xl"
              value={cls.semester}
              disabled={!cls.year}
              onChange={(e) => {
                onClassChange({ semester: e.target.value });
                onFormChange({ subjectId: '', section: '' });
              }}
            >
              <option value="">Sem</option>
              {availableSemesters.map((s) => (
                <option key={s} value={s}>
                  Sem {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Step 3: Subject */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-ink-muted block mb-1.5" htmlFor="w-subject">
            3. Subject
          </label>
          <select
            id="w-subject"
            className="input w-full text-xs py-2 rounded-xl"
            value={form.subjectId}
            disabled={!cls.semester || loadingSubjects}
            onChange={(e) => onFormChange({ subjectId: e.target.value, section: '' })}
          >
            <option value="">
              {!cls.semester
                ? 'Select semester first'
                : loadingSubjects
                ? 'Loading subjects...'
                : filteredSubjects.length
                ? 'Choose subject'
                : 'No subjects found'}
            </option>
            {filteredSubjects.map((s) => (
              <option key={s._id} value={s._id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Step 4: Section */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-ink-muted block mb-1.5" htmlFor="w-sec">
            4. Section
          </label>
          <select
            id="w-sec"
            className="input w-full text-xs py-2 rounded-xl"
            value={form.section}
            disabled={!form.subjectId || !hasSections}
            onChange={(e) => onFormChange({ section: e.target.value })}
          >
            <option value="">{hasSections ? 'Select Section' : 'All Sections (Single)'}</option>
            {selectedSubject?.sections?.map((sec) => (
              <option key={sec} value={sec}>
                Section {sec}
              </option>
            ))}
          </select>
        </div>

        {/* Step 5: Date & Period */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-ink-muted block mb-1.5" htmlFor="w-date">
              5. Date
            </label>
            <input
              id="w-date"
              type="date"
              className="input w-full text-xs py-2 rounded-xl"
              max={todayKey()}
              min={isHod ? todayKey() : undefined}
              value={form.date}
              disabled={isHod}
              onChange={(e) => onFormChange({ date: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-ink-muted block mb-1.5" htmlFor="w-period">
              Period
            </label>
            <select
              id="w-period"
              className="input w-full text-xs py-2 rounded-xl"
              value={form.period}
              disabled={!form.subjectId}
              onChange={(e) => onFormChange({ period: e.target.value })}
            >
              <option value="">Period</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((p) => (
                <option key={p} value={String(p)}>
                  Period {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Mark Attendance Main Tab ─────────────────────────────────────── */
function MarkAttendance({ preset, onPresetUsed }) {
  const me = useSelector(selectUser);
  const isFaculty = me.role === 'faculty';
  const isHod = me.role === 'hod';

  const { data: subjects = [], isLoading: loadingSubjects } = useGetSubjectsQuery(subjectScope(me), { skip: isFaculty });

  const [form, setForm] = useState({ slotId: '', subjectId: '', section: '', date: todayKey(), period: '' });
  const [cls, setCls] = useState({ department: isHod ? me.department : '', year: '', semester: '' });
  const [marks, setMarks] = useState({});
  const [rosterSearch, setRosterSearch] = useState('');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'list'

  const [save, { isLoading: saving }] = useMarkClassAttendanceMutation();

  const handleClassChange = (patch) => {
    setCls((c) => {
      const next = { ...c, ...patch };
      if (patch.year !== undefined && !semestersOfYear(next.year).includes(Number(next.semester))) {
        next.semester = '';
      }
      return next;
    });
    setForm((f) => ({ ...f, slotId: '', subjectId: '', section: '' }));
  };

  const handleFormChange = (patch) => {
    setForm((f) => ({ ...f, slotId: '', ...patch }));
  };

  useEffect(() => {
    if (preset) {
      setForm((prev) => ({ ...prev, ...preset }));
      onPresetUsed();
    }
  }, [preset, onPresetUsed]);

  const selectedSubject = subjects.find((s) => s._id === form.subjectId);
  const ready =
    Boolean(form.slotId) ||
    Boolean(form.subjectId && form.date && form.period && (!selectedSubject?.sections?.length || form.section));

  const rosterArgs = form.slotId
    ? { slotId: form.slotId, ...(isFaculty ? {} : { date: form.date }) }
    : { subjectId: form.subjectId, date: form.date, period: form.period, section: form.section || undefined };

  const { data: roster, isFetching, error } = useGetRosterQuery(rosterArgs, {
    skip: !ready,
    refetchOnMountOrArgChange: true,
  });

  // Initialize student marks
  useEffect(() => {
    if (roster?.students) {
      setMarks(Object.fromEntries(roster.students.map((s) => [s._id, s.status || 'present'])));
    }
  }, [roster]);

  const counts = useMemo(() => {
    return Object.values(marks).reduce((acc, v) => ({ ...acc, [v]: (acc[v] || 0) + 1 }), {});
  }, [marks]);

  const submit = async () => {
    const records = Object.entries(marks).map(([student, status]) => ({ student, status }));
    try {
      const res = await save(
        form.slotId
          ? { slotId: form.slotId, ...(isFaculty ? {} : { date: form.date }), records }
          : { subjectId: form.subjectId, date: form.date, period: Number(form.period), section: form.section || undefined, records }
      ).unwrap();
      toast.success(`${res.message} · ${res.created} new, ${res.modified} updated`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Filter students by search term
  const filteredStudents = useMemo(() => {
    if (!roster?.students) return [];
    if (!rosterSearch.trim()) return roster.students;
    const q = rosterSearch.toLowerCase();
    return roster.students.filter(
      (s) => s.name?.toLowerCase().includes(q) || (s.rollNo || '').toLowerCase().includes(q)
    );
  }, [roster, rosterSearch]);

  const totalStudents = roster?.students?.length || 0;
  const presentCount = counts.present || 0;
  const absentCount = counts.absent || 0;
  const classPct = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* HOD date lock banner */}
      {isHod && (
        <div className="flex items-center gap-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 p-3.5 text-xs text-sky-700 dark:text-sky-300">
          <Lock className="h-4 w-4 shrink-0 text-sky-400" />
          <span>
            As HOD, you can mark or update attendance for today only. Earlier dates are protected — contact an admin for prior corrections.
          </span>
        </div>
      )}

      {/* Class Selector Wizard */}
      {!isFaculty && (
        <ClassSelectionWizard
          cls={cls}
          onClassChange={handleClassChange}
          form={form}
          onFormChange={handleFormChange}
          subjects={subjects}
          loadingSubjects={loadingSubjects}
          me={me}
        />
      )}

      {/* Class Roster Section */}
      {!ready ? (
        <Card className="border border-white/10 shadow-lg p-8">
          <EmptyState
            icon={ClipboardList}
            title="Complete the wizard steps to load class"
            text="Pick Department, Year, Semester, Subject, Section, and Period to display the student attendance roster."
          />
        </Card>
      ) : isFetching && !roster ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} />
      ) : roster && !roster.students.length ? (
        <Card className="border border-white/10 shadow-lg">
          <EmptyState
            icon={Users}
            title="No students enrolled"
            text="No students found matching this department, year, semester, and section."
          />
        </Card>
      ) : roster ? (
        <Card className="p-0 overflow-hidden border border-white/10 shadow-xl backdrop-blur-md">
          {/* Roster Header */}
          <div className="border-b border-white/10 p-5 bg-white/[0.02]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-extrabold tracking-tight text-ink">
                    {roster.subject.code} · {roster.subject.name}
                  </h3>
                  {roster.section && (
                    <Badge color="primary" className="text-xs">
                      Section {roster.section}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-ink-muted mt-1">
                  {fmtClassDay(roster.date, 'EEEE, dd MMMM yyyy')} · Period {roster.period}
                  {roster.slot && ` · ${to12h(roster.slot.startTime)} – ${to12h(roster.slot.endTime)}`}
                  {roster.slot?.faculty?.name && ` · ${roster.slot.faculty.name}`}
                </p>
              </div>

              {/* Attendance Progress & Quick Mark Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="success"
                  disabled={!roster.editable}
                  icon={CheckCheck}
                  onClick={() => setMarks(Object.fromEntries(roster.students.map((s) => [s._id, 'present'])))}
                >
                  All Present
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!roster.editable}
                  icon={X}
                  onClick={() => setMarks(Object.fromEntries(roster.students.map((s) => [s._id, 'absent'])))}
                >
                  All Absent
                </Button>
              </div>
            </div>

            {/* Attendance Bar */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/5 border border-white/10 p-3">
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> {presentCount} Present
                </span>
                <span className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-400">
                  <XCircle className="h-4 w-4" /> {absentCount} Absent
                </span>
                <span className="text-ink-muted">({totalStudents} total students)</span>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-ink">{classPct}% Attendance</span>
                <div className="w-24 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all duration-300',
                      classPct >= 75 ? 'bg-emerald-500' : classPct >= 65 ? 'bg-amber-500' : 'bg-rose-500'
                    )}
                    style={{ width: `${classPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Locked Notice */}
          {!roster.editable && (
            <div className="m-4 flex items-center gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3.5 text-xs text-amber-700 dark:text-amber-300">
              <Lock className="h-4 w-4 shrink-0 text-amber-500" />
              <span>{roster.lockedReason || 'This attendance sheet is locked.'}</span>
            </div>
          )}

          {/* Search bar & View mode toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-white/5 bg-white/[0.01]">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted" />
              <input
                type="text"
                placeholder="Search student or roll no..."
                value={rosterSearch}
                onChange={(e) => setRosterSearch(e.target.value)}
                className="input pl-9 pr-3 py-1.5 text-xs rounded-xl w-full"
              />
            </div>

            <div className="glass inline-flex rounded-xl p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={cn('px-3 py-1 rounded-lg font-bold transition-all', viewMode === 'cards' ? 'bg-primary-500 text-white' : 'text-ink-soft')}
              >
                Card Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn('px-3 py-1 rounded-lg font-bold transition-all', viewMode === 'list' ? 'bg-primary-500 text-white' : 'text-ink-soft')}
              >
                Compact List
              </button>
            </div>
          </div>

          {/* Students: Interactive Flip-Cards Grid */}
          {viewMode === 'cards' ? (
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredStudents.map((s, index) => {
                const isPresent = marks[s._id] === 'present';
                return (
                  <button
                    key={s._id}
                    type="button"
                    disabled={!roster.editable}
                    onClick={() =>
                      setMarks((prev) => ({
                        ...prev,
                        [s._id]: isPresent ? 'absent' : 'present',
                      }))
                    }
                    className={cn(
                      'group relative flex flex-col items-center justify-between rounded-2xl p-4 text-center transition-all duration-200 border-2 shadow-sm text-left select-none',
                      isPresent
                        ? 'bg-emerald-500/10 border-emerald-500/40 hover:border-emerald-500/80 shadow-emerald-500/5'
                        : 'bg-rose-500/10 border-rose-500/40 hover:border-rose-500/80 shadow-rose-500/5',
                      !roster.editable && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    {/* Index Number */}
                    <span className="absolute left-3 top-3 text-[10px] font-mono font-bold text-ink-muted">
                      #{index + 1}
                    </span>

                    {/* Avatar & Student Name */}
                    <div className="flex flex-col items-center w-full mt-1">
                      <Avatar user={s} size="md" />
                      <p className="mt-2 text-sm font-bold text-ink truncate w-full px-1">{s.name}</p>
                      <p className="text-xs font-mono text-ink-muted">{s.rollNo || 'No Roll'}</p>
                    </div>

                    {/* Big Tap Toggle Pill */}
                    <div
                      className={cn(
                        'mt-3.5 flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-extrabold shadow-sm transition-transform group-hover:scale-105',
                        isPresent ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                      )}
                    >
                      {isPresent ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : <X className="h-3.5 w-3.5 stroke-[3]" />}
                      <span>{isPresent ? 'PRESENT' : 'ABSENT'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            /* Compact Table View */
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02] text-left text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                    <th className="px-5 py-3">#</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Roll No</th>
                    <th className="px-4 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredStudents.map((s, index) => {
                    const isPresent = marks[s._id] === 'present';
                    return (
                      <tr
                        key={s._id}
                        onClick={() => {
                          if (roster.editable) {
                            setMarks((prev) => ({ ...prev, [s._id]: isPresent ? 'absent' : 'present' }));
                          }
                        }}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-white/[0.04]',
                          isPresent ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-rose-500'
                        )}
                      >
                        <td className="px-5 py-3 text-xs font-mono text-ink-muted">{index + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar user={s} size="xs" />
                            <span className="font-bold text-ink">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-ink-muted">{s.rollNo || '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold',
                              isPresent ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : 'bg-rose-500/20 text-rose-700 dark:text-rose-400'
                            )}
                          >
                            {isPresent ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                            {isPresent ? 'Present' : 'Absent'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Sticky Bottom Save Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 p-4 bg-white/[0.02]">
            <p className="text-xs text-ink-muted">
              Ready to submit: <span className="font-bold text-emerald-700 dark:text-emerald-400">{presentCount} present</span>,{' '}
              <span className="font-bold text-rose-700 dark:text-rose-400">{absentCount} absent</span>
            </p>
            <Button
              onClick={submit}
              loading={saving}
              disabled={!roster.editable}
              icon={Save}
              className="shadow-glow px-6"
            >
              {roster.alreadyMarked ? 'Save Changes' : 'Submit Attendance'}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/* ── History (Sessions) Component ───────────────────────────────── */
function Sessions({ onOpen }) {
  const [range, setRange] = useState({ range: 'month' });
  const [search, setSearch] = useState('');
  const { data, isLoading, error, refetch } = useGetAttendanceSessionsQuery(rangeParams(range));

  const filteredSessions = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(
      (s) =>
        s.subject?.code?.toLowerCase().includes(q) ||
        s.subject?.name?.toLowerCase().includes(q) ||
        (s.section || '').toLowerCase().includes(q)
    );
  }, [data, search]);

  return (
    <Card className="p-0 overflow-hidden border border-white/10 shadow-lg backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5 bg-white/[0.02]">
        <div>
          <h3 className="text-base font-extrabold tracking-tight">Class Attendance History</h3>
          <p className="text-xs text-ink-muted">Browse previously marked sessions and make updates</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted" />
            <input
              type="text"
              placeholder="Search history..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 pr-3 py-1.5 text-xs rounded-xl w-full"
            />
          </div>
          <RangeFilter value={range} onChange={setRange} />
        </div>
      </div>

      {isLoading ? (
        <div className="p-5 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="p-5">
          <ErrorState error={error} onRetry={refetch} />
        </div>
      ) : !filteredSessions.length ? (
        <div className="p-8">
          <EmptyState
            icon={CalendarCheck2}
            title="No class records found"
            text="No attendance sessions recorded for the selected time range."
          />
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {filteredSessions.map((s) => (
            <div
              key={`${s.subject._id}-${s.date}-${s.period}-${s.section}`}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-white/[0.03] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-sm text-ink truncate">
                    {s.subject.code} · {s.subject.name}
                  </p>
                  {s.section && (
                    <Badge color="primary" className="text-[10px]">
                      Sec {s.section}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  {fmtClassDay(s.date, 'EEEE, dd MMM')} · Period {s.period}
                  {s.snapshot ? ` · ${to12h(s.snapshot.startTime)} – ${to12h(s.snapshot.endTime)}` : ''} ·{' '}
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">{s.present}</span> of {s.total} present
                  {s.edits ? ` · ${s.edits} edit${s.edits > 1 ? 's' : ''}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <PercentBadge value={s.percentage} />
                <Button
                  size="sm"
                  variant={s.editable ? 'primary' : 'outline'}
                  icon={s.editable ? Pencil : Lock}
                  onClick={() =>
                    onOpen({
                      subjectId: s.subject._id,
                      section: s.section || '',
                      date: String(s.date).slice(0, 10),
                      period: String(s.period),
                    })
                  }
                  className="text-xs py-1"
                >
                  {s.editable ? 'Edit' : 'View'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── Student Detail Modal ────────────────────────────────────────── */
function StudentModal({ id, onClose }) {
  const { data, isLoading, error } = useGetStudentAttendanceQuery({ id }, { skip: !id });
  return (
    <Modal
      open={Boolean(id)}
      onClose={onClose}
      title={data?.student?.name || 'Student Attendance'}
      subtitle={
        data
          ? `${data.student.rollNo || ''} · ${data.student.department || ''}${
              data.student.section ? ` · Sec ${data.student.section}` : ''
            }`
          : ''
      }
      size="lg"
    >
      {isLoading ? (
        <Skeleton className="h-44 rounded-2xl" />
      ) : error ? (
        <ErrorState error={error} />
      ) : data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Overall" value={`${data.overall.percentage}%`} />
            <MiniStat label="Present" value={data.overall.presentPeriods} />
            <MiniStat label="Conducted" value={data.overall.totalPeriods} />
          </div>
          <PercentBars
            threshold={data.threshold}
            rows={data.subjects.map((s) => ({
              key: s._id,
              label: `${s.subject.code} · ${s.subject.name}`,
              value: s.percentage,
              sub: `${s.presentPeriods}/${s.totalPeriods}`,
            }))}
          />
        </div>
      ) : null}
    </Modal>
  );
}

/* ── Low Attendance Component (Enhanced with Severity Bands & Notify) */
/**
 * Low attendance.
 *
 * A faculty account gets no section selector: the scope is their own teaching
 * assignments, which the server derives from the timetable. An HOD keeps a
 * section filter, but only over the sections of their own department.
 */
function LowAttendance() {
  const me = useSelector(selectUser);
  const isFaculty = me.role === 'faculty';
  const [range, setRange] = useState({ range: 'semester' });
  const [section, setSection] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all'); // 'all' | 'critical' | 'risk'

  const { data: options } = useGetReportOptionsQuery(undefined, { skip: isFaculty });
  const { data, isLoading, error, refetch } = useGetLowAttendanceQuery({
    ...rangeParams(range),
    section: isFaculty ? undefined : section || undefined,
  });

  const [notifyStudent, { isLoading: notifying }] = useNotifyLowAttendanceStudentMutation();

  const threshold = data?.threshold || 75;

  const handleNotify = async (student) => {
    try {
      await notifyStudent({
        id: student._id,
        message: `Notice: Your attendance is currently ${student.percentage || 'below threshold'}%, which is below the mandatory ${threshold}% requirement. Please contact your department HOD / class advisor immediately.`,
      }).unwrap();
      toast.success(`Warning notification sent to ${student.name}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const handleExportCSV = () => {
    if (!data?.students?.length) {
      toast.error('No students to export');
      return;
    }
    const headers = ['#', 'Name', 'Roll No', 'Department', 'Section', 'Present', 'Total', 'Attendance %', 'Risk Level'];
    const rows = data.students.map((r, i) => {
      const risk = r.percentage < 65 ? 'Critical' : 'At Risk';
      return [
        i + 1,
        `"${r.student?.name || ''}"`,
        `"${r.student?.rollNo || ''}"`,
        `"${r.student?.department || ''}"`,
        `"${r.student?.section || ''}"`,
        r.present,
        r.total,
        `${r.percentage}%`,
        risk,
      ];
    });
    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Low_Attendance_${todayKey()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('CSV exported successfully');
  };

  const filteredStudents = useMemo(() => {
    if (!data?.students) return [];
    return data.students.filter((r) => {
      const matchesSearch =
        !search.trim() ||
        r.student?.name?.toLowerCase().includes(search.toLowerCase()) ||
        (r.student?.rollNo || '').toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;

      if (severityFilter === 'critical') return r.percentage < 65;
      if (severityFilter === 'risk') return r.percentage >= 65 && r.percentage < threshold;
      return true;
    });
  }, [data, search, severityFilter, threshold]);

  const criticalCount = useMemo(() => {
    return (data?.students || []).filter((r) => r.percentage < 65).length;
  }, [data]);

  const atRiskCount = useMemo(() => {
    return (data?.students || []).filter((r) => r.percentage >= 65 && r.percentage < threshold).length;
  }, [data, threshold]);

  return (
    <Card className="p-0 overflow-hidden border border-white/10 shadow-lg backdrop-blur-md">
      {/* Header Bar */}
      <div className="border-b border-white/10 p-5 bg-white/[0.02]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-700 dark:text-rose-400" />
              <h3 className="text-base font-extrabold tracking-tight">Low Attendance Tracker</h3>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              Follow up with students falling below the mandatory {threshold}% threshold
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isFaculty && (
              <select
                aria-label="Section"
                className="input w-auto rounded-xl py-1.5 text-xs font-semibold"
                value={section}
                onChange={(e) => setSection(e.target.value)}
              >
                <option value="">All sections</option>
                {(options?.sections?.length ? options.sections : SECTIONS).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            <Button
              size="sm"
              variant="outline"
              icon={Download}
              onClick={handleExportCSV}
              disabled={!data?.students?.length}
              className="text-xs py-1"
            >
              Export CSV
            </Button>
            <RangeFilter value={range} onChange={setRange} />
          </div>
        </div>

        {/* Severity Bands Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'all', label: `All At-Risk (${(data?.students || []).length})` },
              { id: 'critical', label: `🔴 Critical <65% (${criticalCount})` },
              { id: 'risk', label: `🟡 Warning 65–${threshold}% (${atRiskCount})` },
            ].map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setSeverityFilter(btn.id)}
                className={cn(
                  'rounded-xl px-3 py-1.5 text-xs font-bold transition-all',
                  severityFilter === btn.id
                    ? 'bg-ink/10 text-ink font-bold shadow-sm ring-1 ring-ink/20 dark:bg-white/20 dark:text-white dark:ring-white/30'
                    : 'bg-black/5 text-ink-soft hover:bg-black/10 dark:bg-white/5 dark:text-ink-soft dark:hover:bg-white/10'
                )}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* Search + Section filter */}
          <div className="flex items-center gap-2">
            <select
              aria-label="Section"
              className="input w-auto rounded-xl py-1 text-xs"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              <option value="">All Sections</option>
              {SECTIONS.map((s) => (
                <option key={s} value={s}>
                  Sec {s}
                </option>
              ))}
            </select>
            <div className="relative w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted" />
              <input
                type="text"
                placeholder="Search student..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-9 pr-3 py-1 text-xs rounded-xl w-full"
              />
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-5 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="p-5">
          <ErrorState error={error} onRetry={refetch} />
        </div>
      ) : !filteredStudents.length ? (
        <div className="p-8">
          <EmptyState
            icon={Check}
            title={`No students in this band 🎉`}
            text={`All students are above the filtered attendance range.`}
          />
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {filteredStudents.map((r) => {
            const isCritical = r.percentage < 65;
            return (
              <div
                key={r._id}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.03]',
                  isCritical ? 'border-l-4 border-l-rose-500 bg-rose-500/[0.02]' : 'border-l-4 border-l-amber-500'
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedStudent(r._id)}
                  className="flex items-center gap-3 text-left min-w-0 flex-1 group"
                >
                  <Avatar user={r.student} size="sm" />
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-ink group-hover:text-primary-400 transition-colors truncate">
                      {r.student?.name}
                    </p>
                    <p className="text-xs text-ink-muted truncate">
                      {r.student?.rollNo || '—'} · {r.student?.department}
                      {r.student?.section ? ` · Sec ${r.student.section}` : ''} ·{' '}
                      <span className="font-semibold text-rose-700 dark:text-rose-400">{r.present}</span> of {r.total} periods attended
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-3">
                  <PercentBadge value={r.percentage} threshold={threshold} />

                  {/* Send In-App Warning Notification Button */}
                  <Button
                    size="sm"
                    variant="soft"
                    icon={Bell}
                    loading={notifying}
                    title="Send warning in-app notification"
                    onClick={() => handleNotify(r.student)}
                    className="text-xs py-1"
                  >
                    Notify
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <StudentModal id={selectedStudent} onClose={() => setSelectedStudent(null)} />
    </Card>
  );
}

/* ── Corrections Component (with Bulk Approve & Action Cards) ─────── */
function Corrections() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState({});
  const [search, setSearch] = useState('');

  const { data, isLoading, error, refetch } = useGetCorrectionsQuery({ status, page });
  const [review, { isLoading: saving }] = useReviewCorrectionMutation();

  const act = async (id, action) => {
    try {
      await review({ id, action, note: notes[id] || undefined }).unwrap();
      toast.success(`Request ${action}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const bulkApproveAll = async () => {
    if (!data?.requests?.length) return;
    const pendingIds = data.requests.map((c) => c._id);
    try {
      await Promise.all(pendingIds.map((id) => review({ id, action: 'approved' }).unwrap()));
      toast.success(`Approved all ${pendingIds.length} requests successfully`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const filteredRequests = useMemo(() => {
    if (!data?.requests) return [];
    if (!search.trim()) return data.requests;
    const q = search.toLowerCase();
    return data.requests.filter(
      (c) =>
        c.student?.name?.toLowerCase().includes(q) ||
        (c.student?.rollNo || '').toLowerCase().includes(q) ||
        c.subject?.code?.toLowerCase().includes(q)
    );
  }, [data, search]);

  return (
    <Card className="p-0 overflow-hidden border border-white/10 shadow-lg backdrop-blur-md">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5 bg-white/[0.02]">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary-400" />
            <h3 className="text-base font-extrabold tracking-tight">Correction Requests</h3>
          </div>
          <p className="text-xs text-ink-muted mt-0.5">Review and approve attendance adjustments requested by students</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {status === 'pending' && filteredRequests.length > 1 && (
            <Button
              size="sm"
              variant="success"
              icon={CheckCheck}
              loading={saving}
              onClick={bulkApproveAll}
              className="text-xs py-1"
            >
              Approve All ({filteredRequests.length})
            </Button>
          )}

          <div className="glass inline-flex rounded-xl p-0.5">
            {['pending', 'approved', 'rejected'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => {
                  setStatus(st);
                  setPage(1);
                }}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition-all',
                  status === st ? 'bg-primary-500 text-white shadow-glow' : 'text-ink-soft hover:text-ink'
                )}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-5 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="p-5">
          <ErrorState error={error} onRetry={refetch} />
        </div>
      ) : !filteredRequests.length ? (
        <div className="p-8">
          <EmptyState
            icon={ClipboardCheck}
            title={`No ${status} correction requests`}
            text={`No correction records found in this category.`}
          />
        </div>
      ) : (
        <div className="p-5 space-y-4">
          {filteredRequests.map((c) => (
            <div
              key={c._id}
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-4.5 transition-all hover:border-white/20 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar user={c.student} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink truncate">
                      {c.student?.name} <span className="font-normal text-xs text-ink-muted">· {c.student?.rollNo}</span>
                    </p>
                    <p className="text-xs text-ink-muted">
                      {c.subject?.code} · {fmtClassDay(c.date, 'EEEE, dd MMM')} · Period {c.period}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-bold">
                  <StatusBadge status={c.currentStatus} />
                  <ArrowRight className="h-3.5 w-3.5 text-ink-muted" />
                  <StatusBadge status={c.requestedStatus} />
                </div>
              </div>

              {/* Student Reason */}
              <div className="mt-3 rounded-xl bg-white/5 border border-white/5 p-3 text-xs text-ink-soft">
                <span className="font-bold text-ink-muted uppercase tracking-wider text-[10px] block mb-1">
                  Reason given:
                </span>
                “{c.reason}”
              </div>

              {/* Action Buttons / Review Info */}
              {c.status === 'pending' ? (
                <div className="mt-3.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    className="input flex-1 rounded-xl py-1.5 text-xs"
                    placeholder="Optional note to student..."
                    maxLength={300}
                    value={notes[c._id] || ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [c._id]: e.target.value }))}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      loading={saving}
                      icon={Check}
                      onClick={() => act(c._id, 'approved')}
                      className="text-xs"
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={saving}
                      icon={X}
                      onClick={() => act(c._id, 'rejected')}
                      className="text-xs"
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-2.5 text-xs text-ink-muted">
                  Reviewed by {c.reviewedBy?.name || 'Staff'} · {fmtDateTime(c.reviewedAt)}
                  {c.reviewNote ? ` · Note: “${c.reviewNote}”` : ''}
                </p>
              )}
            </div>
          ))}

          <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
        </div>
      )}
    </Card>
  );
}

/* ── Class Overview (Per Subject) Component ──────────────────────── */
/** HOD / admin / college-wide view; a faculty member gets Our Class instead. */
function ClassOverview() {
  const me = useSelector(selectUser);
  const { data: subjects = [] } = useGetSubjectsQuery(subjectScope(me));
  const [subjectId, setSubjectId] = useState('');
  const [section, setSection] = useState('');
  const [range, setRange] = useState({ range: 'semester' });
  const [search, setSearch] = useState('');

  const { data, isFetching, error } = useGetSubjectAttendanceQuery(
    { id: subjectId, section: section || undefined, ...rangeParams(range) },
    { skip: !subjectId }
  );

  const subject = subjects.find((s) => s._id === subjectId);
  const sectionOptions = subject?.sections || [];

  const filteredStudents = useMemo(() => {
    if (!data?.students) return [];
    if (!search.trim()) return data.students;
    const q = search.toLowerCase();
    return data.students.filter(
      (s) =>
        s.studentInfo?.name?.toLowerCase().includes(q) ||
        (s.studentInfo?.rollNo || '').toLowerCase().includes(q)
    );
  }, [data, search]);

  return (
    <Card className="p-0 overflow-hidden border border-white/10 shadow-lg backdrop-blur-md">
      <div className="border-b border-white/10 p-5 bg-white/[0.02]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold tracking-tight">Subject Attendance Overview</h3>
            <p className="text-xs text-ink-muted">Detailed per-student statistics for a selected subject</p>
          </div>
          <RangeFilter value={range} onChange={setRange} />
        </div>

        {/* Subject & Section Filters */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            aria-label="Subject"
            className="input w-auto min-w-[220px] rounded-xl py-1.5 text-xs font-semibold"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setSection('');
            }}
          >
            <option value="">Choose subject</option>
            {subjects.map((s) => (
              <option key={s._id} value={s._id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>

          {subject?.sections?.length > 0 && (
            <select
              aria-label="Section"
              className="input w-auto rounded-xl py-1.5 text-xs font-semibold"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              <option value="">All sections</option>
              {subject.sections.map((sec) => (
                <option key={sec} value={sec}>
                  Section {sec}
                </option>
              ))}
            </select>
          )}

          {data && (
            <div className="relative w-48 ml-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted" />
              <input
                type="text"
                placeholder="Filter student..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-9 pr-3 py-1 text-xs rounded-xl w-full"
              />
            </div>
          )}
        </div>
      </div>
      {!subjectId ? (
        <div className="p-8">
          <EmptyState
            icon={GraduationCap}
            title="Select a subject"
            text="Choose any subject above to inspect class roster attendance and trends."
          />
        </div>
      ) : isFetching && !data ? (
        <div className="p-5 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="p-5">
          <ErrorState error={error} />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-3 p-5 border-b border-white/5 bg-white/[0.01]">
            <MiniStat label="Enrolled Students" value={data.overall.totalStudents} />
            <MiniStat label="Classes Held" value={data.overall.classesConducted} />
            <MiniStat label="Class Average" value={`${data.overall.averagePercentage}%`} hint="Present ÷ Conducted" />
          </div>

          {!filteredStudents.length ? (
            <div className="p-8">
              <EmptyState icon={ClipboardList} title="No attendance recorded" text="No records match this filter." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02] text-left text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                    <th className="px-5 py-3">#</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Roll No</th>
                    <th className="px-4 py-3 text-right">Periods Attended</th>
                    <th className="px-4 py-3 text-right">Percentage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredStudents.map((s, index) => (
                    <tr key={s._id} className="transition-colors hover:bg-white/[0.03]">
                      <td className="px-5 py-3 text-xs font-mono text-ink-muted">{index + 1}</td>
                      <td className="px-4 py-3 font-bold text-ink">{s.studentInfo.name}</td>
                      <td className="px-4 py-3 text-xs font-mono text-ink-muted">{s.studentInfo.rollNo || '—'}</td>
                      <td className="px-4 py-3 text-right text-xs">
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">{s.presentPeriods}</span>
                        <span className="text-ink-muted"> / {s.totalPeriods}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <PercentBadge value={s.percentage} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </Card>
  );
}

/* ── StaffAttendance Root Container ───────────────────────────────── */
export default function StaffAttendance() {
  const me = useSelector(selectUser);
  const [params, setParams] = useSearchParams();
  // Principal, chairman, dean and AO read attendance but never mark it.
  const canMark = !ATTENDANCE_READ_ONLY.includes(me.role);
  const seesSummary = SUMMARY_VIEW.includes(me.role);
  const isHodOrAdmin = ['admin', 'hod'].includes(me.role);
  const canViewReports = ['faculty', 'hod', ...COLLEGE_WIDE].includes(me.role);

  // Grouped Navigation: Primary tabs vs Secondary (More) tabs
  const primaryTabs = [
    ...(canMark ? [{ value: 'mark', label: 'Mark Attendance' }] : []),
    ...(seesSummary ? [{ value: 'today', label: 'Daily Summary' }] : []),
    ...(me.role === 'faculty' ? [{ value: 'my-classes', label: 'My Classes' }] : []),
  ];

  const secondaryTabs = [
    { value: 'sessions', label: 'History' },
    { value: 'overview', label: me.role === 'faculty' ? 'Our Class' : 'Class Overview' },
    { value: 'low', label: 'Low Attendance' },
    { value: 'corrections', label: 'Corrections' },
    ...(canViewReports ? [{ value: 'reports', label: 'Reports' }] : []),
    ...(isHodOrAdmin ? [{ value: 'faculty', label: 'Faculty Attendance' }] : []),
  ];

  const allTabs = [...primaryTabs, ...secondaryTabs];

  const requested = params.get('tab');
  const currentTab = allTabs.some((t) => t.value === requested) ? requested : allTabs[0]?.value || 'mark';

  const [preset, setPreset] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const setTab = (t) => {
    setParams(t === allTabs[0]?.value ? {} : { tab: t }, { replace: true });
    setMoreOpen(false);
  };

  const { data: pending } = useGetCorrectionsQuery({ status: 'pending', limit: 1 });
  const pendingCount = pending?.pagination?.total || 0;

  const isCurrentSecondary = secondaryTabs.some((t) => t.value === currentTab);
  const activeSecondaryItem = secondaryTabs.find((t) => t.value === currentTab);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={ClipboardCheck}
        title="Attendance Center"
        subtitle={
          canMark
            ? 'Mark daily sessions, manage student rosters, review corrections, and support students at risk.'
            : 'College-wide attendance tracking, department summaries, and analytical reports.'
        }
      />
      {/* Hero Dashboard (Always Visible) */}
      <AttendanceHeroDashboard
        onQuickMark={(tabName, presetArgs) => {
          if (presetArgs) setPreset(presetArgs);
          setTab(tabName);
        }}
      />

      {/* Grouped Tab Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary Tabs */}
          <div className="glass inline-flex rounded-2xl p-1 shadow-inner">
            {primaryTabs.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={cn(
                  'rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200',
                  currentTab === t.value
                    ? 'bg-primary-500 text-white shadow-glow'
                    : 'text-ink-soft hover:text-ink hover:bg-white/5'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* More ▾ Dropdown for Secondary Tools */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className={cn(
                'flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-bold transition-all border',
                isCurrentSecondary
                  ? 'border-primary-500/50 bg-primary-500/15 text-primary-300 ring-1 ring-primary-500/30'
                  : 'border-white/10 bg-white/5 text-ink-soft hover:text-ink hover:bg-white/10'
              )}
            >
              <span>{isCurrentSecondary ? activeSecondaryItem?.label : 'More Attendance Tools'}</span>
              {pendingCount > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] text-white font-extrabold animate-pulse">
                  {pendingCount}
                </span>
              )}
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', moreOpen && 'rotate-180')} />
            </button>

            {/* Dropdown Menu */}
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                <div className="absolute left-0 top-full mt-2 z-40 w-56 rounded-2xl border border-white/15 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-xl animate-fade-in">
                  {secondaryTabs.map((t) => {
                    const isCorrections = t.value === 'corrections';
                    const active = currentTab === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setTab(t.value)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition-all',
                          active
                            ? 'bg-primary-500 text-white font-bold'
                            : 'text-ink-soft hover:bg-black/5 dark:hover:bg-white/10 hover:text-ink'
                        )}
                      >
                        <span>{t.label}</span>
                        {isCorrections && pendingCount > 0 && (
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-bold',
                              active ? 'bg-white/20 text-white' : 'bg-rose-500 text-white'
                            )}
                          >
                            {pendingCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Informational calculation notice */}
        <p className="hidden md:flex items-center gap-1.5 text-[11px] text-ink-muted">
          <Info className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
          <span>Attendance % is calculated as total present periods ÷ total conducted periods</span>
        </p>
      </div>

      {/* Main Tab Views */}
      <div className="pt-1">
        {currentTab === 'today' && <DailySummary />}
        {currentTab === 'faculty' && <FacultyMarking />}
        {currentTab === 'mark' && <MarkAttendance preset={preset} onPresetUsed={() => setPreset(null)} />}
        {currentTab === 'sessions' && (
          <Sessions
            onOpen={(p) => {
              setPreset(p);
              setTab('mark');
            }}
          />
        )}
        {/* For a faculty member, Class overview is "Our Class": their Class
            In-Charge class, complete and with no subject to choose. */}
        {currentTab === 'overview' && (me.role === 'faculty' ? <OurClass /> : <ClassOverview />)}
        {currentTab === 'low' && <LowAttendance />}
        {currentTab === 'my-classes' && <MyClasses />}
        {currentTab === 'reports' && <AttendanceReports />}
        {currentTab === 'corrections' && <Corrections />}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> Attendance % is always total present periods ÷ total conducted periods — never an average of subject percentages.
      </p>
    </div>
  );
}
