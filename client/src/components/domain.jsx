import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { CalendarDays, CheckCircle2, Clock, Flag, MapPin, Pin, Star, Users } from 'lucide-react';
import { Avatar, Badge, Button, Card, CategoryBadge, ProgressBar, cn } from './ui/primitives';
import { Modal } from './ui/Modal';
import { Select, Textarea } from './ui/form';
import { useCancelRegistrationMutation, useCreateReportMutation, useRegisterEventMutation } from '../services/api';
import { catStyle, REPORT_REASONS } from '../utils/constants';
import { errMsg, friendlyDay, fmtTime, timeAgo } from '../utils/format';

/* ── Event registration button ──────────────────────────────────── */
export function RegisterButton({ event, size = 'md', className }) {
  const [register, { isLoading: registering }] = useRegisterEventMutation();
  const [cancel, { isLoading: cancelling }] = useCancelRegistrationMutation();
  const isPast = event.isPast ?? new Date(event.endDate) < new Date();

  if (isPast) return <Badge color="neutral">Ended</Badge>;

  if (event.myStatus) {
    return (
      <Button
        size={size}
        variant={event.myStatus === 'waitlisted' ? 'soft' : 'success'}
        loading={cancelling}
        className={className}
        icon={event.myStatus === 'waitlisted' ? Clock : CheckCircle2}
        onClick={async (e) => {
          e.preventDefault();
          try {
            await cancel(event._id).unwrap();
            toast.success('Registration cancelled');
          } catch (err) {
            toast.error(errMsg(err));
          }
        }}
        title="Click to cancel"
      >
        {event.myStatus === 'waitlisted' ? 'Waitlisted' : event.myStatus === 'attended' ? 'Attended' : 'Registered'}
      </Button>
    );
  }

  const full = event.capacity > 0 && event.spotsLeft === 0;
  return (
    <Button
      size={size}
      variant={full ? 'outline' : 'primary'}
      loading={registering}
      className={className}
      onClick={async (e) => {
        e.preventDefault();
        try {
          const res = await register(event._id).unwrap();
          toast.success(res.status === 'waitlisted' ? 'Event is full — you are on the waitlist' : 'You are registered! 🎉');
        } catch (err) {
          toast.error(errMsg(err));
        }
      }}
    >
      {full ? 'Join waitlist' : 'Register'}
    </Button>
  );
}

