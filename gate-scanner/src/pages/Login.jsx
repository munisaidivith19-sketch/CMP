import { useState } from 'react';
import { AlertTriangle, LogIn, ShieldCheck } from 'lucide-react';
import { explainProblem } from '../lib/explain.js';
import { Button, Card } from '../ui.jsx';

/** Security sign-in against the existing J.N.N accounts. The server refuses every other role. */
export default function Login({ info, notice, onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const r = await window.gate.auth.login(email, password);
    setBusy(false);
    setPassword('');
    if (r.ok) return onSignedIn(r.guard);
    // Credential failures keep the server's own wording (attempts left, lock time).
    const explained = explainProblem(r.kind === 'auth' ? 'validation' : r.kind, r.message);
    setError(r.kind === 'auth' ? { title: 'Sign-in failed', action: r.message || 'Check the email and password.' } : explained);
  };

  const shown = error || notice;
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="glass-strong w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-glow">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-extrabold">J.N.N Gate Scanner</h1>
            <p className="text-sm muted">Security staff sign-in</p>
          </div>
        </div>
        {shown && (
          <div role="alert" className="mb-4 flex gap-2 rounded-2xl bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-bold">{shown.title}</p>
              <p>{shown.action}</p>
            </div>
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">College email</label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full" icon={LogIn} loading={busy}>
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-xs muted">
          Only Security accounts can use this app. You stay signed in on this PC until you sign out or switch guard; the server can end the session at any time.
          {!info.secureStorage && ' Windows secure storage is unavailable here, so you will be asked to sign in again after restarting.'}
        </p>
      </Card>
    </div>
  );
}
