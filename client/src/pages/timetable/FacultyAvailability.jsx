import { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coffee,
  Download,
  Filter,
  GraduationCap,
  MapPin,
  Search,
  User,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useGetFacultyAvailabilityQuery } from '../../services/api';
import { downloadFacultyAvailabilityPdf } from '../../services/reports';
import { selectUser } from '../../features/authSlice';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import {
  DEPARTMENTS,
  FIRST_YEAR_HOD_DEPT,
  WEEKDAYS,
  isBranchHod,
  isFirstYearHod,
} from '../../utils/constants';

const DAY_SHORT = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
};

const todayName = () => ['sunday', ...WEEKDAYS][new Date().getDay()];

const to12h = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export default function FacultyAvailability() {
  const me = useSelector(selectUser);
  const isFYH = isFirstYearHod(me);

  const [day, setDay] = useState(WEEKDAYS.includes(todayName()) ? todayName() : 'monday');
  const [selectedDept, setSelectedDept] = useState(isFYH ? '' : me.department || '');
  const [periodFilter, setPeriodFilter] = useState('all'); // 'all', 'now', or period number
  const [searchQuery, setSearchQuery] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Query parameters
  const queryParams = useMemo(() => {
    const p = { dayOfWeek: day };
    if (isFYH && selectedDept) p.department = selectedDept;
    if (periodFilter === 'now') p.freeNow = 'true';
    else if (periodFilter !== 'all') p.period = Number(periodFilter);
    return p;
  }, [day, isFYH, selectedDept, periodFilter]);

  const { data, isLoading, isFetching, error, refetch } = useGetFacultyAvailabilityQuery(queryParams);

  const faculties = useMemo(() => data?.faculties || [], [data]);
  const periods = useMemo(() => data?.periods || [], [data]);
  const stats = useMemo(() => data?.stats || { totalFaculties: 0, freeNow: 0, busyNow: 0 }, [data]);

  // Client-side search by faculty name
  const filteredFaculties = useMemo(() => {
    if (!searchQuery.trim()) return faculties;
    const q = searchQuery.toLowerCase().trim();
    return faculties.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.designation && f.designation.toLowerCase().includes(q)) ||
        (f.employeeId && f.employeeId.toLowerCase().includes(q))
    );
  }, [faculties, searchQuery]);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const filename = await downloadFacultyAvailabilityPdf({
        dayOfWeek: day,
        department: isFYH && selectedDept ? selectedDept : undefined,
        period: periodFilter !== 'all' && periodFilter !== 'now' ? periodFilter : undefined,
      });
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to download faculty availability PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  const isToday = day === todayName();

  return (
    <div className="space-y-5">
      {/* ── Header & Filter Bar ───────────────────────────────────────── */}
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/60 pb-3 dark:border-white/10">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
              <UserCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-extrabold text-ink dark:text-slate-100">
                Faculty Availability · {isFYH ? 'First Year (All Departments)' : me.department || 'Department'}
              </h2>
              <p className="text-xs muted">
                Real-time teaching vs free status for department faculty across each period.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="soft"
              size="sm"
              icon={Download}
              loading={downloadingPdf}
              onClick={handleDownloadPdf}
              title="Download Faculty Availability PDF"
            >
              Download PDF
            </Button>
          </div>
        </div>

        {/* Day Selector Chips */}
        <div>
          <p className="label mb-2 flex items-center gap-1.5 text-xs font-bold text-ink-muted">
            <CalendarDays className="h-3.5 w-3.5" /> Day of Week
          </p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const isSelected = d === day;
              const isDayToday = d === todayName();
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDay(d)}
                  className={cn(
                    'group inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all',
                    isSelected
                      ? 'bg-primary-600 text-white shadow-sm shadow-primary-600/30 dark:bg-primary-500'
                      : 'border border-slate-200/80 bg-white/70 text-ink-muted hover:border-primary-400 hover:text-primary-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:bg-white/10'
                  )}
                >
                  <span>{DAY_SHORT[d]}</span>
                  {isDayToday && (
                    <span
                      className={cn(
                        'rounded-md px-1 py-0.2 text-[9px] font-black uppercase tracking-wider',
                        isSelected
                          ? 'bg-white/20 text-white'
                          : 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                      )}
                    >
                      Today
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Controls: Quick Substitution Filter + Department (S&H) + Search */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Quick Substitution / Free Filter */}
          <div>
            <label className="label mb-1.5 flex items-center gap-1.5 text-xs font-bold text-ink-muted">
              <Filter className="h-3.5 w-3.5" /> Find Available Faculty
            </label>
            <div className="relative">
              <select
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value)}
                className="input w-full cursor-pointer appearance-none pr-9 text-xs font-semibold"
              >
                <option value="all">All Faculty (Full Daily Grid)</option>
                {isToday && <option value="now">⚡ Free Right Now (Substitutes)</option>}
                {periods
                  .filter((p) => !p.isBreak)
                  .map((p) => (
                    <option key={p.period} value={String(p.period)}>
                      Free in Period {p.period} ({to12h(p.startTime)} - {to12h(p.endTime)})
                    </option>
                  ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted transition-colors" />
            </div>
          </div>

          {/* Department filter for First-Year S&H HOD */}
          {isFYH && (
            <div>
              <label className="label mb-1.5 flex items-center gap-1.5 text-xs font-bold text-ink-muted">
                <GraduationCap className="h-3.5 w-3.5" /> Branch Department
              </label>
              <div className="relative">
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="input w-full cursor-pointer appearance-none pr-9 text-xs font-semibold"
                >
                  <option value="">All Branch Departments</option>
                  {DEPARTMENTS.filter((d) => d !== FIRST_YEAR_HOD_DEPT).map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted transition-colors" />
              </div>
            </div>
          )}

          {/* Search Faculty by name */}
          <div className={cn(isFYH ? 'sm:col-span-2 lg:col-span-1' : '')}>
            <label className="label mb-1.5 flex items-center gap-1.5 text-xs font-bold text-ink-muted">
              <Search className="h-3.5 w-3.5" /> Search Faculty
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by faculty name or staff ID..."
                className="input w-full pl-9 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stats Summary Bar */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-200/60 px-2.5 py-1 font-semibold text-ink-muted dark:bg-white/5">
            <Users className="h-3.5 w-3.5" />
            <strong className="text-ink dark:text-slate-200">{filteredFaculties.length}</strong> Faculty Members
          </span>

          {isToday && (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <strong>{stats.freeNow}</strong> Available Right Now
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/10 px-2.5 py-1 font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                <Clock className="h-3.5 w-3.5" />
                <strong>{stats.busyNow}</strong> In Class Right Now
              </span>
            </>
          )}

          {periodFilter !== 'all' && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-primary-500/10 px-2.5 py-1 font-semibold text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">
              Filtered for Available Substitutes
            </span>
          )}
        </div>
      </Card>

      {/* ── Faculty Availability Timetable Grid ──────────────────────── */}
      {filteredFaculties.length === 0 ? (
        <Card className="p-8 text-center">
          <EmptyState
            icon={UserCheck}
            title="No Faculty Found"
            description={
              searchQuery
                ? `No faculty members matched "${searchQuery}".`
                : periodFilter !== 'all'
                ? 'No faculty members are free during the selected period.'
                : 'No department faculties found for this schedule.'
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden border border-slate-200/80 p-0 shadow-sm dark:border-white/10">
          <div className="relative overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              {/* Table Header: Faculty Member + Periods with timings */}
              <thead className="sticky top-0 z-20 border-b border-slate-200/80 bg-slate-50/95 backdrop-blur-md dark:border-white/10 dark:bg-[#121426]/95">
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-30 min-w-[200px] border-r border-slate-200/80 bg-slate-100/95 p-3 font-extrabold text-ink shadow-[2px_0_5px_rgba(0,0,0,0.05)] backdrop-blur dark:border-white/10 dark:bg-[#15172e]/95 dark:text-slate-100"
                  >
                    <div className="flex items-center gap-1.5">
                      <User className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                      <span>Faculty Member</span>
                    </div>
                  </th>

                  {periods.map((p) => {
                    if (p.isBreak) {
                      return (
                        <th
                          key={`break-${p.startTime}`}
                          scope="col"
                          className="min-w-[100px] border-r border-slate-200/60 bg-amber-500/5 p-2.5 text-center dark:border-white/5 dark:bg-amber-500/10"
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="flex items-center gap-1 font-bold text-amber-700 dark:text-amber-300">
                              <Coffee className="h-3 w-3" />
                              {p.breakLabel || 'Break'}
                            </span>
                            <span className="text-[10px] text-amber-600/80 dark:text-amber-400/80">
                              {to12h(p.startTime)} - {to12h(p.endTime)}
                            </span>
                          </div>
                        </th>
                      );
                    }

                    return (
                      <th
                        key={`period-${p.period}`}
                        scope="col"
                        className="min-w-[160px] border-r border-slate-200/80 p-3 font-bold text-ink dark:border-white/10 dark:text-slate-200"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-extrabold text-primary-700 dark:text-primary-400">
                            Period {p.period}
                          </span>
                          <span className="text-[10px] font-medium text-ink-muted dark:text-slate-400">
                            {to12h(p.startTime)} – {to12h(p.endTime)}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* Table Body: One row per faculty member */}
              <tbody className="divide-y divide-slate-200/60 dark:divide-white/5">
                {filteredFaculties.map((f) => (
                  <tr
                    key={f._id}
                    className="group transition-colors hover:bg-primary-500/[0.02] dark:hover:bg-white/[0.02]"
                  >
                    {/* Sticky Faculty Info Column */}
                    <td className="sticky left-0 z-10 border-r border-slate-200/80 bg-white/95 p-3 shadow-[2px_0_5px_rgba(0,0,0,0.05)] backdrop-blur group-hover:bg-slate-50/95 dark:border-white/10 dark:bg-[#15172e]/95 dark:group-hover:bg-[#1c1f3b]/95">
                      <div className="flex items-center gap-2.5">
                        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 font-bold text-primary-600 dark:bg-primary-500/20 dark:text-primary-400">
                          {f.name.charAt(0)}
                          {isToday && (
                            <span
                              className={cn(
                                'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#15172e]',
                                f.isFreeNow ? 'bg-emerald-500' : 'bg-indigo-500'
                              )}
                              title={f.isFreeNow ? 'Free right now' : 'In class right now'}
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold text-ink dark:text-slate-100">{f.name}</p>
                          <p className="truncate text-[10px] text-ink-muted dark:text-slate-400">
                            {f.designation || 'Faculty'}
                            {f.employeeId ? ` · ${f.employeeId}` : ''}
                          </p>
                          <div className="mt-1 flex items-center gap-1.5 text-[9px] font-semibold">
                            <span className="text-emerald-700 dark:text-emerald-400">
                              {f.freePeriods} Free
                            </span>
                            <span className="text-ink-muted dark:text-slate-500">·</span>
                            <span className="text-indigo-700 dark:text-indigo-400">
                              {f.busyPeriods} In Class
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Period Cells */}
                    {periods.map((p) => {
                      if (p.isBreak) {
                        return (
                          <td
                            key={`cell-break-${f._id}-${p.startTime}`}
                            className="border-r border-slate-200/60 bg-amber-500/[0.03] p-2 text-center text-[10px] font-bold text-amber-700/60 dark:border-white/5 dark:bg-amber-500/[0.05] dark:text-amber-400/60"
                          >
                            <span className="opacity-70">{p.breakLabel || 'Break'}</span>
                          </td>
                        );
                      }

                      const periodItem = f.periods?.find(
                        (item) => item.period === p.period || (!p.isBreak && item.startTime === p.startTime)
                      );

                      if (!periodItem || periodItem.status === 'free') {
                        return (
                          <td
                            key={`cell-free-${f._id}-${p.period}`}
                            className="border-r border-slate-200/60 p-2.5 dark:border-white/5"
                          >
                            <div className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2 text-emerald-800 transition-all group-hover:border-emerald-500/30 group-hover:bg-emerald-500/15 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                              <span className="text-[11px] font-bold">Available</span>
                            </div>
                          </td>
                        );
                      }

                      if (periodItem.status === 'holiday') {
                        return (
                          <td
                            key={`cell-holiday-${f._id}-${p.period}`}
                            className="border-r border-slate-200/60 p-2.5 dark:border-white/5"
                          >
                            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-2 text-center text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/20 dark:text-rose-300">
                              <p className="text-[10px] font-bold uppercase tracking-wider">Holiday</p>
                              <p className="truncate text-[9px] opacity-80">{periodItem.title || 'Declared'}</p>
                            </div>
                          </td>
                        );
                      }

                      // Busy / Teaching
                      const slot = periodItem.slot;
                      return (
                        <td
                          key={`cell-busy-${f._id}-${p.period}`}
                          className="border-r border-slate-200/60 p-2.5 dark:border-white/5"
                        >
                          <div className="flex flex-col gap-1 rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2 text-ink dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-slate-100">
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate font-extrabold text-indigo-700 dark:text-indigo-300">
                                {slot?.subject?.code || 'CLASS'}
                              </span>
                              {slot?.room && (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-white/70 px-1 py-0.2 text-[9px] font-bold text-ink-muted dark:bg-white/10 dark:text-slate-300">
                                  <MapPin className="h-2.5 w-2.5" />
                                  {slot.room}
                                </span>
                              )}
                            </div>
                            <p className="truncate text-[10px] font-medium text-ink-muted dark:text-slate-400">
                              {slot ? `${slot.department} · Y${slot.year} Sec ${slot.section}` : 'In Class'}
                            </p>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

