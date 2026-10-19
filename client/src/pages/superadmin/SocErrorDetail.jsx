import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, ClipboardList, Plus, Sparkles } from 'lucide-react';
import { Badge, Button, Card, CardHeader, ErrorState, PageHeader, Skeleton } from '../../components/ui/primitives';
import { Input } from '../../components/ui/form';
import { KindTag, RunResult, RunTestButton, StatusBadge } from '../../components/superadmin/soc';
import { errorMessage, useAddSocErrorNoteMutation, useAiExplainSocErrorMutation, useGetSocErrorQuery, useSetSocErrorStatusMutation, useVerifySocErrorMutation } from '../../services/superAdmin';
import { ERROR_STATUS_LABEL, TRANSITION_LABEL, groupCauses, severityTone, verifyState } from './socModel';
import { NewIncidentModal } from './Soc';
import { fmtDateTime } from '../../utils/format';

/**
 * One error, explained in ten sections. The text comes from the error
 * catalog, the facts from the stored error record, and the findings from
 * stored diagnostic runs — the page adds nothing of its own. Each statement
 * is tagged: confirmed finding / possible cause / recommended action /
 * unverified assumption.
 */
export default function SocErrorDetail() {
  const { id } = useParams();
  // Poll while a verification batch is deciding (status stays fix_applied until it does).
  const [watching, setWatching] = useState(false);
  const { data, error, refetch } = useGetSocErrorQuery(id, { pollingInterval: watching ? 1500 : 0 });
  const status = data?.error?.status;
  useEffect(() => {
    if (status && status !== 'fix_applied') setWatching(false);
  }, [status]);
  const [setStatus, { isLoading: changing }] = useSetSocErrorStatusMutation();
  const [verify, { isLoading: verifying }] = useVerifySocErrorMutation();
  const [ai, aiState] = useAiExplainSocErrorMutation();
  const [addNote] = useAddSocErrorNoteMutation();
  const [note, setNote] = useState('');
  const [incident, setIncident] = useState(false);

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-96" />;
  const { error: e, explanation: x, incidents, related, allowedTransitions } = data;
  const s = x.sections;
  const v = verifyState(e.status);

  const change = async (status) => {
    try {
      await setStatus({ id, status, note: note || undefined }).unwrap();
      setNote('');
      toast.success(`Status: ${ERROR_STATUS_LABEL[status]}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const startVerify = async () => {
    try {
      await verify(id).unwrap();
      toast.success('Verification started');
      setWatching(true);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <Link to="/super-admin/soc?tab=errors" className="inline-flex items-center gap-1 text-sm font-semibold muted hover:underline"><ArrowLeft className="h-4 w-4" /> Error explorer</Link>
      <PageHeader
        icon={ClipboardList}
        title={e.title}
        subtitle={`${e.code}${x.classification === 'unclassified' ? ' · unclassified' : ''} · ${e.environment || 'unknown environment'} · ${e.count} occurrence(s)`}
        actions={<Button variant="outline" icon={Plus} onClick={() => setIncident(true)}>Open incident</Button>}
      />

      {/* Workflow */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Badge color={severityTone(e.severity)}>{e.severity}</Badge>
          <span className="font-bold">{ERROR_STATUS_LABEL[e.status]}</span>
          {e.regressions > 0 && <Badge color="danger">re-opened ×{e.regressions} after resolution</Badge>}
          <Input className="min-w-[200px] flex-1" placeholder="Optional note for the status change" value={note} maxLength={1000} onChange={(ev) => setNote(ev.target.value)} />
          {allowedTransitions.map((t) => <Button key={t} size="sm" variant="outline" loading={changing} onClick={() => change(t)}>{TRANSITION_LABEL[t] || t}</Button>)}
          <Button size="sm" icon={CheckCircle2} disabled={!v.enabled} loading={verifying} onClick={startVerify} title={v.hint}>Verify fix</Button>
        </div>
        <p className="mt-2 text-xs muted">{v.hint} Resolved is never set by hand.</p>
      </Card>

      <Section title={s.whatHappened.title}>
        <p>{s.whatHappened.text}</p>
        <Facts items={s.whatHappened.facts} />
      </Section>

      <Section title={s.whatItMeans.title}><p>{s.whatItMeans.text}</p></Section>

      <Section title={s.whyItMightHappen.title}>
        <p>{s.whyItMightHappen.text}</p>
        {groupCauses(s.whyItMightHappen.causes).map((g) => (
          <div key={g.kind} className="mt-3">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide muted">{g.label}</p>
            <ul className="space-y-2">
              {g.items.map((c) => (
                <li key={c.id} className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
                  <div className="flex flex-wrap items-center gap-2"><KindTag kind={c.kind} /><span>{c.text}</span></div>
                  <p className="mt-1 text-xs muted">{c.note}</p>
                  {c.evidence?.map((ev) => <p key={ev.runId} className="text-xs">{ev.testId}: <StatusBadge status={ev.status} /> {ev.observed} <span className="muted">({fmtDateTime(ev.at)})</span></p>)}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {s.whyItMightHappen.unknowns.length > 0 && (
          <div className="mt-3"><p className="text-xs font-bold uppercase tracking-wide muted">Still unknown</p><Facts items={s.whyItMightHappen.unknowns.map((text) => ({ kind: 'unverified', text }))} /></div>
        )}
      </Section>

      <Section title={s.whatIsAffected.title}>
        <p className="text-xs font-bold uppercase tracking-wide muted">Observed</p>
        <Facts items={s.whatIsAffected.observed} />
        <p className="mt-2 text-xs font-bold uppercase tracking-wide muted">Could be affected</p>
        <Facts items={s.whatIsAffected.potential} />
      </Section>

      <Section title={s.howSerious.title}>
        <p className="flex flex-wrap items-center gap-2"><Badge color={severityTone(s.howSerious.severity)}>{s.howSerious.severity}</Badge>{s.howSerious.text}</p>
        <p className="mt-1 text-sm muted">Why: {s.howSerious.reason}</p>
      </Section>

      <Section title={s.whatTestsFound.title}>
        <p>{s.whatTestsFound.text}</p>
        <div className="mt-2 space-y-2">{s.whatTestsFound.findings.map((f) => <RunResult key={f.runId} run={{ ...f, _id: f.runId }} />)}</div>
        <div className="mt-4">
          <p className="mb-2 font-bold">Run a test for this error</p>
          {x.availableTests.length === 0 ? <p className="text-sm muted">No registered tests apply to this error.</p> : (
            <ul className="space-y-3">
              {x.availableTests.map((t) => (
                <li key={t.id} className="rounded-2xl border border-white/50 p-3 dark:border-white/10">
                  <p className="font-bold">{t.name} <span className="font-mono text-[11px] muted">{t.id}</span></p>
                  <p className="text-xs muted">{t.purpose}</p>
                  <div className="mt-2"><RunTestButton test={t} errorId={id} onFinished={() => refetch()} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title={s.howToFix.title}>
        <p>{s.howToFix.text}</p>
        {s.howToFix.repair && <Repair repair={s.howToFix.repair} />}
      </Section>

      <Section title={s.howToVerify.title}>
        <p>{s.howToVerify.text}</p>
        <p className="mt-1 text-sm"><span className="font-semibold">Success criteria:</span> {s.howToVerify.criteria || '—'}</p>
        <p className="text-sm"><span className="font-semibold">Observation window:</span> {s.howToVerify.windowMinutes} min</p>
        <ul className="mt-1 list-disc pl-5 text-sm">{s.howToVerify.tests.map((t) => <li key={t.id}>{t.name}{!t.registered && ' (not registered)'}</li>)}</ul>
      </Section>

      <Section title={s.ifStillFailing.title}>
        <Facts items={s.ifStillFailing.steps} />
        {s.ifStillFailing.missingEvidence.length > 0 && <><p className="mt-2 text-xs font-bold uppercase tracking-wide muted">Missing evidence</p><Facts items={s.ifStillFailing.missingEvidence.map((text) => ({ kind: 'unverified', text }))} /></>}
      </Section>

      <Section title={s.technical.title}>
        <p className="text-sm">{s.technical.text}</p>
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold">Show sanitized technical details</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/5 p-3 text-[11px] dark:bg-white/5">{JSON.stringify(s.technical.details, null, 2)}</pre>
        </details>
      </Section>

      <Card>
        <CardHeader title="AI-assisted explanation (optional)" subtitle="Drafted by the configured AI provider from the redacted facts above. Never a verified finding." />
        <Button size="sm" variant="outline" icon={Sparkles} loading={aiState.isLoading} onClick={() => ai(id)}>Ask AI to explain</Button>
        {aiState.error && <p className="mt-2 text-sm text-rose-600">{errorMessage(aiState.error)}</p>}
        {aiState.data && (
          <div className="mt-3 rounded-2xl border border-amber-400/50 p-3">
            <p className="mb-2 flex items-center gap-2 text-xs font-bold"><KindTag kind="unverified" /> {aiState.data.notice}</p>
            <p className="whitespace-pre-wrap text-sm">{aiState.data.content}</p>
            <p className="mt-1 text-[11px] muted">{aiState.data.model} · {fmtDateTime(aiState.data.at)}</p>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Related" subtitle="Errors sharing a correlation ID, and incidents" />
          {related.length === 0 && incidents.length === 0 ? <p className="text-sm muted">Nothing linked.</p> : (
            <ul className="space-y-1 text-sm">
              {related.map((r) => <li key={r._id}><Link to={`/super-admin/soc/errors/${r._id}`} className="hover:underline">{r.title}</Link> <span className="text-xs muted">{r.source} · ×{r.count}</span></li>)}
              {incidents.map((i) => <li key={i._id}>Incident #{i.number}: {i.title} <span className="text-xs muted">{i.status}</span></li>)}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Notes and history" />
          <ul className="max-h-64 space-y-1 overflow-auto text-xs">
            {(e.notes || []).slice().reverse().map((n) => <li key={n._id}><span className="muted">{fmtDateTime(n.at)} · {n.byName || 'System'} · {n.kind}</span><span className="block">{n.text}</span></li>)}
          </ul>
          <NoteBox onAdd={(text) => addNote({ id, text }).unwrap()} />
        </Card>
      </div>
      {incident && <NewIncidentModal seed={{ title: e.title, severity: ['critical', 'high'].includes(e.severity) ? e.severity : 'medium', summary: `${e.code}: ${e.message || ''}`, errorIds: [e._id], runIds: data.runs.slice(0, 10).map((r) => r._id) }} onClose={() => setIncident(false)} />}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <Card>
      <h2 className="mb-2 text-lg font-extrabold">{title}</h2>
      <div className="text-sm">{children}</div>
    </Card>
  );
}

function Facts({ items = [] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((f, i) => (
        <li key={`${i}-${f.text}`} className="flex flex-wrap items-start gap-2"><KindTag kind={f.kind} /><span className="flex-1">{f.text}</span></li>
      ))}
    </ul>
  );
}

function Repair({ repair }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2 text-xs"><Badge color="neutral">risk: {repair.riskLevel}</Badge><Badge color="info">{repair.category === 'manual' ? 'manual guidance — nothing runs automatically' : repair.category}</Badge></div>
      {repair.symptoms?.length > 0 && <div><p className="font-semibold">Symptoms</p><ul className="list-disc pl-5">{repair.symptoms.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      {repair.preconditions?.length > 0 && <div><p className="font-semibold">You will need</p><ul className="list-disc pl-5">{repair.preconditions.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      <ol className="space-y-2">
        {repair.steps.map((st, i) => (
          <li key={st.action} className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
            <p className="font-bold">{i + 1}. {st.action}</p>
            <dl className="mt-1 grid gap-1 text-sm sm:grid-cols-[90px_1fr]">
              <dt className="text-xs font-semibold muted">Where</dt><dd>{st.where}</dd>
              <dt className="text-xs font-semibold muted">Why</dt><dd>{st.why}</dd>
              <dt className="text-xs font-semibold muted">Expect</dt><dd>{st.expected}</dd>
              {st.risk && <><dt className="text-xs font-semibold muted">Risk</dt><dd className="text-amber-700 dark:text-amber-300">{st.risk}</dd></>}
            </dl>
          </li>
        ))}
      </ol>
      {repair.rollback && <p className="text-sm"><span className="font-semibold">Rollback:</span> {repair.rollback}</p>}
    </div>
  );
}

function NoteBox({ onAdd }) {
  const [text, setText] = useState('');
  return (
    <div className="mt-2 flex gap-2">
      <Input className="flex-1" placeholder="Add a note" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
      <Button size="sm" disabled={text.trim().length < 2} onClick={async () => { try { await onAdd(text); setText(''); } catch (err) { toast.error(errorMessage(err)); } }}>Add</Button>
    </div>
  );
}
