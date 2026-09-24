import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Search } from 'lucide-react';
import { useGetUsersQuery } from '../../services/api';
import { Avatar, Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, cn } from '../../components/ui/primitives';
import { DEPARTMENTS, ROLE_LABELS } from '../../utils/constants';

export default function People() {
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const { data, isFetching, error, refetch } = useGetUsersQuery({
    q: q || undefined,
    department: department || undefined,
    role: role || undefined,
    page,
  });
  const reset = (fn) => (e) => {
    fn(e.target.value);
    setPage(1);
  };

  return (
    <div>
      <PageHeader icon={GraduationCap} title="People" subtitle="Find students and faculty by name, department or skill." />

      <Card className="mb-6 grid gap-3 md:grid-cols-[1fr_220px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={reset(setQ)} placeholder="Search by name, skill or interest…" className="input pl-11" />
        </div>
        <select value={department} onChange={reset(setDepartment)} className="input">
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select value={role} onChange={reset(setRole)} className="input">
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Card>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isFetching && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-[28px]" />
          ))}
        </div>
      ) : data?.items?.length ? (
        <>
          <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', isFetching && 'opacity-60')}>
            {data.items.map((u, i) => (
              <Link key={u._id} to={`/people/${u._id}`} className="animate-fade-up" style={{ animationDelay: `${i * 25}ms` }}>
                <Card hover className="flex h-full gap-4">
                  <Avatar user={u} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-bold">{u.name}</p>
                      {u.role !== 'student' && <Badge color={u.role === 'faculty' ? 'info' : 'primary'}>{ROLE_LABELS[u.role]}</Badge>}
                    </div>
                    <p className="truncate text-xs muted">
                      {u.designation || u.department} {u.year ? `· Year ${u.year}` : ''}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(u.skills || []).slice(0, 4).map((s) => (
                        <span key={s} className="rounded-full bg-primary-500/10 px-2 py-0.5 text-[11px] font-semibold text-primary-600 dark:text-primary-300">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState icon={GraduationCap} title="No people found" />
        </Card>
      )}
    </div>
  );
}