/* ── Event card ─────────────────────────────────────────────────── */
export function EventCard({ event, delay = 0 }) {
  const style = catStyle(event.category);
  const start = new Date(event.startDate);
  return (
    <Link to={`/events/${event._id}`} className="group block animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <Card hover className="flex h-full flex-col overflow-hidden p-0">
        <div className={cn('relative h-40 overflow-hidden bg-gradient-to-br', style.grad)}>
          {event.poster ? (
            <img src={event.poster} alt="" className="h-full w-full object-cover transition-transform duration-700 ease-smooth group-hover:scale-105" />
          ) : (
            <div className="absolute inset-0 opacity-30 [background:radial-gradient(circle_at_20%_20%,white_0,transparent_40%),radial-gradient(circle_at_80%_70%,white_0,transparent_35%)]" />
          )}
          <div className="glass-strong absolute left-3 top-3 flex h-14 w-14 flex-col items-center justify-center rounded-2xl text-center">
            <span className="text-[10px] font-bold uppercase text-primary-600 dark:text-primary-300">{format(start, 'MMM')}</span>
            <span className="text-xl font-extrabold leading-none">{format(start, 'dd')}</span>
          </div>
          {event.isFeatured && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-amber-600 shadow">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Featured
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-5">
          <div className="mb-2 flex items-center gap-2">
            <CategoryBadge category={event.category} />
            {event.club?.name && <span className="truncate text-xs font-semibold muted">{event.club.name}</span>}
          </div>
          <h3 className="line-clamp-2 text-[15px] font-bold leading-snug transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-300">
            {event.title}
          </h3>
          <div className="mt-3 space-y-1.5 text-xs muted">
            <p className="flex items-center gap-2">
              <CalendarDays className="h-3.5 w-3.5" /> {friendlyDay(event.startDate)} · {fmtTime(event.startDate)}
            </p>
            <p className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5" /> <span className="truncate">{event.venue}</span>
            </p>
          </div>
          <div className="mt-auto pt-4">
            {event.capacity > 0 ? (
              <>
                <div className="mb-1.5 flex justify-between text-[11px] font-semibold muted">
                  <span>
                    {event.registeredCount}/{event.capacity} registered
                  </span>
                  <span>{event.spotsLeft === 0 ? 'Full' : `${event.spotsLeft} left`}</span>
                </div>
                <ProgressBar value={event.registeredCount} max={event.capacity} />
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-[11px] font-semibold muted">
                <Users className="h-3.5 w-3.5" /> {event.registeredCount} going · open entry
              </p>
            )}
            <div className="mt-4 flex justify-end">
              <RegisterButton event={event} size="sm" />
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

/* ── Club card ──────────────────────────────────────────────────── */
export function ClubCard({ club, delay = 0 }) {
  const style = catStyle(club.category);
  return (
    <Link to={`/clubs/${club.slug}`} className="group block animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <Card hover className="h-full overflow-hidden p-0">
        <div className={cn('relative h-24 bg-gradient-to-br', style.grad)}>
          {club.coverImage && <img src={club.coverImage} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="relative px-5 pb-5">
          <Avatar name={club.name} src={club.logo} size="lg" ring className="-mt-8" />
          <div className="mt-3 flex items-center gap-2">
            <h3 className="truncate font-bold transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-300">{club.name}</h3>
          </div>
          {club.tagline && <p className="mt-0.5 line-clamp-1 text-xs muted">{club.tagline}</p>}
          <div className="mt-4 flex items-center justify-between">
            <CategoryBadge category={club.category} />
            <span className="flex items-center gap-1 text-xs font-semibold muted">
              <Users className="h-3.5 w-3.5" /> {club.memberCount} members
            </span>
          </div>
          {(club.isMember || club.hasRequested) && (
            <div className="mt-3">
              {club.isMember ? <Badge color="success">Member</Badge> : <Badge color="warning">Request pending</Badge>}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

/* ── Announcement item ──────────────────────────────────────────── */
const PRIORITY = {
  urgent: { color: 'danger', bar: 'from-rose-400 to-pink-500' },
  important: { color: 'warning', bar: 'from-amber-400 to-orange-500' },
  normal: { color: 'info', bar: 'from-sky-400 to-primary-500' },
};

export function AnnouncementItem({ a, compact, actions }) {
  const p = PRIORITY[a.priority] || PRIORITY.normal;
  const scopeLabel =
    a.audience?.scope === 'club'
      ? a.audience.club?.name
      : a.audience?.scope === 'department'
        ? a.audience.department
        : a.audience?.scope === 'year'
          ? `Year ${a.audience.year}`
          : 'Everyone';
  return (
    <div className="relative flex gap-4 overflow-hidden rounded-3xl bg-white/50 p-4 transition-all duration-300 hover:bg-white/80 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]">
      <span className={cn('absolute inset-y-3 left-0 w-1 rounded-r-full bg-gradient-to-b', p.bar)} />
      <div className="min-w-0 flex-1 pl-1">
        <div className="flex flex-wrap items-center gap-2">
          {a.isPinned && <Pin className="h-3.5 w-3.5 fill-primary-500 text-primary-500" />}
          <Badge color={p.color}>{a.priority}</Badge>
          <span className="text-[11px] font-semibold muted">{scopeLabel}</span>
          <span className="text-[11px] text-ink-muted">· {timeAgo(a.createdAt)}</span>
        </div>
        <h4 className="mt-1.5 font-bold leading-snug">{a.title}</h4>
        <p className={cn('mt-1 whitespace-pre-line text-sm muted', compact && 'line-clamp-2')}>{a.content}</p>
        {!compact && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold">
              <Avatar user={a.author} size="xs" /> {a.author?.name}
            </span>
            {a.deadline && (
              <Badge color="danger" icon={Clock}>
                Due {format(new Date(a.deadline), 'dd MMM, h:mm a')}
              </Badge>
            )}
            {a.attachments?.map((f) => (
              <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" className="chip">
                📎 {f.name || 'Attachment'}
              </a>
            ))}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-start gap-1">{actions}</div>}
    </div>
  );
}

/* ── Report dialog ──────────────────────────────────────────────── */
export function ReportButton({ targetType, targetId, replyId, className, label = 'Report' }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [report, { isLoading }] = useCreateReportMutation();

  const submit = async () => {
    try {
      const res = await report({ targetType, targetId, replyId, reason, details }).unwrap();
      toast.success(res.message);
      setOpen(false);
      setDetails('');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        className={cn('inline-flex items-center gap-1 text-xs font-semibold text-ink-muted transition-colors hover:text-rose-500', className)}
      >
        <Flag className="h-3.5 w-3.5" /> {label}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report content"
        subtitle="Moderators review every report. False reports may lead to action on your account."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={isLoading} onClick={submit}>
              Submit report
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={REPORT_REASONS} />
          <Textarea label="Details (optional)" value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} rows={3} />
        </div>
      </Modal>
    </>
  );
}
