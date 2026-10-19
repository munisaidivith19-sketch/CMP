import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Search, Sparkles, Trophy } from 'lucide-react';
import { Backdrop } from '../../components/layout/AppLayout';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs } from '../../components/ui/primitives';
import { Input, Select } from '../../components/ui/form';
import { useGetSwConfigQuery, useGetSwGalleryQuery, useGetSwLeaderboardQuery, useGetSwPublicGalleryQuery, useGetSwPublicLeaderboardQuery } from '../../services/skillWallet';
import { DEPARTMENTS } from '../../utils/constants';
import { GalleryCard } from './components';

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'trending', label: 'Trending (likes, last 14 days)' },
  { value: 'rating', label: 'Faculty rating' },
  { value: 'popular', label: 'Popularity' },
];

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Leaderboard({ publicMode, detailBase }) {
  const [board, setBoard] = useState('faculty');
  const signed = useGetSwLeaderboardQuery(board, { skip: publicMode });
  const pub = useGetSwPublicLeaderboardQuery(board, { skip: !publicMode });
  const { data, isLoading, error } = publicMode ? pub : signed;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="section-title flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" /> Leaderboard</p>
        <Tabs value={board} onChange={setBoard} tabs={[{ value: 'faculty', label: 'Faculty evaluation' }, { value: 'popular', label: 'Community' }]} />
      </div>
      {data?.criteria && (
        <p className="mb-3 rounded-2xl bg-primary-500/5 px-3 py-2 text-xs">
          <b>{data.criteria.label}:</b> {data.criteria.formula}. {data.criteria.note}
        </p>
      )}
      {isLoading ? <Skeleton className="h-40" /> : error ? <ErrorState error={error} /> : !data.items.length ? (
        <p className="text-sm muted">No ranked projects yet.</p>
      ) : (
        <ol className="space-y-2">
          {data.items.map((r) => (
            <li key={r.project._id} className="flex items-center gap-3 text-sm">
              <span className="w-6 text-right font-extrabold text-primary-600">{r.rank}</span>
              <Link to={`${detailBase}/${r.project._id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">{r.project.title}</Link>
              <Badge color={board === 'faculty' ? 'success' : 'neutral'}>{r.score}</Badge>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/**
 * Innovation Gallery. Signed-in college users see college-only and public
 * projects; internet visitors (publicMode, /gallery) see public ones only.
 * The server decides — this component only renders what it returns.
 */
export function GalleryBrowser({ publicMode = false }) {
  const [filters, setFilters] = useState({ q: '', domain: '', department: '', year: '', stage: '', sort: 'newest' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q);
  const params = { ...filters, q, page };
  Object.keys(params).forEach((k) => params[k] === '' && delete params[k]);
  const signed = useGetSwGalleryQuery(params, { skip: publicMode });
  const pub = useGetSwPublicGalleryQuery(params, { skip: !publicMode });
  const { data, isLoading, isFetching, error, refetch } = publicMode ? pub : signed;
  const { data: config } = useGetSwConfigQuery(undefined, { skip: publicMode });
  const set = (k) => (e) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };
  const detailBase = publicMode ? '/gallery' : '/skill-wallet/gallery';

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input className="sm:col-span-2 lg:col-span-3" icon={Search} aria-label="Search projects" placeholder="Search title, description, domain or skills" value={filters.q} onChange={set('q')} maxLength={64} />
          {!publicMode && <Select aria-label="Domain" placeholder="All domains" keepCase options={(config?.domains || []).map((d) => ({ value: d.key, label: d.label }))} value={filters.domain} onChange={set('domain')} />}
          <Select aria-label="Department" placeholder="All departments" keepCase options={DEPARTMENTS} value={filters.department} onChange={set('department')} />
          {!publicMode && <Select aria-label="Academic year" placeholder="All years" options={[1, 2, 3, 4].map((y) => ({ value: String(y), label: `Year ${y}` }))} value={filters.year} onChange={set('year')} />}
          <Select aria-label="Project stage" placeholder="Any stage" options={[{ value: 'developing', label: 'Developing' }, { value: 'implemented', label: 'Implemented' }]} value={filters.stage} onChange={set('stage')} />
          <Select aria-label="Sort by" keepCase options={SORTS} value={filters.sort} onChange={set('sort')} />
        </Card>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-72" />)}</div>
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !data.items.length ? (
          <Card><EmptyState icon={Sparkles} title="No projects found" text="Try other filters. Projects appear here only after their teams publish them." /></Card>
        ) : (
          <>
            <div className={`grid gap-4 sm:grid-cols-2 ${isFetching ? 'opacity-70' : ''}`} aria-busy={isFetching}>
              {data.items.map((p) => <GalleryCard key={p._id} p={p} to={`${detailBase}/${p._id}`} />)}
            </div>
            <Pagination page={data.page} pages={data.pages} onChange={setPage} />
          </>
        )}
      </div>
      <div className="space-y-4">
        <Leaderboard publicMode={publicMode} detailBase={detailBase} />
        <Card className="text-xs muted">
          Popularity (likes and comments) and faculty evaluation are separate. Popularity is not a measure of technical merit.
        </Card>
      </div>
    </div>
  );
}

export default function Gallery() {
  return (
    <div>
      <PageHeader title="Innovation Gallery" subtitle="Student projects their teams chose to publish" icon={Sparkles} />
      <GalleryBrowser />
    </div>
  );
}

/** Public shell for internet visitors (no sign-in). */
export function PublicShell({ children }) {
  const user = useSelector((s) => s.auth.user);
  return (
    <div className="min-h-screen px-4 py-6 sm:px-8">
      <Backdrop />
      <header className="mx-auto mb-6 flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <Link to="/gallery" className="flex items-center gap-2">
          <img src="/logo.jpeg" alt="" className="h-9 w-9 rounded-xl object-cover" />
          <span className="text-lg font-extrabold tracking-tight">Innovation Gallery</span>
        </Link>
        <Link to={user ? '/skill-wallet/gallery' : '/login'} className="btn btn-outline">{user ? 'Open in VEXON' : 'College sign in'}</Link>
      </header>
      <main className="mx-auto max-w-7xl">{children}</main>
    </div>
  );
}

export function PublicGallery() {
  return (
    <PublicShell>
      <p className="mb-5 text-sm muted">Public student projects. College members see more after signing in.</p>
      <GalleryBrowser publicMode />
    </PublicShell>
  );
}
