/**
 * Short, guard-friendly explanations: what happened and the next safe action.
 * Covers client-side problems (connection, session, scanner) and the server's
 * scan codes. Never contains endpoints, stack traces or credentials.
 */

const E = (title, action, tone = 'error') => ({ title, action, tone });

/** Connection / session / client problems, by error kind (electron/apiClient.cjs). */
export const PROBLEMS = {
  offline: E('Server unreachable', 'Check the network cable or Wi-Fi. Scans are NOT recorded while offline — use the manual gate register.'),
  no_internet: E('No internet connection', 'This PC cannot reach the internet. Check the network, then open Diagnostics.'),
  timeout: E('The server is not answering', 'Wait a moment. If a scan shows “Checking…”, do not scan that student again until it settles.', 'warning'),
  tls: E('Secure connection failed', 'The server certificate could not be verified. Check the PC date and time, then contact IT. Do not continue on this network.'),
  auth: E('Signed out', 'Your session ended (expired, signed out elsewhere, or password changed). Sign in again.'),
  session_ended: E('Signed out', 'Your session ended (expired, signed out elsewhere, or password changed). Sign in again.'),
  role: E('Not authorized', 'This account is not (or no longer) a Security account. Sign in with a Security account.'),
  scope: E('Not available here', 'The Gate Scanner only handles gate scanning. Use the J.N.N portal for anything else.'),
  terms: E('Terms acceptance needed', 'Read and accept the Terms and Conditions to continue.', 'warning'),
  password: E('Password change required', 'This account has a temporary password. Change it in the J.N.N portal, then sign in here.'),
  maintenance: E('Under maintenance', 'The college portal is in maintenance. Use the manual gate register until it is back.', 'warning'),
  rate: E('Too many scans too quickly', 'Wait a few seconds, then scan again.', 'warning'),
  server: E('Server error', 'The scan could not be processed. Try again; if it repeats, use the manual register and report it to IT.'),
  locked: E('Account locked', 'Too many failed sign-ins. Wait for the time shown, or ask an Admin.'),
  validation: E('Request refused', 'Check what was entered and try again.', 'warning'),
  forbidden: E('Not allowed', 'This account cannot do that.'),
  notfound: E('Not found', 'It may have been removed. Refresh and try again.', 'warning'),
  caps_lock: E('Caps Lock is on', 'Turn Caps Lock off, then scan the return QR again.', 'warning'),
  not_recorded: E('Not recorded', 'The scan never reached the server. Scan again.', 'warning'),
  unconfirmed: E('Result uncertain', 'Open Gate History and search for the student before scanning again.', 'warning'),
  storage: E('Session not saved', 'Windows secure storage is unavailable, so you will need to sign in again after restarting the app.', 'warning'),
};

/** Server scan codes (server/src/controllers/gateScannerController.js). */
export const SCAN_CODES = {
  EXIT_RECORDED: E('OUT recorded', 'The student may leave.', 'success'),
  RETURN_RECORDED: E('IN recorded', 'The student is back inside.', 'success'),
  ALREADY_RECORDED: E('Already recorded', 'This QR was just used. Nothing was changed.', 'warning'),
  ALREADY_USED: E('Pass already used', 'This gate pass has already been used. Do not let the student pass on it.'),
  UNKNOWN_CREDENTIAL: E('Invalid gate pass', 'The code is invalid, expired or already used. Ask the student to check their gate pass in the app.'),
  UNKNOWN_RETURN: E('Invalid return QR', 'Ask the student to open their gate pass and verify their location again for a fresh Return QR.'),
  RETURN_EXPIRED: E('Return QR expired', 'Ask the student to verify their location again for a fresh Return QR.'),
  NOT_OUTSIDE: E('Not waiting for a return', 'This pass has no exit recorded, or was already completed.'),
  NOT_YET_OPEN: E('Too early to leave', 'The pass is not valid yet. Check the time shown.'),
  EXPIRED: E('Pass expired', 'This gate pass is no longer valid.'),
  REVOKED: E('Pass revoked', 'This gate pass was revoked. Do not let the student pass.'),
  NOT_APPROVED: E('Not approved', 'This gate pass has not been fully approved yet.'),
  NOT_VALID: E('Pass not valid', 'Do not let the student pass on this gate pass.'),
  INVALID_PAYLOAD: E('Unreadable QR', 'The QR was read incompletely. Ask the student to brighten the screen and scan again.', 'warning'),
  NOT_A_GATE_PASS: E('Not a gate pass', 'This QR is not a J.N.N gate pass. Ask for the gate pass QR in the app.', 'warning'),
  CODE_NEEDS_DIRECTION: E('Choose Exit or Return', 'Select whether the typed code is an exit code or a return code.', 'warning'),
  NOT_RECORDED: E('Not recorded', 'The scan was interrupted before it was saved. Scan again.', 'warning'),
};

/** Scanner-input problems (hidWedge.js / serialFraming.js). */
export const INPUT_PROBLEMS = {
  too_short: E('Incomplete scan', 'Only part of a code arrived. Scan again, holding the phone steady.', 'warning'),
  too_long: E('Unreadable scan', 'The scanner sent more data than any gate pass QR. Scan the gate pass QR again.', 'warning'),
  no_terminator: E('Scanner suffix mismatch', 'The scanner did not send the expected ending key. Check “Scan ending key” in Diagnostics → Scanner setup.', 'warning'),
  incomplete: E('Incomplete scan', 'The serial port closed in the middle of a scan. Scan again.', 'warning'),
};

export function explainProblem(kind, message) {
  const base = PROBLEMS[kind] || PROBLEMS.server;
  return { ...base, detail: message || null };
}

/** A finished (or failed) scan job → what the result panel shows. */
export function explainJob(job) {
  if (!job) return null;
  if (job.state === 'sending' || job.state === 'queued') return { title: 'Recording…', action: 'Wait for the result before the student passes.', tone: 'pending' };
  if (job.state === 'uncertain') {
    return job.error?.kind === 'unconfirmed' ? { ...PROBLEMS.unconfirmed, detail: job.error.message } : { title: 'Checking…', action: 'The connection dropped while saving. Confirming with the server — do not scan this student again yet.', tone: 'pending' };
  }
  if (job.state === 'failed') return explainProblem(job.error?.kind, job.error?.message);
  const code = job.result?.code;
  const known = SCAN_CODES[code];
  const tone = job.state === 'success' ? 'success' : job.state === 'duplicate' ? 'warning' : known?.tone === 'warning' ? 'warning' : 'error';
  return { ...(known || { title: job.state === 'success' ? 'Recorded' : 'Rejected', action: '' }), tone, detail: job.result?.message || null };
}
