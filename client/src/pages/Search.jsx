import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, GraduationCap, Megaphone, MessagesSquare, Search as SearchIcon, Shapes } from 'lucide-react';
import { useSearchQuery } from '../services/api';
import { Avatar, Badge, Card, CardHeader, CategoryBadge, EmptyState, PageHeader, PageLoader } from '../components/ui/primitives';
import { ROLE_LABELS } from '../utils/constants';
import { friendlyDay, timeAgo } from '../utils/format';

function Section({ icon: Icon, title, items, render }) {
  if (!items?.length) return null;
  return (
    <Card>
      <CardHeader title={title} action={<Icon className="h-5 w-5 text-primary-400" />} />
      <div className="-mx-2 space-y-1">{items.map(render)}</div>
    </Card>
  );
}

const row = 'flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-white/70 dark:hover:bg-white/5';

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { data, isFetching } = useSearchQuery({ q }, { skip: q.length < 2 });
  const total = data ? data.users.length + data.clubs.length + data.events.length + data.announcements.length + data.discussions.length : 0;

  return (
    <div>
      <PageHeader icon={SearchIcon} title={`Results for “${q}”`} subtitle={data ? `${total} matches across CampusConnect` : 'Searching…'} />
      {isFetching && !data ? (
        <PageLoader />
      ) : !total ? (
        <Card>
          <EmptyState icon={SearchIcon} title="No results" text="Try a different keyword or check the spelling." />
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Section
            icon={CalendarDays}
            title="Events"
            items={data.events}
            render={(e) => (
              <Link key={e._id} to={`/events/${e._id}`} className={row}>
                <CategoryBadge category={e.category} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{e.title}</p>
                  <p className="text-[11px] muted">
                    {friendlyDay(e.startDate)} · {e.venue}
                  </p>
                </div>
              </Link>
            )}
          />
          <Section
            icon={Shapes}
            title="Clubs"
            items={data.clubs}
            render={(c) => (
              <Link key={c._id} to={`/clubs/${c.slug}`} className={row}>
                <Avatar name={c.name} src={c.logo} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{c.name}</p>
                  <p className="text-[11px] muted">{c.memberCount} members</p>
                </div>
              </Link>
            )}
          />
          <Section
            icon={GraduationCap}
            title="People"
            items={data.users}
            render={(u) => (
              <Link key={u._id} to={`/people/${u._id}`} className={row}>
                <Avatar user={u} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{u.name}</p>
                  <p className="text-[11px] muted">
                    {ROLE_LABELS[u.role]} · {u.department}
                  </p>
                </div>
              </Link>
            )}
          />
          <Section
            icon={Megaphone}
            title="Announcements"
            items={data.announcements}
            render={(a) => (
              <Link key={a._id} to="/announcements" className={row}>
                <Badge color={a.priority === 'urgent' ? 'danger' : a.priority === 'important' ? 'warning' : 'info'}>{a.priority}</Badge>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{a.title}</p>
                  <p className="truncate text-[11px] muted">{a.content}</p>
                </div>
              </Link>
            )}
          />
          <Section
            icon={MessagesSquare}
            title="Discussions"
            items={data.discussions}
            render={(d) => (
              <Link key={d._id} to={`/discussions/${d._id}`} className={row}>
                <Badge color="neutral">{d.category}</Badge>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{d.title}</p>
                  <p className="text-[11px] muted">
                    {d.replyCount} replies · {timeAgo(d.createdAt)}
                  </p>
                </div>
              </Link>
            )}
          />
        </div>
      )}
    </div>
  );
}
