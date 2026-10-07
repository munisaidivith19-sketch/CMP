import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  LogIn,
  LogOut,
  MapPin,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Avatar, Button, EmptyState, cn } from '../../components/ui/primitives';
import { StatusBadge } from '../../components/insights';
import { fmtClassDay, fmtStamp, timeAgo, displayName, titleCase } from '../../utils/format';
import { GATE_PASS_REGARDING } from '../../utils/constants';
import { EmergencyBadge, isEmergency } from './EmergencyGatePass';

const MODAL_CONFIG = {
  pending: {
    title: 'Pending Gate Pass Requests',
    subtitle: 'Students awaiting review with their current approval stage',
    icon: Clock,
    iconGradient: 'from-amber-400 to-orange-500',
    emptyTitle: 'No pending requests',
    emptyText: 'All gate pass requests within your scope have been processed.',
  },
  outside: {
    title: 'Students Outside Campus',
    subtitle: 'Students currently off-campus with departure times and return expectations',
    icon: Users,
    iconGradient: 'from-sky-400 to-blue-500',
    emptyTitle: 'Everyone is on campus',
    emptyText: 'There are currently no students outside campus within your scope.',
  },
  exits: {
    title: 'Campus Exits',
    subtitle: 'Students who exited campus during this period',
    icon: LogOut,
    iconGradient: 'from-violet-400 to-indigo-500',
    emptyTitle: 'No exits recorded',
    emptyText: 'No campus departures have been logged for this period.',
  },
  returns: {
    title: 'Campus Returns',
    subtitle: 'Students who checked back into campus during this period',
    icon: LogIn,
    iconGradient: 'from-emerald-400 to-teal-500',
    emptyTitle: 'No returns recorded',
    emptyText: 'No campus returns have been logged for this period.',
  },
};

export function getStageBadge(pass) {
  if (!pass) return null;
  const status = pass.status;
  if (status === 'pending_faculty') {
    return {
      label: 'Waiting for Class In-Charge review',
      className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20',
      icon: Clock,
    };
  }
  if (status === 'parent_verified') {
    return {
      label: 'Parent Verified · Waiting for HOD forwarding',
      className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20',
      icon: ShieldCheck,
    };
  }
  if (status === 'pending_hod') {
    return {
      label: 'Waiting for HOD approval',
      className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20',
      icon: UserCheck,
    };
  }
  if (status === 'pending_principal') {
    return {
      label: 'Waiting for Principal approval',
      className: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20',
      icon: CheckCircle2,
    };
  }
  if (status === 'pending_authority') {
    const authLabel = pass.emergencyAuthority ? pass.emergencyAuthority.toUpperCase() : 'Authority';
    return {
      label: `Waiting for ${authLabel} emergency approval`,
      className: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20',
      icon: AlertTriangle,
    };
  }
  return {
    label: pass.stageLabel || titleCase(status.replace('pending_', 'Waiting on ')),
    className: 'bg-neutral-500/10 text-ink-muted border border-neutral-500/20',
    icon: Clock,
  };
}

