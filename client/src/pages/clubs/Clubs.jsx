import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Shapes } from 'lucide-react';
import { useGetClubsQuery } from '../../services/api';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs, cn } from '../../components/ui/primitives';
import { ClubCard } from '../../components/domain';
import ClubForm from './ClubForm';
import { CLUB_CATEGORIES } from '../../utils/constants';

export default function Clubs() {
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const mine = params.get('mine') === 'true';

  const { data, isFetching, error, refetch } = useGetClubsQuery({
    category: category || undefined,
    q: q || undefined,
    mine: mine ? 'true' : undefined,
    page,
    limit: 12,
  });

  return (
    <div>
      <PageHeader
        icon={Shapes}
        title="Clubs"
        subtitle="Find your people — join clubs, meet members, stay in the loop."
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            New club
          </Button>
        }
      />

      <Card className="mb-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Tabs
            value={mine ? 'mine' : 'all'}
            onChange={(v) => {
              setParams(v === 'mine' ? { mine: 'true' } : {});
              setPage(1);
            }}
            tabs={[
              { value: 'all', label: 'All clubs' },
              { value: 'mine', label: 'My clubs' },
            ]}
          />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search clubs by name or tag…"
              className="input pl-11"
            />
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button onClick={() => setCategory('')} className={cn('chip', !category && 'chip-active')}>
            All
          </button>
          {CLUB_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => {
                setCategory(c);
                setPage(1);
              }}
              className={cn('chip capitalize', category === c && 'chip-active')}
            >
              {c.replace('-', ' ')}
            </button>
          ))}
        </div>
      </Card>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isFetching && !data ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-60 rounded-[28px]" />
          ))}
        </div>
      ) : data?.items?.length ? (
        <>
          <div className={cn('grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4', isFetching && 'opacity-60')}>
            {data.items.map((c, i) => (
              <ClubCard key={c._id} club={c} delay={i * 40} />
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={Shapes}
            title={mine ? 'You haven’t joined any clubs yet' : 'No clubs found'}
            text={mine ? 'Browse all clubs and send a join request.' : 'Try another category or search term.'}
          />
        </Card>
      )}

      <ClubForm open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
