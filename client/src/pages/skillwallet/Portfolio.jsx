import { Link, useParams } from 'react-router-dom';
import { Award, FolderKanban, Link2, Trophy } from 'lucide-react';
import { Avatar, Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/primitives';
import { useGetSwPortfolioQuery } from '../../services/skillWallet';
import { fmtClassDay, titleCase } from '../../utils/format';
import { GalleryCard, SafeExternalLink, StatusBadge } from './components';

/**
 * Portfolio. Self view (a Skill Wallet tab): everything of mine with its
 * status. Another student's portfolio (route /skill-wallet/portfolio/:userId):
 * only what the server allows — published projects, VERIFIED certificates,
 * college / public links. Hall tickets never appear here.
 */
export function PortfolioView({ userId }) {
  const { data, isLoading, error, refetch } = useGetSwPortfolioQuery(userId || 'me');
  if (isLoading) return <Skeleton className="h-64" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const { self, student, projects, certifications, links, achievements, skills } = data;
  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-4">
        <Avatar user={student} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-xl font-extrabold">{student.name}</p>
          <p className="text-sm muted">{student.department}{student.year ? ` · Year ${student.year}` : ''}</p>
          {student.bio && <p className="mt-1 text-sm">{student.bio}</p>}
        </div>
        {self && <p className="w-full text-xs muted sm:w-auto">Others see only published projects, verified certificates and links you made visible.</p>}
      </Card>
      {skills?.length > 0 && (
        <Card>
          <CardHeader title="Skills" subtitle={self ? 'From your projects' : 'From published projects'} />
          <div className="flex flex-wrap gap-1.5">{skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>
        </Card>
      )}
      <Card>
        <CardHeader title="Projects" />
        {!projects.length ? (
          <EmptyState icon={FolderKanban} title="No projects to show" />
        ) : self ? (
          <ul className="divide-y divide-white/50 dark:divide-white/10">
            {projects.map((p) => (
              <li key={p._id} className="flex flex-wrap items-center gap-2 py-3">
                <Link to={`/skill-wallet/projects/${p._id}`} className="min-w-0 flex-1 font-semibold hover:underline">{p.title}</Link>
                <span className="text-xs muted">{p.domain?.label}</span>
                <StatusBadge kind="review" status={p.reviewStatus} />
                <Badge color="neutral">{titleCase(p.visibility)}</Badge>
                {p.facultyScore != null && <Badge color="success">Score {p.facultyScore}</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">{projects.map((p) => <GalleryCard key={p._id} p={p} to={`/skill-wallet/gallery/${p._id}`} />)}</div>
        )}
      </Card>
      <Card>
        <CardHeader title="NPTEL certifications" subtitle={self ? undefined : 'Verified by college staff'} />
        {!certifications.length ? (
          <EmptyState icon={Award} title="No certificates to show" />
        ) : (
          <ul className="divide-y divide-white/50 dark:divide-white/10">
            {certifications.map((c) => (
              <li key={c._id} className="flex flex-wrap items-center gap-2 py-3">
                <span className="min-w-0 flex-1 font-semibold">{c.courseName}</span>
                <span className="text-xs muted">{c.institution} · {c.durationWeeks} wk · {c.credits} cr · {fmtClassDay(c.endDate)}</span>
                <StatusBadge kind="cert" status={c.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Links & profiles" subtitle="Self-reported — not verified by VEXON" />
        {!links.length ? (
          <EmptyState icon={Link2} title="No links to show" />
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l._id} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{l.displayName}:</span>
                <SafeExternalLink href={l.url} className="break-all">{l.url}</SafeExternalLink>
                {self && <Badge color="neutral">{titleCase(l.visibility)}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {achievements?.length > 0 && (
        <Card>
          <CardHeader title="Achievements" subtitle="From VEXON Achievements" />
          <ul className="space-y-2">
            {achievements.map((a) => (
              <li key={a._id} className="flex flex-wrap items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" aria-hidden="true" />
                <Link to={`/achievements/${a._id}`} className="font-semibold hover:underline">{a.title}</Link>
                <span className="text-xs muted">{titleCase(a.level || '')} {a.position ? `· ${a.position}` : ''}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function PortfolioPage() {
  const { userId } = useParams();
  return (
    <div>
      <PageHeader title="Student portfolio" icon={FolderKanban} />
      <PortfolioView userId={userId} />
    </div>
  );
}
