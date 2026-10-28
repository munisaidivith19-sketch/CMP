import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, FolderOpen, Play, RefreshCw, ScanLine, Settings2, Usb, XCircle, AlertTriangle } from 'lucide-react';
import { useScanner } from '../hooks/useScanner.jsx';
import { explainProblem } from '../lib/explain.js';
import { serialSupported } from '../lib/serialReader.js';
import { Badge, Button, Card, cn, fmtTime } from '../ui.jsx';

const ICON = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle, wait: CircleDashed };
const TONE = { ok: 'text-emerald-600', warn: 'text-amber-600', fail: 'text-rose-600', wait: 'text-sky-600' };

/**
 * Automatic troubleshooting for this gate PC: each check says what is wrong
 * and the next safe step. Read-only — nothing here bypasses a server check.
 */
export default function Diagnostics({ info, connection, settings, saveSettings, guard }) {
  const scanner = useScanner();
  const [checks, setChecks] = useState([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);

  const run = useCallback(async () => {
    setRunning(true);
    const out = [];
    const add = (name, state, message, action) => out.push({ name, state, message, action });

    const dnsRes = await window.gate.diag.dns();
    add('Internet connection', dnsRes.internet ? 'ok' : 'fail', dnsRes.internet ? 'This PC can reach the internet.' : 'This PC cannot resolve internet names.', dnsRes.internet ? null : 'Check the network cable / Wi-Fi and the proxy settings.');
    add('Server address', dnsRes.server ? 'ok' : 'fail', dnsRes.server ? 'The server name resolves.' : 'The server name could not be resolved.', dnsRes.server ? null : dnsRes.internet ? 'The internet works but the server name does not — contact IT.' : 'Fix the internet connection first.');

    const health = await window.gate.diag.health();
    if (health.ok) add('Server reachable', health.ms > 2000 ? 'warn' : 'ok', `The server answered in ${health.ms} ms.`, health.ms > 2000 ? 'The connection is slow; scans may take a few seconds.' : null);
    else {
      const p = explainProblem(health.kind);
      add('Server reachable', 'fail', p.title, p.action);
    }

    const session = health.ok ? await window.gate.api.session() : null;
    if (!session) add('Signed-in session', 'wait', 'Not checked: the server is unreachable.', null);
    else if (session.ok) {
      add('Signed-in session', 'ok', `Signed in as ${session.data.guard.name}.`, null);
      add('Security role', session.data.guard.role === 'security' ? 'ok' : 'fail', `Role on the server: ${session.data.guard.role}.`, session.data.guard.role === 'security' ? null : 'Sign in with a Security account.');
      const skew = Math.abs(Date.now() - new Date(session.data.serverTime).getTime());
      add('PC clock', skew > 5 * 60000 ? 'warn' : 'ok', skew > 5 * 60000 ? `This PC's clock is ${Math.round(skew / 60000)} minutes off the server.` : 'The PC clock matches the server.', skew > 5 * 60000 ? 'Set Windows to set the time automatically. A wrong clock can break secure connections.' : null);
    } else {
      const p = explainProblem(session.kind, session.message);
      add('Signed-in session', 'fail', p.title, p.action);
    }

    add('Saved sign-in', info.secureStorage ? 'ok' : 'warn', info.secureStorage ? 'Stored encrypted with Windows (DPAPI) for this Windows user.' : 'Windows secure storage is unavailable; the sign-in is not saved.', info.secureStorage ? null : 'You will need to sign in again after restarting the app.');

    if (settings.scannerMode === 'serial') {
      const st = scanner.status;
      add('Scanner (USB serial)', st.tone === 'success' ? 'ok' : st.tone === 'pending' ? 'wait' : 'fail', st.label, st.tone === 'success' ? null : st.detail);
    } else {
      add('Scanner (keyboard mode)', scanner.lastInput ? 'ok' : 'warn', scanner.lastInput ? `Last scan received at ${fmtTime(scanner.lastInput.at)} (${scanner.lastInput.label}).` : 'No scan received yet this session.', scanner.lastInput ? null : 'Use “Test the scanner” below. A keyboard-mode scanner cannot be detected by the app until it sends a scan.');
      add('Window focus', scanner.windowFocused ? 'ok' : 'warn', scanner.windowFocused ? 'The Gate Scanner window is active.' : 'Another window is active.', scanner.windowFocused ? null : 'Keyboard-mode scanners type into the active window — click this window.');
      add('Caps Lock', scanner.capsLock ? 'warn' : 'ok', scanner.capsLock ? 'Caps Lock is ON.' : 'Caps Lock is off.', scanner.capsLock ? 'Turn it off: return QRs are case-sensitive.' : null);
    }
    if (scanner.inputProblem) add('Last input problem', 'warn', `${scanner.inputProblem.title} at ${fmtTime(scanner.inputProblem.at)}.`, scanner.inputProblem.action);
    const pending = scanner.jobs.filter((j) => j.state === 'uncertain').length;
    add('Unconfirmed scans', pending ? 'warn' : 'ok', pending ? `${pending} scan(s) could not be confirmed.` : 'Every scan has a confirmed result.', pending ? 'Open Gate History and check those students before scanning them again.' : null);

    setChecks(out);
    setLog(await window.gate.diag.log());
    setRunning(false);
    if (health.ok !== connection.online) connection.check();
  }, [info, settings.scannerMode, scanner, connection]);

  // Run once on open (not on every status change).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    run();
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-extrabold">Diagnostics</h1>
        <Button className="ml-auto" icon={RefreshCw} loading={running} onClick={run}>
          Run checks
        </Button>
      </div>
      <Card>
        <ul className="divide-y divide-white/60 dark:divide-white/10">
          {checks.map((c) => {
            const Icon = ICON[c.state];
            return (
              <li key={c.name} className="flex gap-3 py-2.5">
                <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', TONE[c.state])} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-bold">{c.name} <span className="font-normal">— {c.message}</span></p>
                  {c.action && <p className="text-sm muted">Next step: {c.action}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ScannerSetup settings={settings} saveSettings={saveSettings} />
        <ScannerTest />
      </div>
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <p className="section-title">Recent diagnostic events</p>
          <Button variant="ghost" icon={FolderOpen} className="ml-auto" onClick={() => window.gate.diag.openLogFolder()}>
            Open log folder
          </Button>
        </div>
        <p className="mb-2 text-xs muted">Event types and codes only — no QR contents, passwords or tokens are logged.</p>
        <div className="max-h-64 overflow-y-auto rounded-2xl bg-white/50 p-3 font-mono text-xs dark:bg-white/5">
          {log.length === 0 ? 'No events yet.' : log.slice().reverse().map((e, i) => (
            <div key={`${e.at}-${i}`} className="whitespace-pre-wrap break-all">
              {e.at.slice(11, 19)} {Object.entries(e).filter(([k]) => k !== 'at').map(([k, v]) => `${k}=${v}`).join(' ')}
            </div>
          ))}
        </div>
      </Card>
      <Card className="text-sm">
        <p className="section-title mb-2">About this station</p>
        <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-y-1">
          <dt className="muted">App version</dt><dd>{info.version}</dd>
          <dt className="muted">Server</dt><dd className="break-all">{info.apiBaseUrl} ({info.apiSource})</dd>
          <dt className="muted">PC name</dt><dd>{info.deviceName}</dd>
          <dt className="muted">Windows</dt><dd>{info.platform}</dd>
          <dt className="muted">Signed in</dt><dd>{guard?.name} (Security)</dd>
        </dl>
      </Card>
    </div>
  );
}

function ScannerSetup({ settings, saveSettings }) {
  const scanner = useScanner();
  const [gateName, setGateName] = useState(settings.gateName);
  const [saved, setSaved] = useState(false);
  const save = async (patch) => {
    await saveSettings(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const connectSerial = async () => {
    const hint = await scanner.chooseSerialPort();
    if (hint?.usbVendorId !== undefined) save({ serialPortHint: hint });
  };
  return (
    <Card className="space-y-4">
      <p className="section-title flex items-center gap-2"><Settings2 className="h-5 w-5" aria-hidden /> Scanner setup {saved && <Badge tone="success">Saved</Badge>}</p>
      <div>
        <label className="label" htmlFor="gate">Gate name (shown on records)</label>
        <div className="flex gap-2">
          <input id="gate" className="input" maxLength={60} value={gateName} placeholder="e.g. Main Gate" onChange={(e) => setGateName(e.target.value)} />
          <Button variant="outline" onClick={() => save({ gateName })}>Save</Button>
        </div>
      </div>
      <fieldset>
        <legend className="label">Scanner connection</legend>
        <div className="flex flex-wrap gap-2">
          {[
            ['hid', 'USB / Bluetooth keyboard mode (HID)'],
            ['serial', 'USB virtual COM (serial)'],
          ].map(([mode, label]) => (
            <button key={mode} type="button" className={cn('chip !text-sm', settings.scannerMode === mode && 'chip-active')} aria-pressed={settings.scannerMode === mode} onClick={() => save({ scannerMode: mode })}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      {settings.scannerMode === 'hid' ? (
        <>
          <div>
            <label className="label" htmlFor="term">Scan ending key (scanner suffix)</label>
            <select id="term" className="input" value={settings.terminator} onChange={(e) => save({ terminator: e.target.value })}>
              <option value="Enter">Enter (CR) — factory default on most scanners</option>
              <option value="Tab">Tab</option>
              <option value="none">None (end after a short pause)</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="gap">Fastest typing treated as a person: {settings.maxKeyGapMs} ms between keys</label>
            <input id="gap" type="range" min={15} max={250} step={5} value={settings.maxKeyGapMs} onChange={(e) => save({ maxKeyGapMs: Number(e.target.value) })} className="w-full" />
            <p className="text-xs muted">Raise it only if a slow (e.g. Bluetooth) scanner's scans are not recognised.</p>
          </div>
        </>
      ) : (
        <>
          {!serialSupported() && <p className="text-sm text-rose-600">Serial ports are not available on this PC.</p>}
          <div>
            <label className="label" htmlFor="baud">Baud rate (from the scanner's manual)</label>
            <select id="baud" className="input" value={settings.serialBaudRate} onChange={(e) => save({ serialBaudRate: Number(e.target.value) })}>
              {[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Button icon={Usb} onClick={connectSerial}>Choose COM port…</Button>
            <Button variant="ghost" onClick={() => scanner.disconnectSerial()}>Disconnect</Button>
          </div>
          <p className="text-xs muted">{scanner.status.label}. {scanner.status.detail}</p>
        </>
      )}
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={settings.alwaysOnTop} onChange={(e) => save({ alwaysOnTop: e.target.checked })} /> Keep this window on top (keyboard-mode scanners need it focused)
      </label>
    </Card>
  );
}

/** Scan without recording: proves the scanner, its suffix and the keyboard layout work. */
function ScannerTest() {
  const scanner = useScanner();
  const { setTestMode, setTestCapture } = scanner;
  useEffect(() => () => setTestMode(false), [setTestMode]);
  const c = scanner.testCapture;
  return (
    <Card className="space-y-3">
      <p className="section-title flex items-center gap-2"><ScanLine className="h-5 w-5" aria-hidden /> Test the scanner</p>
      <p className="text-sm muted">While testing, scans are read but never sent to the server. Scan any student's gate pass QR or a test QR.</p>
      <Button variant={scanner.testMode ? 'danger' : 'primary'} icon={Play} onClick={() => { setTestCapture(null); setTestMode(!scanner.testMode); }}>
        {scanner.testMode ? 'Stop testing' : 'Start test (nothing is recorded)'}
      </Button>
      {scanner.testMode && (
        <div className="rounded-2xl bg-white/50 p-3 text-sm dark:bg-white/5" aria-live="polite">
          {!c ? (
            <p>Waiting for a scan…</p>
          ) : (
            <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-1">
              <dt className="muted">Received</dt><dd>{fmtTime(c.at)} via {c.source === 'serial' ? 'USB serial' : 'keyboard mode'}</dd>
              <dt className="muted">Recognised as</dt><dd className={c.direction ? 'font-bold text-emerald-700' : 'font-bold text-rose-600'}>{c.label}</dd>
              <dt className="muted">Length</dt><dd>{c.length} characters</dd>
              {c.durationMs != null && <><dt className="muted">Typed in</dt><dd>{c.durationMs} ms</dd></>}
              <dt className="muted">Caps Lock</dt><dd>{c.capsLock ? 'ON — turn it off' : 'off'}</dd>
            </dl>
          )}
          {c && !c.direction && <p className="mt-2 text-rose-600">Not recognised as a gate pass QR. If you scanned a gate pass, check the keyboard layout (Windows → English (United States)) and the scanner's suffix setting.</p>}
        </div>
      )}
      {scanner.inputProblem && <p className="text-sm text-amber-700">Last input problem: {scanner.inputProblem.title} — {scanner.inputProblem.action}</p>}
    </Card>
  );
}
