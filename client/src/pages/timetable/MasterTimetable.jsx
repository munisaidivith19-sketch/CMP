import { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  Clock,
  Coffee,
  Download,
  Filter,
  GraduationCap,
  Layers,
  MapPin,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { useDeleteSlotMutation, useGetMasterTimetableQuery } from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import {
  ACADEMIC_YEARS,
  DEPARTMENTS,
  FIRST_YEAR_HOD_DEPT,
  WEEKDAYS,
  YEAR_LABELS,
  isBranchHod,
  isFirstYearHod,
} from '../../utils/constants';
import { errMsg, fmtClassDay, displayName } from '../../utils/format';
import { downloadMasterTimetablePdf } from '../../services/reports';
import SlotModal from './SlotModal';
import { HolidayBanner } from '../attendance/Holidays';

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

export default function MasterTimetable() {
  const me = useSelector(selectUser);
  const isFYH = isFirstYearHod(me);
  const isBrH = isBranchHod(me);

  const [day, setDay] = useState(WEEKDAYS.includes(todayName()) ? todayName() : 'monday');
  const [yearFilter, setYearFilter] = useState('all');
  const [selectedDept, setSelectedDept] = useState(isFYH ? '' : me.department || '');
  const [facultySearch, setFacultySearch] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Editing state
  const [edit, setEdit] = useState(undefined); // undefined = closed, null = new, object = existing slot
  const [editingClass, setEditingClass] = useState(null);
  const [preset, setPreset] = useState(null);
  const [del, setDel] = useState(null);
  const [removeSlot, { isLoading: removing }] = useDeleteSlotMutation();

  // Query parameters for master timetable
  const queryParams = useMemo(() => {
    const p = {};
    if (yearFilter !== 'all') p.year = Number(yearFilter);
    if (isFYH && selectedDept) p.department = selectedDept;
    return p;
  }, [yearFilter, isFYH, selectedDept]);

  const { data, isLoading, isFetching, error, refetch } = useGetMasterTimetableQuery(queryParams);

  const slots = useMemo(() => data?.slots || [], [data]);
  const periods = useMemo(() => data?.periods || [], [data]);
  const allDaySlots = useMemo(() => slots.filter((s) => s.dayOfWeek === day), [slots, day]);

  // Derive visible classes based on filters
  const visibleClasses = useMemo(() => {
    let list = data?.classes || [];
    if (yearFilter !== 'all') {
      list = list.filter((c) => c.year === Number(yearFilter));
    }
    if (isFYH && selectedDept) {
      list = list.filter((c) => c.department === selectedDept);
    }
    return list;
  }, [data?.classes, yearFilter, isFYH, selectedDept]);

  // Periods active on the selected day
  const dayPeriods = useMemo(() => {
    if (periods.length) return periods;
    // Fallback standard periods
    return [1, 2, 3, 4, 5, 6, 7].map((p) => ({ period: p, startTime: '', endTime: '', isBreak: false }));
  }, [periods]);

  // Search filter matching
  const searchNeedle = facultySearch.trim().toLowerCase();

  // Statistics for the selected day
  const stats = useMemo(() => {
    const activeTeachingSlots = allDaySlots.filter((s) => !s.isBreak && !s.holiday);
    const uniqueFacultyIds = new Set(
      activeTeachingSlots.map((s) => String(s.faculty?._id || s.faculty)).filter(Boolean)
    );
    const labCount = activeTeachingSlots.filter((s) => s.subject?.type === 'lab').length;
    return {
      classesCount: visibleClasses.length,
      periodsCount: activeTeachingSlots.length,
      facultyCount: uniqueFacultyIds.size,
      labCount,
    };
  }, [allDaySlots, visibleClasses]);

  const openNewForClass = (cls, p = null) => {
    setEditingClass(cls);
    setPreset(p ? { dayOfWeek: day, period: p.period, startTime: p.startTime, endTime: p.endTime } : { dayOfWeek: day });
    setEdit(null);
  };

  const openEditSlot = (slot) => {
    setEditingClass({
      department: slot.department,
      year: slot.year,
      section: slot.section,
      semester: slot.semester,
    });
    setPreset(null);
    setEdit(slot);
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const filename = await downloadMasterTimetablePdf({
        dayOfWeek: day,
        year: yearFilter !== 'all' ? yearFilter : undefined,
        department: isFYH && selectedDept ? selectedDept : undefined,
      });
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to download master timetable PDF');
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

  return (
    <div className="space-y-5">
      {/* ── Filters & Controls Bar ──────────────────────────────────── */}
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/60 pb-3 dark:border-white/10">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:bg-primary-500/20 dark:text-primary-400">
              <Layers className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-extrabold text-ink dark:text-slate-100">
                Master Schedule · {isFYH ? 'First Year (All Departments)' : me.department || 'Department'}
              </h2>
              <p className="text-xs muted">
                Comprehensive view of all {visibleClasses.length} section timetables combined.
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
              title="Download Master Timetable PDF"
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
              const daySlotCount = slots.filter((s) => s.dayOfWeek === d && !s.isBreak).length;
              const isToday = d === todayName();
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDay(d)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all',
                    day === d
                      ? 'bg-primary-500 text-white shadow-sm shadow-primary-500/30'
                      : 'bg-white/60 text-ink-muted hover:bg-white hover:text-ink dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-700'
                  )}
                >
                  <span>{DAY_SHORT[d]}</span>
                  {isToday && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.2 text-[9px] font-extrabold uppercase',
                        day === d ? 'bg-white/20 text-white' : 'bg-primary-500/10 text-primary-600 dark:text-primary-400'
                      )}
                    >
                      Today
                    </span>
                  )}
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px]',
                      day === d ? 'bg-white/25 text-white' : 'bg-black/5 text-ink-muted dark:bg-white/10 dark:text-slate-400'
                    )}
                  >
                    {daySlotCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Secondary Filters: Year / Department / Faculty Search */}
        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-end">
          {isFYH ? (
            <div className="w-full sm:w-56">
              <label className="label" htmlFor="master-dept">
                Department
              </label>
              <select
                id="master-dept"
                className="input text-xs"
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
              >
                <option value="">All Departments</option>
                {DEPARTMENTS.filter((d) => d !== FIRST_YEAR_HOD_DEPT).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="w-full sm:w-44">
              <label className="label" htmlFor="master-year">
                Academic Year
              </label>
              <select
                id="master-year"
                className="input text-xs"
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
              >
                <option value="all">All Years (2–4)</option>
                {(isBrH ? [2, 3, 4] : ACADEMIC_YEARS).map((y) => (
                  <option key={y} value={y}>
                    {YEAR_LABELS[y]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="relative min-w-0 flex-1">
            <label className="label" htmlFor="master-faculty">
              Search Faculty / Subject
            </label>
            <div className="relative">
              <input
                id="master-faculty"
                type="text"
                placeholder="Highlight periods by faculty name or subject code…"
                className="input pl-9 pr-8 text-xs"
                value={facultySearch}
                onChange={(e) => setFacultySearch(e.target.value)}
              />
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
              {facultySearch && (
                <button
                  type="button"
                  onClick={() => setFacultySearch('')}
                  className="absolute right-2.5 top-2.5 text-ink-muted hover:text-ink"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Metric Badges */}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/60 pt-3 text-xs dark:border-white/10 sm:gap-4">
          <div className="flex items-center gap-1.5 rounded-lg bg-primary-500/10 px-2.5 py-1 font-semibold text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">
            <GraduationCap className="h-3.5 w-3.5" />
            <span>{stats.classesCount} Classes active</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
            <CalendarCheck className="h-3.5 w-3.5" />
            <span>{stats.periodsCount} Periods scheduled</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-violet-500/10 px-2.5 py-1 font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
            <Users className="h-3.5 w-3.5" />
            <span>{stats.facultyCount} Faculty teaching today</span>
          </div>
          {stats.labCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1 font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              <BookOpen className="h-3.5 w-3.5" />
              <span>{stats.labCount} Lab sessions</span>
            </div>
          )}
        </div>
      </Card>

      {/* ── Master Grid Table ───────────────────────────────────────── */}
      {!visibleClasses.length ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="No classes match current filters"
            text="No classes or sections were found for the selected academic year or department."
            action={
              (yearFilter !== 'all' || selectedDept) && (
                <Button
                  variant="soft"
                  onClick={() => {
                    setYearFilter('all');
                    setSelectedDept('');
                  }}
                >
                  Reset filters
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 bg-slate-50/80 dark:border-white/10 dark:bg-slate-900/80">
                  {/* Sticky Class Column */}
                  <th className="sticky left-0 z-20 w-44 min-w-[176px] bg-slate-100/95 px-3 py-3.5 text-xs font-extrabold uppercase tracking-wider text-ink shadow-[2px_0_5px_rgba(0,0,0,0.05)] backdrop-blur dark:bg-slate-800/95 dark:text-slate-100">
                    Class / Section
                  </th>
                  {dayPeriods.map((p) => (
                    <th
                      key={`${p.startTime}-${p.endTime}-${p.period}`}
                      className={cn(
                        'min-w-[145px] px-3 py-3 text-xs font-bold text-ink-muted dark:text-slate-400',
                        p.isBreak && 'bg-amber-500/5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
                      )}
                    >
                      <div className="flex flex-col">
                        <span className="font-extrabold text-ink dark:text-slate-200">
                          {p.isBreak ? p.breakLabel || 'Break' : `Period ${p.period}`}
                        </span>
                        {p.startTime && p.endTime && (
                          <span className="text-[10px] font-medium opacity-80">
                            {to12h(p.startTime)} – {to12h(p.endTime)}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {visibleClasses.map((cls) => {
                  return (
                    <tr
                      key={`${cls.department}-${cls.year}-${cls.section}-${cls.semester}`}
                      className="group transition-colors hover:bg-primary-500/[0.02] dark:hover:bg-white/[0.02]"
                    >
                      {/* Sticky Row Header for Class */}
                      <td className="sticky left-0 z-10 bg-white/95 px-3 py-3 shadow-[2px_0_5px_rgba(0,0,0,0.05)] backdrop-blur dark:bg-slate-900/95">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-extrabold text-ink dark:text-slate-100">
                            {YEAR_LABELS[cls.year] || `Year ${cls.year}`} · Sec {cls.section}
                          </span>
                          <span className="text-[11px] font-semibold text-primary-600 dark:text-primary-400">
                            Sem {cls.semester}
                            {isFYH && ` · ${cls.department}`}
                          </span>
                        </div>
                      </td>

                      {/* Period Cells */}
                      {dayPeriods.map((p) => {
                        // Find matching slot for this class, day, and period
                        const slot = allDaySlots.find(
                          (s) =>
                            s.year === cls.year &&
                            s.section === cls.section &&
                            s.department === cls.department &&
                            (p.startTime ? s.startTime === p.startTime : s.period === p.period)
                        );

                        if (p.isBreak || slot?.isBreak) {
                          return (
                            <td
                              key={`${cls.section}-${p.period}`}
                              className="bg-amber-500/5 px-2 py-2 text-center text-xs font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
                            >
                              <div className="flex items-center justify-center gap-1 opacity-70">
                                <Coffee className="h-3 w-3" />
                                <span>{p.breakLabel || slot?.breakLabel || 'Break'}</span>
                              </div>
                            </td>
                          );
                        }

                        if (slot?.holiday) {
                          return (
                            <td key={`${cls.section}-${p.period}`} className="px-2 py-2">
                              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300">
                                <p className="font-bold">Holiday</p>
                                <p className="truncate text-[10px] opacity-80">{slot.holiday.reason}</p>
                              </div>
                            </td>
                          );
                        }

                        if (!slot) {
                          return (
                            <td key={`${cls.section}-${p.period}`} className="px-2 py-2">
                              <div
                                onClick={() => openNewForClass(cls, p)}
                                className="group/cell flex min-h-[74px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-black/10 p-2 transition-all hover:border-primary-400 hover:bg-primary-500/5 dark:border-white/10 dark:hover:border-primary-500/50"
                                title={`Add period for ${cls.department} Yr ${cls.year} Sec ${cls.section} at P${p.period}`}
                              >
                                <span className="text-[11px] text-ink-muted opacity-40 group-hover/cell:hidden">—</span>
                                <Plus className="hidden h-4 w-4 text-primary-500 group-hover/cell:block" />
                                <span className="hidden text-[10px] font-semibold text-primary-600 group-hover/cell:block dark:text-primary-400">
                                  Add
                                </span>
                              </div>
                            </td>
                          );
                        }

                        // Search query highlight check
                        const facultyName = displayName(slot.faculty);
                        const isMatch =
                          searchNeedle &&
                          (facultyName.toLowerCase().includes(searchNeedle) ||
                            slot.subject?.code?.toLowerCase().includes(searchNeedle) ||
                            slot.subject?.name?.toLowerCase().includes(searchNeedle));

                        const isDimmed = searchNeedle && !isMatch;

                        return (
                          <td key={`${cls.section}-${p.period}`} className="px-2 py-2 align-top">
                            <div
                              className={cn(
                                'group/item relative flex min-h-[74px] flex-col justify-between rounded-xl border p-2 transition-all duration-200',
                                slot.subject?.type === 'lab'
                                  ? 'border-amber-400/40 bg-amber-500/10 dark:border-amber-500/30 dark:bg-amber-500/15'
                                  : 'border-white/60 bg-white/80 shadow-sm dark:border-white/10 dark:bg-slate-800/80',
                                isMatch && 'ring-2 ring-primary-500 shadow-glow bg-primary-500/10',
                                isDimmed && 'opacity-35 grayscale'
                              )}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1">
                                    <span className="font-extrabold text-ink dark:text-slate-100">
                                      {slot.subject?.code}
                                    </span>
                                    {slot.subject?.type === 'lab' && (
                                      <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-black uppercase text-amber-700 dark:text-amber-300">
                                        Lab
                                      </span>
                                    )}
                                  </div>
                                  <p className="line-clamp-1 text-[11px] font-semibold text-ink-muted dark:text-slate-300" title={slot.subject?.name}>
                                    {slot.subject?.name}
                                  </p>
                                </div>
                                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100">
                                  <button
                                    type="button"
                                    onClick={() => openEditSlot(slot)}
                                    className="rounded p-1 text-ink-muted hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
                                    title="Edit period"
                                    aria-label="Edit period"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDel(slot)}
                                    className="rounded p-1 text-ink-muted hover:bg-rose-500/10 hover:text-rose-500"
                                    title="Delete period"
                                    aria-label="Delete period"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>

                              <div className="mt-1.5 flex flex-col gap-0.5 border-t border-black/5 pt-1 text-[10px] muted dark:border-white/5">
                                <span className={cn('flex items-center gap-1 font-semibold truncate', isMatch && 'text-primary-700 dark:text-primary-300 font-extrabold')}>
                                  <User className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{facultyName}</span>
                                </span>
                                {slot.room && (
                                  <span className="flex items-center gap-1 text-[9px] opacity-75">
                                    <MapPin className="h-2.5 w-2.5 shrink-0" />
                                    <span className="truncate">{slot.room}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Dialogs for Add/Edit/Delete Period */}
      {editingClass?.semester && (
        <SlotModal
          open={edit !== undefined}
          slot={edit}
          klass={editingClass}
          preset={preset}
          onClose={() => {
            setEdit(undefined);
            setEditingClass(null);
            setPreset(null);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(del)}
        onClose={() => setDel(null)}
        title="Remove this period from master timetable?"
        text={
          del
            ? `Remove ${del.subject?.code} (${del.department} Year ${del.year} Sec ${del.section}) on ${DAY_SHORT[del.dayOfWeek]} P${del.period}? Students and faculty see the change immediately.`
            : 'Students and faculty see the change immediately.'
        }
        confirmText="Remove period"
        loading={removing}
        onConfirm={async () => {
          try {
            await removeSlot(del._id).unwrap();
            toast.success('Period removed from timetable');
          } catch (e) {
            toast.error(errMsg(e));
          }
          setDel(null);
        }}
      />
    </div>
  );
}

