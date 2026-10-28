import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, PageLoader, ErrorState } from '../../components/ui/primitives';
import Markdown from '../../components/Markdown';
import { useGetPolicyQuery } from '../../services/legal';
import { fmtEffectiveDate, PRIVACY_PATH, TERMS_PATH } from '../../utils/legal';
import LegalLayout from './LegalLayout';

/** The published text of one policy, version and effective date. Public. */
export function PolicyDocument({ policyId, headingLevel = 1 }) {
  const { data, isLoading, error, refetch } = useGetPolicyQuery(policyId);
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const Heading = `h${headingLevel}`;
  return (
    <article aria-labelledby={`policy-${policyId}-title`}>
      <Heading id={`policy-${policyId}-title`} className="text-2xl font-extrabold tracking-tight sm:text-3xl">
        {data.title}
      </Heading>
      <p className="mt-1 text-sm muted">
        Version {data.version} · Effective {fmtEffectiveDate(data.effectiveAt)}
      </p>
      {/* Markdown builds React elements only — the text is never inserted as HTML. */}
      <div className="mt-6 max-w-none text-[15px] leading-7">
        <Markdown text={data.content} />
      </div>
    </article>
  );
}

export default function PolicyPage({ policyId }) {
  const other = policyId === 'terms' ? { to: PRIVACY_PATH, label: 'Privacy Policy' } : { to: TERMS_PATH, label: 'Terms and Conditions' };
  useEffect(() => {
    document.title = `${policyId === 'terms' ? 'Terms and Conditions' : 'Privacy Policy'} · J.N.N Campus Connect`;
  }, [policyId]);
  return (
    <LegalLayout>
      <Card className="p-6 sm:p-10">
        <PolicyDocument policyId={policyId} />
        <p className="mt-8 border-t border-black/5 pt-4 text-sm muted dark:border-white/10">
          See also the <Link to={other.to} className="font-semibold text-primary-600 underline underline-offset-2 dark:text-primary-300">{other.label}</Link>.
        </p>
      </Card>
    </LegalLayout>
  );
}
