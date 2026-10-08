import { useState, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Filter,
  GraduationCap,
  MapPin,
  Maximize2,
  Pencil,
  Search,
  Sparkles,
  Star,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useDeleteEventMutation, useGetEventQuery, useGetParticipantsQuery, useMarkAttendanceMutation } from '../../services/api';
import { Avatar, Badge, Button, Card, CardHeader, CategoryBadge, ErrorState, PageLoader, ProgressBar, cn } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { RegisterButton, ReportButton } from '../../components/domain';
import EventForm from './EventForm';
import { catStyle, DEPARTMENTS, ACADEMIC_YEARS, YEAR_LABELS } from '../../utils/constants';
import { errMsg, eventRange, fmtDateTime, displayName } from '../../utils/format';
import { downloadEventParticipantsPdf } from '../../services/reports';

function Participants({ event, canMarkAttendance, isPast }) {
  const eventId = event?._id;
  const { data = [], isLoading, error } = useGetParticipantsQuery(eventId);
  const [mark] = useMarkAttendanceMutation();
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [markingId, setMarkingId] = useState(null);

  // Generate multi-day date sequence
  const eventDates = useMemo(() => {
    if (!event?.startDate || !event?.endDate) return [];
    const start = new Date(event.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(event.endDate);
    end.setHours(0, 0, 0, 0);
    const dates = [];
    const curr = new Date(start);
    while (curr <= end && dates.length < 30) {
      dates.push(curr.toISOString().slice(0, 10));
      curr.setDate(curr.getDate() + 1);
    }
    return dates.length > 0 ? dates : [String(event.startDate).slice(0, 10)];
  }, [event?.startDate, event?.endDate]);

  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return eventDates.includes(today) ? today : (eventDates[0] || today);
  });

  const getStatusOnDate = (r, date) => {
    if (r.status === 'waitlisted') return 'waitlisted';
    const dayRec = (r.attendanceDays || []).find((d) => d.date === date);
    if (dayRec) {
      return dayRec.attended ? 'attended' : 'absent';
    }
    if (r.status === 'attended') return 'attended';
    return 'pending';
  };

  const handleDownloadPdf = async () => {
    try {
      setDownloadingPdf(true);
      await downloadEventParticipantsPdf(eventId);
      toast.success('Participants PDF downloaded');
    } catch (e) {
      toast.error(errMsg(e) || 'Failed to download PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleMark = async (userId, attended) => {
    try {
      setMarkingId(userId);
      await mark({
        id: eventId,
        userId,
        attended,
        date: selectedDate,
      }).unwrap();
      toast.success(
        attended
          ? 'Marked present (OD credit granted)'
          : 'Marked absent (Class In-Charge alerted)'
      );
    } catch (e) {
      toast.error(errMsg(e) || 'Failed to update attendance');
    } finally {
      setMarkingId(null);
    }
  };

  // Compute live statistics for selected date
  const stats = useMemo(() => {
    let confirmed = 0;
    let attended = 0;
    let absent = 0;
    let pending = 0;
    let waitlist = 0;

    data.forEach((r) => {
      if (r.status === 'waitlisted') {
        waitlist += 1;
      } else {
        confirmed += 1;
        const s = getStatusOnDate(r, selectedDate);
        if (s === 'attended') attended += 1;
        else if (s === 'absent') absent += 1;
        else pending += 1;
      }
    });

    return { confirmed, attended, absent, pending, waitlist };
  }, [data, selectedDate]);

  // Unique departments present in participants
  const uniqueDepts = useMemo(() => {
    const set = new Set();
    data.forEach((r) => {
      if (r.user?.department) set.add(r.user.department);
    });
    DEPARTMENTS.forEach((d) => set.add(d));
    return Array.from(set).sort();
  }, [data]);

  // Filtered rows
  const filteredParticipants = useMemo(() => {
    return data.filter((r) => {
      const u = r.user || {};
      const name = displayName(u).toLowerCase();
      const roll = (u.rollNo || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      const dept = (u.department || '').toLowerCase();
      const q = search.trim().toLowerCase();

      if (q && !name.includes(q) && !roll.includes(q) && !email.includes(q) && !dept.includes(q)) {
        return false;
      }
      if (deptFilter && u.department !== deptFilter) {
        return false;
      }
      if (yearFilter && String(u.year) !== String(yearFilter)) {
        return false;
      }
      if (statusFilter) {
        const s = getStatusOnDate(r, selectedDate);
        if (statusFilter === 'attended' && s !== 'attended') return false;
        if (statusFilter === 'absent' && s !== 'absent') return false;
        if (statusFilter === 'pending' && s !== 'pending') return false;
        if (statusFilter === 'waitlisted' && r.status !== 'waitlisted') return false;
      }
      return true;
    });
  }, [data, search, deptFilter, yearFilter, statusFilter, selectedDate]);

  const selectedDateLabel = useMemo(() => {
    try {
      const d = new Date(selectedDate + 'T00:00:00');
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  return (
    <Card className="overflow-hidden border border-white/10 shadow-xl backdrop-blur-md">
      {/* Header with Title and PDF Download Button */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 p-5 bg-white/[0.02]">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-600 dark:text-primary-300">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold tracking-tight text-ink">Participant Management Roster</h3>
              <p className="text-xs text-ink-muted">
                {canMarkAttendance
                  ? 'Mark attendance for confirmed participants (On-Duty credit is automatically synced with regular class attendance).'
                  : 'View registrations and verified attendance status across event days.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="soft"
            size="sm"
            icon={Download}
            onClick={handleDownloadPdf}
            loading={downloadingPdf}
            disabled={!data.length}
            title="Download event participants list as PDF with official college logo"
            className="shadow-sm"
          >
            Download PDF
          </Button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4 border-b border-white/10 bg-white/[0.01]">
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3.5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">Total Confirmed</span>
            <Users className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          </div>
          <p className="mt-2 text-2xl font-black text-sky-950 dark:text-sky-100">{stats.confirmed}</p>
          <p className="text-[11px] text-sky-700/80 dark:text-sky-300/80">Active seats allocated</p>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Attended (Present)</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-950 dark:text-emerald-100">{stats.attended}</p>
          <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">On {selectedDateLabel} (OD credit)</p>
        </div>

        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3.5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">Pending</span>
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 text-2xl font-black text-amber-950 dark:text-amber-100">{stats.pending}</p>
          <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80">Awaiting roll call</p>
        </div>

        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/10 p-3.5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">Waitlist</span>
            <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
          <p className="mt-2 text-2xl font-black text-violet-950 dark:text-violet-100">{stats.waitlist}</p>
          <p className="text-[11px] text-violet-700/80 dark:text-violet-300/80">Auto-queue</p>
        </div>
      </div>

      {/* Multi-day date selector bar (if event spans > 1 day) */}
      {eventDates.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-3 bg-white/[0.015]">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-muted mr-1">Select Event Day:</span>
          {eventDates.map((dStr, idx) => {
            const isSelected = selectedDate === dStr;
            const dateObj = new Date(dStr + 'T00:00:00');
            const dayLabel = dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            return (
              <button
                key={dStr}
                type="button"
                onClick={() => setSelectedDate(dStr)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm',
                  isSelected
                    ? 'bg-primary-600 text-white shadow-primary-500/30'
                    : 'bg-white/5 hover:bg-white/10 text-ink-muted hover:text-ink'
                )}
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>Day {idx + 1} ({dayLabel})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search and Filters Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4 bg-white/[0.01]">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search by student name, roll no, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full pl-10 pr-4 py-2 text-xs rounded-xl"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Department filter */}
          <select
            aria-label="Filter by Department"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="input text-xs py-2 rounded-xl"
          >
            <option value="">All Departments</option>
            {uniqueDepts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          {/* Year filter */}
          <select
            aria-label="Filter by Year"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="input text-xs py-2 rounded-xl"
          >
            <option value="">All Years</option>
            {ACADEMIC_YEARS.map((y) => (
              <option key={y} value={y}>
                {YEAR_LABELS[y] || `Year ${y}`}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            aria-label="Filter by Attendance Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input text-xs py-2 rounded-xl"
          >
            <option value="">All Statuses</option>
            <option value="attended">Attended (Present)</option>
            <option value="absent">Absent</option>
            <option value="pending">Pending</option>
            <option value="waitlisted">Waitlisted</option>
          </select>

          {(search || deptFilter || yearFilter || statusFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setDeptFilter('');
                setYearFilter('');
                setStatusFilter('');
              }}
              className="text-xs"
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Participants Table Content */}
      {isLoading ? (
        <div className="p-8 text-center text-sm text-ink-muted">Loading participant roster…</div>
      ) : error ? (
        <div className="p-6">
          <ErrorState error={error} />
        </div>
      ) : !filteredParticipants.length ? (
        <div className="p-12 text-center">
          <Users className="mx-auto h-10 w-10 text-ink-muted opacity-40 mb-2" />
          <p className="text-sm font-bold text-ink">No participants match your criteria</p>
          <p className="text-xs text-ink-muted mt-1">Try adjusting your search terms or active filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                <th className="px-5 py-3.5 w-12 text-center">#</th>
                <th className="px-4 py-3.5">Student Participant</th>
                <th className="px-4 py-3.5">Academic Class</th>
                <th className="px-4 py-3.5">Registration Time</th>
                <th className="px-4 py-3.5 text-center">Attendance ({selectedDateLabel})</th>
                <th className="px-5 py-3.5 text-right">{canMarkAttendance ? 'Mark Attendance' : 'Status'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredParticipants.map((r, index) => {
                const dayStatus = getStatusOnDate(r, selectedDate);
                const isWaitlist = r.status === 'waitlisted';
                const isMutating = markingId === r.user?._id;

                return (
                  <tr key={r.user?._id || index} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-5 py-3.5 text-center font-mono text-xs text-ink-muted">
                      {index + 1}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar user={r.user} size="sm" />
                        <div className="min-w-0">
                          <p className="font-bold text-ink truncate text-sm">
                            {displayName(r.user)}
                          </p>
                          <p className="font-mono text-xs text-ink-muted truncate">
                            {r.user?.rollNo || r.user?.email || '—'}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="space-y-0.5">
                        <span className="inline-block rounded-md bg-white/5 px-2 py-0.5 text-xs font-semibold text-ink">
                          {r.user?.department || '—'}
                        </span>
                        <p className="text-[11px] text-ink-muted">
                          {r.user?.year ? `Year ${r.user.year}` : ''}
                          {r.user?.section ? ` · Sec ${r.user.section}` : ''}
                        </p>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-xs text-ink-muted">
                      {r.registeredAt ? fmtDateTime(r.registeredAt) : '—'}
                    </td>

                    <td className="px-4 py-3.5 text-center">
                      {isWaitlist ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-500/25 px-2.5 py-0.5 text-xs font-bold text-violet-700 dark:text-violet-300">
                          <Sparkles className="h-3 w-3" /> Waitlisted
                        </span>
                      ) : dayStatus === 'attended' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Present (OD)
                        </span>
                      ) : dayStatus === 'absent' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 border border-rose-500/25 px-2.5 py-0.5 text-xs font-bold text-rose-700 dark:text-rose-400">
                          <XCircle className="h-3.5 w-3.5" /> Absent
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 border border-slate-500/25 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                          <Clock className="h-3.5 w-3.5" /> Pending
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-right">
                      {isWaitlist ? (
                        <span className="text-xs text-ink-muted italic">In queue</span>
                      ) : canMarkAttendance ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={isMutating}
                            onClick={() => handleMark(r.user._id, true)}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-bold transition-all shadow-sm',
                              dayStatus === 'attended'
                                ? 'bg-emerald-600 text-white shadow-emerald-500/30'
                                : 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400'
                            )}
                            title="Mark Present (Grants academic OD credit for today)"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            <span>Present</span>
                          </button>

                          <button
                            type="button"
                            disabled={isMutating}
                            onClick={() => handleMark(r.user._id, false)}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-bold transition-all shadow-sm',
                              dayStatus === 'absent'
                                ? 'bg-rose-600 text-white shadow-rose-500/30'
                                : 'bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-400'
                            )}
                            title="Mark Absent (Alerts Class In-Charge & updates class attendance to absent)"
                          >
                            <UserX className="h-3.5 w-3.5" />
                            <span>Absent</span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-ink-muted">
                          {dayStatus === 'attended' ? 'Verified OD' : dayStatus === 'absent' ? 'Verified Absent' : 'Registered'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: ev, isLoading, error, refetch } = useGetEventQuery(id);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewingPoster, setViewingPoster] = useState(false);
  const [remove, { isLoading: deleting }] = useDeleteEventMutation();

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const style = catStyle(ev.category);

  return (
    <div className="space-y-6">
      <Link to="/events" className="inline-flex items-center gap-2 text-sm font-semibold muted hover:text-primary-600 transition-colors">
        <ArrowLeft className="h-4 w-4" /> All events
      </Link>

      {/* 2-Column Split Hero Banner */}
      <div className={cn('relative overflow-hidden rounded-[32px] bg-gradient-to-br shadow-xl p-6 sm:p-8 lg:p-10 text-white', style.grad)}>
        {ev.poster && (
          <img src={ev.poster} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-3xl" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-black/40 backdrop-blur-[2px]" />

        <div className="relative z-10 grid gap-8 lg:grid-cols-12 lg:items-center">
          {/* Left Column: Event Title, Date, Venue, and Faculty Coordinators */}
          <div className="space-y-4 lg:col-span-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/20 px-3.5 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur-md">
                {ev.category}
              </span>
              {ev.isFeatured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-amber-950 shadow-sm">
                  <Star className="h-3 w-3 fill-amber-950" /> Featured
                </span>
              )}
              {ev.isPast && <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-bold">Ended</span>}
            </div>

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight leading-tight">{ev.title}</h1>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/90">
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <CalendarDays className="h-4 w-4 text-white/80" /> {eventRange(ev.startDate, ev.endDate)}
              </span>
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <MapPin className="h-4 w-4 text-white/80" /> {ev.venue}
              </span>
            </div>

            {/* Dedicated Faculty Coordinators Showcase Card */}
            <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-md dark:border-white/10 dark:bg-black/30">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/90">
                <GraduationCap className="h-4 w-4 text-amber-300" />
                <span>Faculty Coordinators</span>
              </div>
              {ev.facultyCoordinators && ev.facultyCoordinators.length > 0 ? (
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  {ev.facultyCoordinators.map((fc) => (
                    <div
                      key={fc._id}
                      className="flex items-center gap-3 rounded-xl bg-white/15 p-2.5 backdrop-blur-sm border border-white/10 dark:bg-white/5"
                    >
                      <Avatar user={fc} size="sm" className="ring-2 ring-white/30" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-white">{fc.name}</p>
                        <p className="truncate text-xs text-white/80">
                          <span className="font-semibold text-amber-200">[{fc.department || 'General'}]</span>{' '}
                          {fc.designation || 'Faculty'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-white/70 italic">
                  Directly coordinated by Department HOD ({ev.organizer?.name || 'Department'}).
                </p>
              )}
            </div>
          </div>

          {/* Right Column: Compact Poster Preview Card */}
          <div className="flex items-center justify-center lg:col-span-5 lg:justify-end">
            {ev.poster ? (
              <div className="group relative w-full max-w-[340px] sm:max-w-[380px] overflow-hidden rounded-2xl border border-white/20 bg-black/40 shadow-2xl backdrop-blur-sm transition-transform hover:scale-[1.02]">
                <img
                  src={ev.poster}
                  alt={`${ev.title} poster`}
                  className="h-[320px] sm:h-[360px] w-full object-contain"
                />
                <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/80 via-transparent to-transparent p-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setViewingPoster(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-black shadow-lg hover:bg-white/95 active:scale-95 transition-all"
                  >
                    <Maximize2 className="h-4 w-4" /> View Full Poster
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingPoster(true)}
                  className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white/90 backdrop-blur-md hover:bg-black/90 hover:text-white transition-colors"
                  title="Open full poster"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex h-[240px] w-full max-w-[340px] flex-col items-center justify-center rounded-2xl border border-white/20 bg-white/5 p-6 text-center text-white/70 backdrop-blur-sm">
                <CalendarDays className="mb-3 h-12 w-12 text-white/40" />
                <p className="text-sm font-semibold">Campus Event</p>
                <p className="mt-1 text-xs text-white/50">Official College & Department Session</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content & Sidebar Grid */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="About this event" />
            <p className="whitespace-pre-line text-sm leading-relaxed muted">{ev.description}</p>
            {ev.tags?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {ev.tags.map((t) => (
                  <span key={t} className="chip">
                    #{t}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-6 flex items-center justify-between border-t border-white/60 pt-4 dark:border-white/10">
              <div className="flex items-center gap-3">
                <Avatar user={ev.organizer} size="sm" />
                <div>
                  <p className="text-xs muted">Organised by</p>
                  <p className="text-sm font-bold">
                    {ev.club ? (
                      <Link to={`/clubs/${ev.club.slug}`} className="hover:text-primary-600">
                        {ev.club.name}
                      </Link>
                    ) : (
                      ev.organizer?.name
                    )}
                  </p>
                </div>
              </div>
              <ReportButton targetType="event" targetId={ev._id} />
            </div>
          </Card>

        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-28">
            <CategoryBadge category={ev.category} />
            <div className="mt-4 space-y-3 text-sm">
              <p className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-300">
                  <Users className="h-4 w-4" />
                </span>
                <span>
                  <b>{ev.registeredCount}</b> registered {ev.capacity ? `of ${ev.capacity}` : '· unlimited'}
                  {ev.waitlistCount > 0 && <span className="muted"> · {ev.waitlistCount} waiting</span>}
                </span>
              </p>
              {ev.registrationDeadline && (
                <p className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
                    <Clock className="h-4 w-4" />
                  </span>
                  <span>Registration closes {fmtDateTime(ev.registrationDeadline)}</span>
                </p>
              )}
            </div>
            {ev.capacity > 0 && <ProgressBar className="mt-4" value={ev.registeredCount} max={ev.capacity} />}
            <RegisterButton event={ev} size="lg" className="mt-5 w-full" />
            {ev.myStatus === 'waitlisted' && (
              <p className="mt-3 text-center text-xs muted">You will be moved in automatically when a seat frees up.</p>
            )}

            {/* Management Actions: strictly for Principal, Admin, and the HOD who posted the event */}
            {ev.canEdit && (
              <div className="mt-5 grid grid-cols-2 gap-2 border-t border-ink/10 pt-4 dark:border-white/10">
                <Button variant="outline" icon={Pencil} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Participants Roster: Full-width responsive section visible to faculties, HODs, Principal, and higher authorities */}
      {ev.canViewParticipants && (
        <div className="mt-8">
          <Participants event={ev} canMarkAttendance={Boolean(ev.canMarkAttendance)} isPast={ev.isPast} />
        </div>
      )}

      {/* Poster Lightbox Modal */}
      {viewingPoster && ev.poster && (
        <Modal open={viewingPoster} onClose={() => setViewingPoster(false)} size="xl" title={`${ev.title} — Event Poster`}>
          <div className="flex justify-center p-2 bg-slate-950/40 rounded-2xl">
            <img src={ev.poster} alt={ev.title} className="max-h-[75vh] w-auto rounded-xl object-contain shadow-2xl" />
          </div>
        </Modal>
      )}

      <EventForm open={editing} onClose={() => setEditing(false)} event={ev} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this event?"
        text="All registered students will be notified that the event is cancelled. This cannot be undone."
        confirmText="Delete event"
        loading={deleting}
        onConfirm={async () => {
          try {
            await remove(ev._id).unwrap();
            toast.success('Event deleted');
            navigate('/events');
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}
