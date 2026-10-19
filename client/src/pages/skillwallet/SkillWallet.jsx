import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderKanban, Plus, Sparkles, Wallet } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs } from '../../components/ui/primitives';
import { useGetMyProjectsQuery, useGetSwInvitationsQuery } from '../../services/skillWallet';
import ProjectForm from './ProjectForm';
import Certifications from './Certifications';
import Links from './Links';
import Invitations from './Invitations';
import { PortfolioView } from './Portfolio';
import { MyProjectCard } from './components';

const TABS = ['projects', 'certifications', 'links', 'invitations', 'portfolio'];

function MyProjects() {
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useGetMyProjectsQuery({ page });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm muted">Projects you own or joined. Every new project is private until you publish it.</p>
        <Button icon={Plus} onClick={() => setCreating(true)}>New project</Button>
      </div>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.items.length ? (
        <Card><EmptyState icon={FolderKanban} title="No projects yet" text="Add your first project — solo or with a team." action={<Button icon={Plus} onClick={() => setCreating(true)}>New project</Button>} /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.items.map((p) => <MyProjectCard key={p._id} p={p} />)}</div>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      )}
      {creating && <ProjectForm open onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Student Skill Wallet: projects, NPTEL, links, invitations, portfolio (tab in ?tab=). */
export default function SkillWallet() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'projects';
  const { data: inv } = useGetSwInvitationsQuery({ box: 'received', status: 'pending' });
  const setTab = (t) => setParams(t === 'projects' ? {} : { tab: t }, { replace: true });
  return (
    <div>
      <PageHeader
        title="My Skill Wallet"
        subtitle="Projects, NPTEL certifications, profiles and your portfolio in one place"
        icon={Wallet}
        actions={<Button variant="soft" icon={Sparkles} to="/skill-wallet/gallery">Innovation Gallery</Button>}
      />
      <Tabs
        className="mb-5 max-w-full"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'projects', label: 'My Projects' },
          { value: 'certifications', label: 'NPTEL Certifications' },
          { value: 'links', label: 'Links & Profiles' },
          { value: 'invitations', label: 'Team Invitations', count: inv?.pendingCount || undefined },
          { value: 'portfolio', label: 'My Portfolio' },
        ]}
      />
      {tab === 'projects' && <MyProjects />}
      {tab === 'certifications' && <Certifications />}
      {tab === 'links' && <Links />}
      {tab === 'invitations' && <Invitations />}
      {tab === 'portfolio' && <PortfolioView />}
    </div>
  );
}
