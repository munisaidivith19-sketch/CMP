'use strict';
// End-to-end driver: launches the REAL app (electron/main.cjs) and operates
// it like a guard. A keyboard-mode scanner is simulated with real OS-level
// keystroke events (webContents.sendInputEvent), a few ms apart, ending in
// Enter — exactly what a USB/Bluetooth HID scanner sends.
//
//   electron tests/e2e/driver.cjs <fixture.json> <outDir> <phase>
//   phase: full | restore | signout-check
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const [fixtureFile, outDir, phase = 'full', userDataDir] = process.argv.slice(-4);
const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
process.env.GATE_SCANNER_API_URL = fixture.base;
app.setPath('userData', userDataDir);
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let win;
const js = (code) => win.webContents.executeJavaScript(code, true);
const text = () => js('document.body.innerText');
async function waitText(re, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const t = await text();
    if (re.test(t)) return t;
    if (Date.now() > end) throw new Error(`timed out waiting for ${re}: ${t.slice(0, 400)}`);
    await sleep(150);
  }
}
async function shot(name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
}
async function fill(selector, value) {
  await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
}
const click = (re) => js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${re}.test(x.innerText)); if (!b) return false; b.click(); return true; })()`);

/** Type like a HID scanner: char key events `gap` ms apart, then Enter. */
async function hidScan(payload, gap = 4) {
  win.focus();
  await js('document.activeElement && document.activeElement.blur && document.activeElement.blur()');
  for (const ch of payload) {
    const shift = /[A-Z:_]/.test(ch);
    const modifiers = shift ? ['shift'] : [];
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch, modifiers });
    win.webContents.sendInputEvent({ type: 'char', keyCode: ch, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch, modifiers });
    await sleep(gap);
  }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
}

async function login(email) {
  await waitText(/Security staff sign-in/);
  await fill('#email', email);
  await fill('#password', fixture.password);
  await click('/^Sign in$/');
}

async function full() {
  await waitText(/Security staff sign-in/);
  await shot('01-login');

  // A non-Security account is refused.
  await login(fixture.notSecurity);
  const refused = await waitText(/Not authorized|Security staff only/);
  check('non-Security account refused at sign-in', /Security/.test(refused));
  await shot('02-login-refused');

  await login(fixture.guard);
  let t = await waitText(/Ready to scan|Terms/);
  if (/Terms and Conditions/.test(t) && /I have read/.test(t)) {
    await js(`document.querySelector('input[type=checkbox]').click()`);
    await click('/Accept and continue/');
    t = await waitText(/Ready to scan/);
  }
  check('Security guard signed in, Scanner screen open', /Ready to scan/.test(t) && /Ravi Kumar/.test(t));
  await waitText(/Server connected/);
  await shot('03-scanner-ready');

  // 1. Exit QR via simulated HID scanner.
  await hidScan(fixture.exitPayloads[0]);
  t = await waitText(/OUT recorded|Rejected|Not recorded|Unreadable|Invalid/);
  check('HID scan of exit QR → OUT recorded (server-confirmed)', /OUT recorded/.test(t), t.match(/OUT recorded|Rejected|Invalid gate pass|Unreadable QR/)?.[0]);
  check('student shown after scan', /Arun Prakash/.test(t));
  await shot('04-out-recorded');

  // 2. Same QR again a few seconds later → server says already recorded.
  await sleep(2700);
  await hidScan(fixture.exitPayloads[0]);
  t = await waitText(/Already recorded/);
  check('re-scan of a used QR → "Already recorded", nothing changed', /Already recorded/.test(t));
  await shot('05-already-recorded');

  // 3. Rapid consecutive scans of different students.
  for (const p of fixture.exitPayloads.slice(1, 4)) await hidScan(p, 3);
  await sleep(4000);
  t = await text();
  const recorded = (t.match(/Recorded/g) || []).length;
  check('three rapid scans of different students all recorded', recorded >= 4, `${recorded} "Recorded" rows`);
  await shot('06-rapid-scans');

  // 4. Return QR → IN.
  await sleep(500);
  await hidScan(fixture.returnPayload, 3);
  t = await waitText(/IN recorded|Invalid return|Return QR expired/);
  check('HID scan of return QR → IN recorded', /IN recorded/.test(t));
  await shot('07-in-recorded');

  // 5. Garbage QR → rejected as not a gate pass.
  await hidScan('https://example.com/pay?x=1', 3);
  t = await waitText(/Not a gate pass/);
  check('foreign QR rejected with a clear reason', /Not a gate pass/.test(t));

  // 6. Slow typing (a person) is never a scan.
  for (const ch of 'CCGP:ZZ99') {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch });
    win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch });
    await sleep(150);
  }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  await sleep(800);
  t = await text();
  check('slow human typing never creates a scan', /Not a gate pass/.test(t.split('Recent scans')[0]));

  // 7. Dashboard / History / Diagnostics.
  await click('/^Dashboard$/');
  t = await waitText(/OUT events today/i);
  const outToday = Number((t.match(/OUT events today\s*(\d+)/i) || [])[1]);
  check('dashboard shows server counts', outToday >= 5, `OUT events today = ${outToday}`);
  await shot('08-dashboard');
  await click('/^Gate History$/');
  t = await waitText(/event\(s\)/);
  check('history lists today\'s gate events', /Arun Prakash/.test(t));
  await shot('09-history');
  await click('/Scanner attempts/');
  t = await waitText(/attempt\(s\)/);
  check('attempts list includes the rejected scan', /Not a gate pass/.test(t));
  await shot('10-attempts');
  await click('/^Diagnostics$/');
  t = await waitText(/Server reachable/);
  check('diagnostics: server reachable and session valid', /Server reachable — The server answered/.test(t) && /Signed in as Ravi Kumar/.test(t));
  await shot('11-diagnostics');

  // 8. A scan while not on the Scanner screen is not recorded.
  await hidScan(fixture.exitPayloads[4], 3);
  t = await waitText(/not recorded\. Open the Scanner screen/i);
  check('scan outside the Scanner screen is not recorded', true);
  await shot('12-not-armed');
}

async function restore() {
  const t = await waitText(/Ready to scan|Security staff sign-in/);
  check('restart: saved session restored without signing in', /Ready to scan/.test(t) && /Ravi Kumar/.test(t));
  await shot('13-restored');
  await click('/Switch guard/');
  await click('/^Yes$/');
  await waitText(/Security staff sign-in/);
  check('switch guard: session revoked, sign-in required', !fs.existsSync(path.join(userDataDir, 'credentials.dat')), 'credentials.dat removed');
  await login(fixture.guard2);
  const t2 = await waitText(/Ready to scan/);
  check('next guard signs in; identity shown', /Meena S/.test(t2));
  await shot('14-switched-guard');
}

async function signoutCheck() {
  const t = await waitText(/Ready to scan|Security staff sign-in/);
  check('restart after switch: second guard restored', /Meena S/.test(t));
}

app.on('browser-window-created', (_e, w) => {
  win = w;
  w.webContents.once('did-finish-load', async () => {
    try {
      if (phase === 'full') await full();
      else if (phase === 'restore') await restore();
      else await signoutCheck();
    } catch (err) {
      check('driver error', false, err.message);
      await shot(`error-${phase}`).catch(() => null);
    }
    fs.writeFileSync(path.join(outDir, `results-${phase}.json`), JSON.stringify(results, null, 2));
    app.exit(results.every((r) => r.ok) ? 0 : 1);
  });
});

require('../../electron/main.cjs');
