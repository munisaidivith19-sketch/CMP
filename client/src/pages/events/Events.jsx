import { useState } from 'react';
import { useSelector } from 'react-redux';
import { CalendarDays, Plus, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useGetClubsQuery, useGetEventsQuery } from '../../services/api';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs, cn } from '../../components/ui/primitives';
import { EventCard } from '../../components/domain';
import EventForm from './EventForm';
import { selectUser } from '../../features/authSlice';
import { EVENT_CATEGORIES } from '../../utils/constants';

export default function Events() {
  const user = useSelector(selectUser);
  const [when, setWhen] = useState('upcoming');
  const [category, setCategory] = useState('');
  const [club, setClub] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [forYou, setForYou] = useState(false);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState(false);

  const params = {
    when: when === 'mine' ? 'all' : when,
    mine: when === 'mine' ? 'true' : undefined,
    category: category || undefined,
    club: club || undefined,
    from: from || undefined,
    to: to || undefined,
    q: q || undefined,
    forYou: forYou ? 'true' : undefined,
    page,
    limit: 12,
  };
  const { data, isFetching, error, refetch } = useGetEventsQuery(params);
  const { data: clubs } = useGetClubsQuery({ limit: 50 });
  const canCreate = ['admin', 'faculty', 'club_admin'].includes(user.role) || user.clubs?.length > 0;

  const set = (fn) => (v) => {
    fn(v);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        icon={CalendarDays}
        title="Events"
        subtitle="Workshops, fests, hackathons and more — register in one tap."
        actions={
          canCreate && (
            <Button icon={Plus} onClick={() => setCreating(true)}>
              Create event
            </Button>
          )
        }
      />

      <Card className="mb-6 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Tabs
            value={when}
            onChange={set(setWhen)}
            tabs={[
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'past', label: 'Past' },
              { value: 'mine', label: 'My events' },
            ]}
          />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input value={q} onChange={(e) => set(setQ)(e.target.value)} placeholder="Search events or venues…" className="input pl-11" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => set(setForYou)(!forYou)} className={cn('chip py-2.5', forYou && 'chip-active')}>
              <Sparkles className="h-3.5 w-3.5" /> For you
            </button>
            <button onClick={() => setShowFilters((s) => !s)} className={cn('chip py-2.5', showFilters && 'chip-active')}>
              <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
            </button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button onClick={() => set(setCategory)('')} className={cn('chip', !category && 'chip-active')}>
            All
          </button>
          {EVENT_CATEGORIES.map((c) => (
            <button key={c} onClick={() => set(setCategory)(c)} className={cn('chip capitalize', category === c && 'chip-active')}>
              {c}
            </button>
          ))}
        </div>

        {showFilters && (
          <div className="grid gap-3 border-t border-white/60 pt-4 sm:grid-cols-3 dark:border-white/10 animate-fade-up">
            <div>
              <label className="label">Club</label>
              <select value={club} onChange={(e) => set(setClub)(e.target.value)} className="input">
                <option value="">All clubs</option>
                {clubs?.items?.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">From</label>
              <input type="date" value={from} onChange={(e) => set(setFrom)(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" value={to} onChange={(e) => set(setTo)(e.target.value)} className="input" />
            </div>
          </div>
        )}
      </Card>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isFetching && !data ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[380px] rounded-[28px]" />
          ))}
        </div>
      ) : data?.items?.length ? (
        <>
          <div className={cn('grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 transition-opacity', isFetching && 'opacity-60')}>
            {data.items.map((e, i) => (
              <EventCard key={e._id} event={e} delay={i * 40} />
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="No events found"
            text={forYou ? 'Nothing matches your interests right now — try turning off “For you”.' : 'Try a different filter or check back soon.'}
          />
        </Card>
      )}

      <EventForm open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
