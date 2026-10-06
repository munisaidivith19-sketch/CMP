import { useEffect, useState } from 'react';
import { BedDouble, DoorOpen, Home, Phone, Search, Users } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Avatar, Card, EmptyState, ErrorState, PageHeader, Spinner, cn } from '../../components/ui/primitives';
import { useGetHostelStudentsQuery, useGetHostelSummaryQuery } from '../../services/api';
import { YEAR_LABELS } from '../../utils/constants';
import { displayName, fmtDateTime } from '../../utils/format';

const GROUPS = [
  { key: 'all', label: 'Hostellers', gender: undefined },
  { key: 'boys', label: 'Boys', gender: 'male' },
  { key: 'girls', label: 'Girls', gender: 'female' },
];

const KINDS = [
  { status: 'all', title: (g) => (g.key === 'all' ? 'Total Hostellers' : `Total ${g.label} Hostellers`), icon: Users, tone: 'from-primary-400 to-primary-600' },
  { status: 'inside', title: (g) => (g.key === 'all' ? 'Inside Campus' : `${g.label} Inside`), icon: Home, tone: 'from-emerald-400 to-emerald-600' },
  { status: 'outside', title: (g) => (g.key === 'all' ? 'Hostellers Outside' : `${g.label} Outside`), icon: DoorOpen, tone: 'from-amber-400 to-orange-500' },
];

const countOf = (data, group, status) => {
  const bucket = group.key === 'all' ? data : data?.[group.key];
  if (!bucket) return '—';
  return status === 'all' ? bucket.total : bucket[status];
};

const classLine = (s) => [s.rollNo, s.department, YEAR_LABELS[s.year] || (s.year ? `Year ${s.year}` : ''), s.section && `Sec ${s.section}`].filter(Boolean).join(' · ');

/** Waits until typing pauses before searching. */
function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function StudentsModal({ open, onClose, group, kind }) {
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const { data, isFetching, error, refetch } = useGetHostelStudentsQuery(
    { status: kind?.status, gender: group?.gender, q: search || undefined },
    { skip: !open }
  );
  const outside = kind?.status === 'outside';
  const students = data?.students || [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={kind && group ? kind.title(group) : ''}
      subtitle={data ? `${data.total} student${data.total === 1 ? '' : 's'}${students.length < data.total ? ` · showing ${students.length}` : ''}` : ' '}
    >
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input
          className="input w-full pl-9"
          placeholder="Search by name or roll number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search hostellers"
          autoFocus
        />
      </div>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isFetching && !data ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !students.length ? (
        <EmptyState icon={BedDouble} title={search ? 'No match' : 'No students'} text={search ? `Nobody matches “${search}”.` : 'There is no one in this list right now.'} />
      ) : outside ? (
        <div className={cn('space-y-2', isFetching && 'opacity-60')}>
          {students.map((s) => (
            <div key={s._id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-3">
                <Avatar user={s} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-sm">{displayName(s)}</p>
                  <p className="truncate text-xs text-ink-muted">{classLine(s)}</p>
                </div>
                {s.phone && (
                  <a href={`tel:${s.phone}`} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary-500 hover:underline">
                    <Phone className="h-3.5 w-3.5" />
                    {s.phone}
                  </a>
                )}
              </div>
              <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                <p>
                  <span className="text-ink-muted">Left campus: </span>
                  <span className="font-semibold">{fmtDateTime(s.leftAt) || '—'}</span>
                </p>
                <p>
                  <span className="text-ink-muted">Return date: </span>
                  <span className="font-semibold">{fmtDateTime(s.returnBy) || '—'}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className={cn('divide-y divide-white/10', isFetching && 'opacity-60')}>
          {students.map((s) => (
            <li key={s._id} className="flex items-center gap-3 py-2.5">
              <Avatar user={s} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-sm">{displayName(s)}</p>
                <p className="truncate text-xs text-ink-muted">{classLine(s)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export default function Hostel() {
  const { data, isLoading, error, refetch } = useGetHostelSummaryQuery(undefined, { pollingInterval: 60000 });
  const [open, setOpen] = useState(null); // { group, kind }

  return (
    <div className="space-y-6">
      <PageHeader icon={BedDouble} title="Hostel" subtitle="Hostellers on campus and who is outside right now" />

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        GROUPS.map((group) => (
          <section key={group.key} className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink-muted">{group.key === 'all' ? 'All Hostellers' : `${group.label} Hostel`}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {KINDS.map((kind) => {
                const Icon = kind.icon;
                return (
                  <Card
                    key={kind.status}
                    as="button"
                    type="button"
                    hover
                    onClick={() => setOpen({ group, kind })}
                    className="flex w-full items-center gap-4 p-4 text-left"
                  >
                    <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white', kind.tone)}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-ink-muted">{kind.title(group)}</span>
                      <span className="block text-2xl font-extrabold">{isLoading ? '…' : countOf(data, group, kind.status)}</span>
                    </span>
                  </Card>
                );
              })}
            </div>
          </section>
        ))
      )}

      <StudentsModal open={Boolean(open)} onClose={() => setOpen(null)} group={open?.group} kind={open?.kind} />
    </div>
  );
}
