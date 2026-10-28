import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, History as HistoryIcon, LayoutDashboard, LogOut, ScanLine, ShieldCheck, Stethoscope, Usb, UserRoundCog, X } from 'lucide-react';
import { useConnection } from './hooks/useConnection.js';
import { ScannerProvider, useScanner } from './hooks/useScanner.jsx';
import { explainProblem } from './lib/explain.js';
import { Button, Card, Spinner, StatusDot, cn } from './ui.jsx';
import Login from './pages/Login.jsx';
import Terms from './pages/Terms.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ScannerPage from './pages/ScannerPage.jsx';
import History from './pages/History.jsx';
import Diagnostics from './pages/Diagnostics.jsx';

const NAV = [
  { id: 'scanner', label: 'Scanner', icon: ScanLine },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'history', label: 'Gate History', icon: HistoryIcon },
  { id: 'diagnostics', label: 'Diagnostics', icon: Stethoscope },
];

/**
 * Boot: restore the saved session and re-validate it with the server before
 * anything else. Phases: booting → (unverified | login | terms | password) → ready.
 */
export default function App() {
  const [info, setInfo] = useState(null);
  const [settings, setSettings] = useState(null);
  const [phase, setPhase] = useState('booting');
  const [guard, setGuard] = useState(null);
  const [signedOutReason, setSignedOutReason] = useState(null);
  const [savedGuardName, setSavedGuardName] = useState(null);

  // After sign-in: Terms / temporary password must be handled before scanning.
  const enter = useCallback((g) => {
    setGuard(g);
    if (g?.mustChangePassword) setPhase('password');
    else if (g?.legal?.termsRequired) setPhase('terms');
    else setPhase('ready');
  }, []);

  const restore = useCallback(async () => {
    setPhase('booting');
    const r = await window.gate.auth.restore();
    if (r.status === 'signed-in') enter(r.guard);
    else if (r.status === 'unverified') {
      setSavedGuardName(r.guardName);
      setSignedOutReason(explainProblem(r.kind));
      setPhase('unverified');
    } else {
      if (r.reason) setSignedOutReason(explainProblem(r.reason, r.message));
      setPhase('login');
    }
  }, [enter]);

  useEffect(() => {
    Promise.all([window.gate.app.info(), window.gate.settings.get()]).then(([i, s]) => {
      setInfo(i);
      setSettings(s);
      restore();
    });
    return window.gate.auth.onSignedOut((e) => {
      setGuard(null);
      if (e.reason !== 'manual' && e.reason !== 'switch_guard') setSignedOutReason(explainProblem(e.reason === 'role' ? 'role' : 'session_ended', e.message));
      setPhase('login');
    });
  }, [restore]);

  // The saved session could not be checked (server offline): retry quietly.
  useEffect(() => {
    if (phase !== 'unverified') return undefined;
    const t = setInterval(restore, 15000);
    return () => clearInterval(t);
  }, [phase, restore]);

  const saveSettings = async (patch) => setSettings(await window.gate.settings.set(patch));

  if (phase === 'booting' || !info || !settings) {
    return (
      <Centered>
        <Spinner className="h-8 w-8" />
        <p className="mt-3 font-semibold">Checking your session with the server…</p>
      </Centered>
    );
  }
  if (phase === 'unverified') {
    return (
      <Centered>
        <Card className="max-w-lg text-center">
          <p className="text-lg font-extrabold">{signedOutReason?.title || 'Server unreachable'}</p>
          <p className="mt-2 text-sm muted">
            {savedGuardName ? `${savedGuardName}'s saved session` : 'The saved session'} will be verified as soon as the server can be reached. No scans can be recorded until then.
          </p>
          <p className="mt-2 text-sm">{signedOutReason?.action}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={restore}>Try again now</Button>
            <Button variant="outline" onClick={async () => { await window.gate.auth.logout('manual'); setPhase('login'); }}>
              Sign in as someone else
            </Button>
          </div>
        </Card>
      </Centered>
    );
  }
  if (phase === 'login') {
    return (
      <Login
        info={info}
        notice={signedOutReason}
        onSignedIn={(g) => {
          setSignedOutReason(null);
          enter(g);
        }}
      />
    );
  }
  if (phase === 'password') {
    return (
      <Centered>
        <Card className="max-w-lg text-center">
          <p className="text-lg font-extrabold">Change your temporary password first</p>
          <p className="mt-2 text-sm muted">This account has a temporary password set by an administrator. Sign in to the J.N.N portal in a browser, change the password, then sign in here again.</p>
          <Button className="mt-4" onClick={async () => { await window.gate.auth.logout('manual'); setPhase('login'); }}>
            Back to sign-in
          </Button>
        </Card>
      </Centered>
    );
  }
  if (phase === 'terms') return <Terms guard={guard} onAccepted={() => setPhase('ready')} onSignOut={async () => { await window.gate.auth.logout('manual'); setPhase('login'); }} />;

  return <Shell info={info} guard={guard} settings={settings} saveSettings={saveSettings} onTerms={() => setPhase('terms')} onSignedOut={() => setPhase('login')} />;
}

function Centered({ children }) {
  return <div className="flex min-h-screen flex-col items-center justify-center p-6">{children}</div>;
}

