import { ApiError } from '../utils/http.js';

// What a Windows Gate Scanner session may reach, after protect. Sign-in,
// refresh and sign-out are public routes and stay open. Everything else —
// the rest of the portal — is closed to it, so a token kept on a shared gate
// PC can only ever be used to scan, see the gate dashboard and history.
const GATE_DESKTOP_OPEN = [/^\/gate-scanner(\/|$)/, /^\/auth\/me$/, /^\/legal\/(status|accept)$/];

/** Deny-by-default for gate_desktop sessions; every other client passes untouched. */
export function gateDesktopScope(req, _res, next) {
  if (req.sessionClient !== 'gate_desktop') return next();
  const path = req.path.replace(/\/+$/, '') || '/';
  if (GATE_DESKTOP_OPEN.some((re) => re.test(path))) return next();
  return next(new ApiError(403, 'The Gate Scanner cannot open this part of the portal.', undefined, { code: 'GATE_SCANNER_SCOPE' }));
}
