import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Search, ShieldCheck } from 'lucide-react';
import { useGetPeopleFiltersQuery, useGetUsersQuery } from '../../services/api';
import { Avatar, Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, cn } from '../../components/ui/primitives';
import { ACADEMIC_YEARS, ROLE_LABELS, YEAR_LABELS } from '../../utils/constants';

/**
 * The People directory.
 *
 * Which filters appear is decided by the server (`/users/people-filters`) from
 * the signed-in account: a faculty member gets search only, because their
 * scope is their teaching assignment; an HOD gets year, section and role
 * inside their own department, with no department selector. The filters are a
 * convenience, never the security boundary — every query is scoped again on
 * the server, so an out-of-scope value simply returns nothing.
 */
export default function People() {
  const { data: config, isLoading: loadingConfig } = useGetPeopleFiltersQuery();
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState('');
  const [year, setYear] = useState('');
  const [section, setSection] = useState('');
  const [page, setPage] = useState(1);

  const can = useMemo(() => new Set(config?.filters || ['search']), [config]);
  const { data, isFetching, error, refetch } = useGetUsersQuery({
    q: q || undefined,
    department: can.has('department') ? department || undefined : undefined,
    role: can.has('role') ? role || undefined : undefined,
    year: can.has('year') ? year || undefined : undefined,
    section: can.has('section') ? section || undefined : undefined,
    page,
  });

  const reset = (fn) => (e) => {
    fn(e.target.value);
    setPage(1);
  };

  // The filter row wraps rather than using a fixed grid, so one filter (faculty)
  // or four (HOD) both lay out, down to a 320 px screen, without side-scrolling.
  const selectClass = 'input w-full sm:w-auto sm:min-w-[9.5rem]';

  return (
    <div>
      <PageHeader
        icon={GraduationCap}
        title="People"
        subtitle={
          config?.scope === 'assignment'
            ? 'The students of the classes you teach.'
            : config?.scope === 'department'
              ? `${config.department} — students and faculty of your department.`
              : 'Find students and faculty by name, department or skill.'
        }
      />

      {loadingConfig ? (
        <Skeleton className="mb-6 h-[74px] rounded-[28px]" />
      ) : (
        <Card className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:min-w-[14rem] sm:flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input value={q} onChange={reset(setQ)} placeholder="Search by name, skill or interest…" className="input pl-11" />
          </div>

          {can.has('department') && (
            <select aria-label="Department" value={department} onChange={reset(setDepartment)} className={selectClass}>
              <option value="">All departments</option>
              {(config.departments || []).map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          )}

          {can.has('year') && (
            <select aria-label="Year" value={year} onChange={reset(setYear)} className={selectClass}>
              <option value="">All years</option>
              {(config.years?.length ? config.years : ACADEMIC_YEARS).map((y) => (
                <option key={y} value={y}>
                  {YEAR_LABELS[y] || `Year ${y}`}
                </option>
              ))}
            </select>
          )}

          {can.has('section') && (
            <select aria-label="Section" value={section} onChange={reset(setSection)} className={selectClass}>
              <option value="">All sections</option>
              {(config.sections || []).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}

          {can.has('role') && (
            <select aria-label="Role" value={role} onChange={reset(setRole)} className={selectClass}>
              <option value="">All roles</option>
              {(config.roles || Object.keys(ROLE_LABELS)).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] || r}
                </option>
              ))}
            </select>
          )}
        </Card>
      )}

      {config?.scope === 'assignment' && (
        <Card className="mb-6 flex items-center gap-3 !py-3 text-sm">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary-500" />
          <span className="muted">Your People list follows your teaching assignment — department, year, section and semester are set automatically.</span>
        </Card>
      )}

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
                      {u.section ? ` · Sec ${u.section}` : ''}
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
