import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/primitives';
import { APP_NAME, APP_VERSION, INSTITUTION, PRIVACY_PATH, TERMS_PATH } from '../../utils/legal';
import LegalLayout from './LegalLayout';

// Set VITE_OFFICIAL_WEBSITE_URL at build time once the College confirms it;
// nothing is shown rather than a guessed address.
const OFFICIAL_WEBSITE = /^https:\/\//.test(import.meta.env?.VITE_OFFICIAL_WEBSITE_URL || '') ? import.meta.env.VITE_OFFICIAL_WEBSITE_URL : null;

/** About the App: name, purpose, version, website and institution. Public. */
export default function AboutApp() {
  useEffect(() => {
    document.title = `About · ${APP_NAME}`;
  }, []);
  const rows = [
    ['Application', APP_NAME],
    ['Version', `${APP_VERSION} (web)`],
    ['Institution', INSTITUTION],
  ];
  return (
    <LegalLayout>
      <Card className="p-6 sm:p-10">
        <div className="flex items-center gap-4">
          <img src="/logo.jpeg" alt="" className="h-14 w-14 rounded-2xl object-cover" />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">About the App</h1>
            <p className="text-sm muted">{APP_NAME}</p>
          </div>
        </div>
        <p className="mt-6 text-[15px] leading-7">
          {APP_NAME} is the campus platform of {INSTITUTION}. It brings attendance, timetables, announcements, events and clubs, gate passes, hostel and
          transport information, complaints, chat and study tools together for students, faculty and staff on the web, Android and iOS.
        </p>
        <dl className="mt-6 divide-y divide-black/5 rounded-2xl bg-white/50 dark:divide-white/10 dark:bg-white/[0.03]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
              <dt className="font-semibold muted">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
          <div className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
            <dt className="font-semibold muted">Official website</dt>
            <dd className="font-semibold">
              {OFFICIAL_WEBSITE ? (
                <a href={OFFICIAL_WEBSITE} target="_blank" rel="noopener noreferrer" className="text-primary-600 underline underline-offset-2 dark:text-primary-300">
                  {OFFICIAL_WEBSITE.replace(/^https:\/\//, '')}
                </a>
              ) : (
                <span className="muted">To be announced by the College</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-6 text-sm muted">
          Read the <Link to={TERMS_PATH} className="font-semibold text-primary-600 underline underline-offset-2 dark:text-primary-300">Terms and Conditions</Link> and the{' '}
          <Link to={PRIVACY_PATH} className="font-semibold text-primary-600 underline underline-offset-2 dark:text-primary-300">Privacy Policy</Link>.
        </p>
      </Card>
    </LegalLayout>
  );
}
