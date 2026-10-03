import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  GraduationCap,
  Briefcase,
  Calendar,
  Compass,
  Sparkles,
  User,
  ShieldCheck,
  FileSpreadsheet,
  BarChart3,
} from 'lucide-react';
import { selectUser } from '../../features/authSlice';
import { PageHeader } from '../../components/ui/primitives';

import AlumniDirectoryTab from './AlumniDirectoryTab';
import AlumniJobsTab from './AlumniJobsTab';
import AlumniEventsTab from './AlumniEventsTab';
import AlumniChaptersTab from './AlumniChaptersTab';
import AlumniMentorshipTab from './AlumniMentorshipTab';
import AlumniProfileTab from './AlumniProfileTab';
import AlumniVerificationTab from './AlumniVerificationTab';
import AlumniImportTab from './AlumniImportTab';
import AlumniAnalyticsTab from './AlumniAnalyticsTab';

export default function Alumni() {
  const currentUser = useSelector(selectUser);
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'directory';

  const isAlumni = currentUser?.role === 'alumni';
  const isStaff = ['admin', 'hod'].includes(currentUser?.role);
  const canViewAnalytics = ['admin', 'hod', 'principal', 'dean', 'chairman'].includes(currentUser?.role);

  // Available tabs tailored to current role
  const tabs = useMemo(() => {
    const list = [
      { id: 'directory', label: 'Directory', icon: GraduationCap },
      { id: 'jobs', label: 'Opportunities', icon: Briefcase },
      { id: 'events', label: 'Events & Reunions', icon: Calendar },
      { id: 'chapters', label: 'Chapters & Hubs', icon: Compass },
      { id: 'mentorship', label: '1-on-1 Mentorship', icon: Sparkles },
    ];

    if (isAlumni) {
      list.push({ id: 'my_profile', label: 'My Alumni Profile', icon: User });
    }

    if (isStaff) {
      list.push({ id: 'verification', label: 'Verification Queue', icon: ShieldCheck });
      list.push({ id: 'import', label: 'Bulk Import & Invites', icon: FileSpreadsheet });
    }

    if (canViewAnalytics) {
      list.push({ id: 'analytics', label: 'Network Analytics', icon: BarChart3 });
    }

    return list;
  }, [isAlumni, isStaff, canViewAnalytics]);

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId });
  };

  // If the URL has an invalid tab for this role, fall back to directory
  useEffect(() => {
    if (!tabs.some((t) => t.id === currentTab)) {
      setSearchParams({ tab: 'directory' }, { replace: true });
    }
  }, [currentTab, tabs, setSearchParams]);

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        icon={GraduationCap}
        title="Alumni Network & Career Hub"
        subtitle="Bridge generations of campus graduates, mentorship pairings, job referrals, and regional chapters."
      />

      {/* Main Tab Navigation Bar */}
      <div className="glass flex overflow-x-auto rounded-2xl p-1.5 scrollbar-none">
        <div className="flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold transition-all duration-300 ${
                  isActive
                    ? 'bg-white text-primary-700 shadow-soft dark:bg-white/15 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Panels */}
      <div>
        {currentTab === 'directory' && <AlumniDirectoryTab />}
        {currentTab === 'jobs' && <AlumniJobsTab />}
        {currentTab === 'events' && <AlumniEventsTab />}
        {currentTab === 'chapters' && <AlumniChaptersTab />}
        {currentTab === 'mentorship' && <AlumniMentorshipTab />}
        {currentTab === 'my_profile' && isAlumni && <AlumniProfileTab />}
        {currentTab === 'verification' && isStaff && <AlumniVerificationTab />}
        {currentTab === 'import' && isStaff && <AlumniImportTab />}
        {currentTab === 'analytics' && canViewAnalytics && <AlumniAnalyticsTab />}
      </div>
    </div>
  );
}