function Shell({ info, guard, settings, saveSettings, onTerms, onSignedOut }) {
  const connection = useConnection();
  const [page, setPage] = useState('scanner');
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  const onAuthProblem = useCallback((r) => (r.kind === 'terms' ? onTerms() : null), [onTerms]);

  return (
    <ScannerProvider settings={settings} connection={connection} onAuthProblem={onAuthProblem} notify={notify}>
      <div className="flex h-screen min-h-0">
        <aside className="glass flex w-60 shrink-0 flex-col gap-1 rounded-none border-y-0 border-l-0 p-4">
          <div className="mb-4 flex items-center gap-2 px-1">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold leading-tight">J.N.N Gate Scanner</p>
              <p className="text-xs muted">Security</p>
            </div>
          </div>
          <nav aria-label="Main" className="flex flex-col gap-1">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setPage(id)} className={cn('nav-link', page === id && 'nav-link-active')} aria-current={page === id ? 'page' : undefined}>
                <Icon className="h-5 w-5" aria-hidden />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="mt-auto space-y-2 border-t border-white/60 pt-3 dark:border-white/10">
            <div className="px-1">
              <p className="truncate text-sm font-bold" title={guard?.name}>{guard?.name}</p>
              <p className="text-xs muted">Security · {settings.gateName || 'Gate not named'}</p>
            </div>
            <GuardActions guard={guard} onSignedOut={onSignedOut} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <StatusBar connection={connection} info={info} />
          <main className="min-h-0 flex-1 overflow-y-auto p-6">
            {page === 'scanner' && <ScannerPage connection={connection} />}
            {page === 'dashboard' && <Dashboard connection={connection} guard={guard} settings={settings} />}
            {page === 'history' && <History />}
            {page === 'diagnostics' && <Diagnostics info={info} connection={connection} settings={settings} saveSettings={saveSettings} guard={guard} />}
          </main>
        </div>
      </div>
      <SerialChooser />
      {toast && (
        <div role="status" className="glass-strong fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold">
          {toast}
          <button type="button" className="btn-ghost rounded-lg p-1" onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </ScannerProvider>
  );
}

function StatusBar({ connection }) {
  const scanner = useScanner();
  const server = connection.status === 'online'
    ? { tone: 'success', label: `Server connected${connection.ms != null ? ` · ${connection.ms} ms` : ''}` }
    : connection.status === 'checking'
      ? { tone: 'pending', label: 'Checking server…' }
      : { tone: 'error', label: explainProblem(connection.kind).title };
  return (
    <header className="glass flex flex-wrap items-center gap-x-6 gap-y-2 rounded-none border-x-0 border-t-0 px-6 py-3">
      <StatusDot tone={server.tone} label={server.label} />
      <StatusDot tone={scanner.status.tone} label={scanner.status.label} detail={scanner.status.detail} />
      {scanner.armed ? <StatusDot tone="success" label="Recording scans" /> : <StatusDot tone="neutral" label="Not recording — open Scanner" />}
      {connection.status === 'offline' && <span className="text-sm font-semibold text-rose-600">Scans are NOT recorded while offline — use the manual gate register.</span>}
    </header>
  );
}

/** Sign out, or hand the PC to the next guard: the session is revoked first, so nobody scans under someone else's name. */
function GuardActions({ guard, onSignedOut }) {
  const [confirm, setConfirm] = useState(null);
  const scanner = useScanner();
  const pending = scanner.jobs.filter((j) => ['queued', 'sending', 'uncertain'].includes(j.state)).length;
  const go = async (reason) => {
    await window.gate.auth.logout(reason);
    window.gate.diag.record({ event: reason === 'switch_guard' ? 'guard_switch' : 'sign_out' });
    onSignedOut();
  };
  if (confirm) {
    return (
      <div className="space-y-2 rounded-2xl bg-white/60 p-2 text-xs dark:bg-white/5">
        <p className="font-semibold">{confirm === 'switch_guard' ? `Hand over from ${guard?.name}?` : 'Sign out of the Gate Scanner?'}</p>
        {pending > 0 && <p className="text-amber-700">{pending} scan(s) still being confirmed. Wait for them first.</p>}
        <div className="flex gap-1">
          <Button className="flex-1 !px-2 !py-1.5 text-xs" variant="danger" disabled={pending > 0} onClick={() => go(confirm)}>
            Yes
          </Button>
          <Button className="flex-1 !px-2 !py-1.5 text-xs" variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Button variant="soft" icon={UserRoundCog} className="w-full justify-start" onClick={() => setConfirm('switch_guard')}>
        Switch guard / shift
      </Button>
      <Button variant="ghost" icon={LogOut} className="w-full justify-start" onClick={() => setConfirm('manual')}>
        Sign out
      </Button>
    </div>
  );
}

/** The real COM-port list from Windows, shown when the guard connects a serial scanner. */
function SerialChooser() {
  const [ports, setPorts] = useState(null);
  useEffect(() => window.gate.serial.onChoose((list) => setPorts(list)), []);
  if (!ports) return null;
  const pick = (id) => {
    window.gate.serial.choose(id);
    setPorts(null);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" role="dialog" aria-modal="true" aria-label="Choose scanner port">
      <Card className="glass-strong w-full max-w-md">
        <p className="mb-3 flex items-center gap-2 font-extrabold">
          <Usb className="h-5 w-5" aria-hidden /> Choose the scanner's COM port
        </p>
        {ports.length === 0 ? (
          <p className="text-sm muted">No serial ports found. Plug in the scanner (set to USB virtual COM mode) and try again.</p>
        ) : (
          <ul className="space-y-2">
            {ports.map((p) => (
              <li key={p.portId}>
                <button type="button" className="btn btn-outline w-full justify-between" onClick={() => pick(p.portId)}>
                  <span>{p.displayName}</span>
                  <span className="text-xs muted">{p.portName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" icon={Activity} onClick={() => pick('')}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
