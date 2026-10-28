import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { Button, Card, Spinner } from '../ui.jsx';

/** The same Terms acceptance the mobile apps require, using the existing /legal endpoints. */
export default function Terms({ guard, onAccepted, onSignOut }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.gate.api.terms().then((r) => (r.ok ? setDoc(r.data) : setError('The Terms could not be loaded. Check the connection and try again.')));
  }, []);

  const accept = async () => {
    setBusy(true);
    const r = await window.gate.api.acceptTerms(doc.version);
    setBusy(false);
    if (r.ok) onAccepted();
    else setError(r.message || 'Acceptance failed. Try again.');
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="glass-strong flex max-h-[90vh] w-full max-w-3xl flex-col">
        <h1 className="mb-1 flex items-center gap-2 text-xl font-extrabold">
          <FileText className="h-5 w-5" aria-hidden /> {doc?.title || 'Terms and Conditions'}
        </h1>
        <p className="mb-3 text-sm muted">{guard?.name}, please read and accept the current Terms to continue{doc ? ` (version ${doc.version})` : ''}.</p>
        <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-white/60 p-4 text-sm leading-relaxed dark:bg-white/5" tabIndex={0}>
          {doc ? doc.content : error ? <p className="text-rose-600">{error}</p> : <Spinner />}
        </div>
        {error && doc && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <label className="mt-4 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={!doc} /> I have read and agree to the Terms and Conditions
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onSignOut}>
            Sign out
          </Button>
          <Button disabled={!agreed || !doc} loading={busy} onClick={accept}>
            Accept and continue
          </Button>
        </div>
      </Card>
    </div>
  );
}