export default function GatePassListModal({ type, open, onClose, passes = [], linkProfile = false }) {
  const [search, setSearch] = useState('');
  const config = MODAL_CONFIG[type] || MODAL_CONFIG.pending;
  const Icon = config.icon;

  const filteredPasses = useMemo(() => {
    if (!search.trim()) return passes;
    const q = search.toLowerCase();
    return passes.filter((p) => {
      const s = p.student || {};
      const name = (s.name || '').toLowerCase();
      const rollNo = (s.rollNo || '').toLowerCase();
      const dept = (s.department || p.department || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      return name.includes(q) || rollNo.includes(q) || dept.includes(q) || desc.includes(q);
    });
  }, [passes, search]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <div className="flex items-center gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-soft', config.iconGradient)}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-extrabold text-ink dark:text-primary-50">{config.title}</h3>
              <span className="rounded-full bg-primary-500/10 px-2.5 py-0.5 text-xs font-bold text-primary-600 dark:text-primary-400">
                {passes.length}
              </span>
            </div>
            <p className="text-xs text-ink-soft dark:text-ink-muted">{config.subtitle}</p>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Search filter input */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            type="text"
            placeholder="Search by student name, roll number, or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full rounded-2xl py-2 pl-10 pr-9 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Content list */}
        {filteredPasses.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon={config.icon}
              title={search ? 'No matching students' : config.emptyTitle}
              text={search ? `No student matches "${search}"` : config.emptyText}
            />
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {filteredPasses.map((p) => {
              const student = p.student || {};
              const stage = type === 'pending' ? getStageBadge(p) : null;
              const StageIcon = stage?.icon;

              return (
                <div
                  key={p._id}
                  className="group flex flex-col gap-3 rounded-2xl border border-white/60 bg-white/70 p-4 shadow-sm transition hover:border-primary-500/30 hover:bg-white dark:border-white/5 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    {/* Student Info */}
                    <div className="flex min-w-0 items-center gap-3">
                      {linkProfile && student._id ? (
                        <Link
                          to={`/people/${student._id}`}
                          title={`View ${student.name}'s profile`}
                          className="shrink-0 rounded-full ring-primary-400 transition hover:ring-2"
                        >
                          <Avatar user={student} size="md" />
                        </Link>
                      ) : (
                        <Avatar user={student} size="md" />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-bold text-ink dark:text-primary-50">
                            {displayName(student)}
                          </p>
                          {isEmergency(p) && <EmergencyBadge />}
                          {p.overdue && <StatusBadge status="rejected" label="Overdue" />}
                        </div>
                        <p className="truncate text-xs text-ink-soft dark:text-ink-muted">
                          {student.rollNo || 'No Roll No'} · {student.department || p.department}
                          {student.year ? ` · Year ${student.year}` : ''}
                          {student.section ? ` · Sec ${student.section}` : p.section ? ` · Sec ${p.section}` : ''}
                        </p>
                      </div>
                    </div>

                    {/* Quick view button */}
                    <Button
                      size="sm"
                      variant="ghost"
                      to={`/gate-pass/${p._id}`}
                      icon={ArrowRight}
                      className="shrink-0 text-xs"
                      onClick={onClose}
                    >
                      View pass
                    </Button>
                  </div>

                  {/* Stage Badge for Pending */}
                  {type === 'pending' && stage && (
                    <div className={cn('flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold', stage.className)}>
                      {StageIcon && <StageIcon className="h-4 w-4 shrink-0" />}
                      <span>{stage.label}</span>
                    </div>
                  )}

                  {/* Specific Card Movement Details */}
                  <div className="grid grid-cols-1 gap-2 rounded-xl bg-ink/5 p-3 text-xs dark:bg-white/[0.02] sm:grid-cols-2">
                    {type === 'pending' && (
                      <>
                        <div className="flex items-center gap-1.5 text-ink-soft dark:text-ink-muted">
                          <Calendar className="h-3.5 w-3.5 shrink-0 text-primary-500" />
                          <span>Dates: {fmtClassDay(p.fromDate)} → {fmtClassDay(p.toDate)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-ink-soft dark:text-ink-muted">
                          <Clock className="h-3.5 w-3.5 shrink-0 text-primary-500" />
                          <span>Requested: {timeAgo(p.createdAt)}</span>
                        </div>
                      </>
                    )}

                    {type === 'outside' && (
                      <>
                        <div className="flex items-center gap-1.5 text-ink-soft dark:text-ink-muted">
                          <LogOut className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                          <span>Left campus: <strong>{p.actualExit ? fmtStamp(p.actualExit) : '—'}</strong> ({timeAgo(p.actualExit)})</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-ink-soft dark:text-ink-muted">
                          <Calendar className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                          <span>Due back: <strong>{fmtClassDay(p.toDate)}</strong></span>
                        </div>
                      </>
                    )}

                    {type === 'exits' && (
                      <>
                        <div className="flex items-center gap-1.5 text-ink-soft dark:text-ink-muted">
                          <LogOut className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                          <span>Exited: <strong>{p.actualExit ? fmtStamp(p.actualExit) : '—'}</strong></span>
                        </div>
                        <div className="flex items-center gap-1.5 text-ink-soft dark:text-ink-muted">
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          <span>Gate Verifier: {p.exitVerifiedBy?.name || 'Security Guard'}</span>
                        </div>
                      </>
                    )}

                    {type === 'returns' && (
                      <>
                        <div className="flex items-center gap-1.5 text-ink-soft dark:text-ink-muted">
                          <LogIn className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          <span>Returned: <strong>{p.actualReturn ? fmtStamp(p.actualReturn) : '—'}</strong></span>
                        </div>
                        <div className="flex items-center gap-1.5 text-ink-soft dark:text-ink-muted">
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          <span>Gate Verifier: {p.returnVerifiedBy?.name || 'Security Guard'}</span>
                        </div>
                      </>
                    )}

                    {/* Destination and Reason */}
                    {p.destination?.area && (
                      <div className="flex items-center gap-1.5 text-ink-soft dark:text-ink-muted sm:col-span-2">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                        <span className="truncate">Destination: {[p.destination.area, p.destination.district, p.destination.state].filter(Boolean).join(', ')}</span>
                      </div>
                    )}
                    {p.description && (
                      <div className="text-ink-soft dark:text-ink-muted sm:col-span-2">
                        <span className="font-semibold text-ink dark:text-primary-100">{GATE_PASS_REGARDING[p.regarding] || titleCase(p.regarding || 'Pass')}: </span>
                        <span>{p.description}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

