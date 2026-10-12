# VEXON / CampusConnect — Security Hardening & QA Report

Branch: `security-qa-audit` (uncommitted — nothing committed or pushed).
Date: 2026-10-12. Scope: `server/` (Express + Mongoose), `client/` (React + Vite), `mobile/` (Expo, touched only where an API contract changed).

This report covers two passes on the same branch:

1. **Security / QA audit pass** (earlier session) — findings A–I below, guarded by `server/tests/security-qa-audit.test.js`.
2. **Defense-in-depth hardening pass** (CLAUDE.md layers 1–7) — guarded by `server/tests/defense-in-depth.test.js`.

## 1. Results

| Check | Result |
|---|---|
| Server test suite (`npm test --prefix server`) | **Pass — 627 / 627** (final run, 29 min) |
| Test files / test cases | 66 files / 627 test cases |
| New regression tests this branch | 31 (13 in `security-qa-audit.test.js`, 18 in `defense-in-depth.test.js`) + 6 rewritten Outing tests |
| New tests failing on the old code (HEAD) | 14 of 18 in `defense-in-depth.test.js` fail on HEAD and pass now; the other 4 (token tampering, refresh-token replay, revoked/expired session, no raw-HTML sinks) are *verification* tests for controls that already held |
| Client build (`npm run build --prefix client`) | **Pass** (Vite, 20.8 s) |
| `npm run verify:bundle` | **Pass** — 89 files scanned, no secrets, no source maps |

## 2. Vulnerabilities found and fixed

| # | Severity | Module / role | What it was | Fix | Regression test |
|---|---|---|---|---|---|
| A | High | Alumni (mentorship, jobs, events) — alumni role | Student email, phone and roll number were returned to alumni on mentorship requests, job applications and event attendee lists; alumni contacts ignored the alumnus's own privacy level | `redactParties()` in `utils/alumniPrivacy.js` applied to every alumni-network response and socket emit; roll / employee numbers never populated | `security-qa-audit` A1–A3 |
| A4 | Medium | Alumni directory — any viewer | Directory search matched hidden email addresses → "does x@y have an account?" oracle | Non-admins search by name only | A4 |
| A5 | Medium | Alumni CSV export — HOD | Export ignored privacy (HOD got hidden phone numbers) | Export runs through `batchApplyPrivacy` | A5 |
| B | Medium | All CSV exports — staff | CSV / formula injection (`=HYPERLINK(...)` in a company name executes in Excel); unquoted cells broke columns | One `utils/csv.js` writer: quotes, doubles `"`, prefixes leading `= + - @ \t \r` | B, A3, A5 |
| C | **High** | Day-scholar Outing — student | Parent-verification OTP was sent to `req.body.parentPhone` — the student could type their own number and approve their own outing | Always `req.user.parentPhone`; 422 if none on file; typed field ignored (web + mobile forms show the registered number read-only) | C; `day-scholar-outing*.test.js` (rewritten) |
| D | Medium | Mass outpass — principal | Hostellers with no parent number got a hard-coded `9876543210`, so exit SMS went to a stranger | Skipped and reported (`missingParentPhone`) | D |
| E | Medium | Gate pass (normal + emergency) — student | Double-submit race created two open passes | Check-and-create under the per-student lock | E |
| F | Medium | Gate pass — faculty | A Section-A in-charge of 3rd year could list / open 1st-year Section-A passes | Year-scoped listing; `canView` = exactly what the faculty's queue lists (class faculty, or same section and — with an in-charge year — same year); parent number stays masked for non-assigned faculty | F; `outpass-otp.test.js` |
| G | **High** | CSRF — all browser writes | Double-submit check ran only when *both* cookie and header were present → omitting the header bypassed it | Missing cookie **or** header = 403 for any browser request (cookie credential or `Sec-Fetch-Site`); constant-time compare; mobile + token-issuing endpoints exempt | G; L2.3 |
| H | Low | Alumni jobs — student | Search replaced the `$or` that hides expired jobs | `$and` of both conditions | H |
| I | High | Login — attacker | Parallel wrong passwords all read the same `failedLogins` and raced past the 3-strike lock | Per-account sign-in lease (`User.loginBusyUntil`) | I |
| L1.2 | Medium | SMS gateway | Default `SMS_API_URL` was `http://` — API key, parent number and OTP in clear text | `https://` default; production refuses non-https (503, nothing sent) | L1.2 |
| L2.4 | Low | Session cookies | Cookies could be shadowed by a sibling subdomain / plain-HTTP response | Production names `__Secure-cc_refresh` (Path=/api/auth) and `__Host-cc_csrf` (Path=/, Secure, no Domain), read via one helper each | L2.4 |
| L2.5 | Medium | Login throttling | IP and unknown-email counters lived in process memory: reset by every restart/deploy, not shared between instances | `LoginThrottle` collection, atomic `$inc`, SHA-256 keys (no raw IP/email stored), TTL index; same thresholds and messages | L2.5a, L7.17b |
| L3.7b | Low | Chat / complaints attachments | `/uploads/../x` links accepted (no traversal check, unlike other validators) | `insideUploads()` applied | L3.7b |
| L4.8 | Low | Static serving | SPA fallback returned `index.html` (200) for any path, e.g. `/.env`, `/server/src/config/env.js`; source maps would have been served | Paths that look like files → 404; `*.map` refused; dotfiles ignored. No backend file was ever readable — this removes the misleading 200s and map exposure | L4.8 |
| L5.14 | Medium | Event attendance — faculty coordinator | A coordinator's mark silently replaced attendance already recorded by period teachers for the student's whole day; "present" overwrites had no history | 409 `requiresConfirmation` unless `confirmOverwrite: true`; every overwritten record gets a history entry; class in-charge notified of overrides | L5.14 |
| L6.16 | Medium | Dev OTP portal | `DEV_OTP_PORTAL=true` in `render.yaml` exposed live parent OTPs at `/dev/otp` in production | Always 404 in production; `render.yaml` set to `"false"` | `outpass-otp.test.js`, L6.16 |
| L7.17 | Medium | Rate limiting / lockout | `trust proxy` only set when `TRUST_PROXY` existed; without it every visitor shares the proxy IP (one attacker locks everyone out) | Hop count, default 1 in production, never `true`, off in development | L7.17, L7.17b |
| L1.1 | Low | Transport | HSTS was helmet's default in every environment (pins plain-HTTP campus/dev hosts) | Production only, `max-age=31536000; includeSubDomains` | L1.1 |
| L4.11 | Medium | Repository | `CampusConnect_Profiles_Directory.pdf` (personal data) committed; generator wrote into the repo and a personal Windows path | PDF deleted from working tree; `/*.pdf` and `server/.env*` ignored; script writes only to a CLI path / OS temp and refuses repo paths | L4.11 |

**By severity (fixed):** Critical 0 · High 4 (A, C, G, I) · Medium 13 · Low 5.

### Attack scenarios (short)

- **C — self-approved outing:** student submits an Outing with their own number in `parentPhone`; the "parent" OTP arrives on their phone; they read it to the in-charge → outing approved without the parent.
- **G — CSRF bypass:** attacker page auto-submits a form `POST /api/auth/logout` (or any cookie-authenticated write) without `X-CSRF-Token`; the old check was skipped when the header was absent.
- **I — lockout race:** 30 parallel guesses each read `failedLogins = 0` and only one increment survived; the 3-strike lock never fired.
- **A — data scraping:** any alumnus who posts a job receives every applicant's email, phone and roll number.
- **L2.5 — lockout reset:** each Render redeploy / restart (or a second instance) wiped the IP throttle, giving an attacker fresh attempts.
- **L7.17 — lockout DoS:** with the proxy untrusted, all users share one IP; 10 failures from anyone locked out the whole college for 5–60 minutes.

## 3. Verified controls (no change needed)

- Access tokens: HS256 pinned; tampered role/sub, foreign signature, `alg: none`, HS512 all rejected; role is always read from the database (a validly-signed "admin" claim for a student is still 403) — L2.6a.
- Refresh rotation: replaying a rotated-out `jti` revokes the session; the session's newer tokens die too (web: `auth.test.js`, mobile: L2.6b).
- Revoked / expired sessions cannot refresh, call the API or open Socket.IO — L2.6c.
- No `dangerouslySetInnerHTML` / `innerHTML` / `eval` in `client/src`; the assistant's Markdown renderer builds React elements and links only `http(s)`. **DOMPurify was not added** because there is no HTML sink to sanitise — adding an unused dependency would not reduce risk. CSP `script-src 'self'` (no `unsafe-inline` / `unsafe-eval`), `object-src 'none'` — L3.7.
- `express-mongo-sanitize`, the prototype-pollution / null-byte input guard, magic-byte upload validation, escaped search regexes, owner-scoped notifications: unchanged and present.
- No `import.meta.env.VITE_*` reference in `client/src` at all.

## 4. Ratings

### A) Product quality — **8 / 10**

Rubric: correctness (3), completeness (2), error handling (2), UX edge cases (1.5), test coverage (1.5).

| Area | Score | Notes |
|---|---|---|
| Correctness | 2.5/3 | Real logic bugs found: job search lost the deadline rule (H), duplicate gate passes (E), year-blind faculty scope (F), mass outpass invented numbers (D), event marks overwrote class records (L5.14) |
| Completeness | 2/2 | Every listed module works end-to-end; features were kept, not removed |
| Error handling | 1.5/2 | Consistent `ApiError` + 422 field errors; 409s for conflicts; some 401 messages vary by cause |
| UX edge cases | 1/1.5 | Confirmation now asked before overriding attendance; read-only parent number shown on Outing forms |
| Test coverage | 1/1.5 | ~610 integration tests across 66 files against a real MongoDB; no client unit tests; mobile untested |

- **Strengths:** very broad integration suite; server-side scoping helpers reused consistently (`academicScope`, `peopleScope`, `chatScope`); careful time-zone handling.
- **Top issues:** (Medium) event attendance overwrite without confirmation (fixed); (Medium) duplicate gate passes on double submit (fixed); (Low) search filter merge bug (fixed).
- **Test-suite fragility (Low):** `class-in-charge.test.js` signs in as web users, and the 2-minute web idle rule runs on the real clock. On a heavily loaded machine one full run hit 23 × 401 in that file. It passes on its own and in the other two full runs. Fix: send `/auth/activity` in its setup, or sign in as mobile.
- **To raise it:** client component tests (React Testing Library) for forms; mobile e2e smoke tests (Maestro/Detox); split `routes/index.js` (1,700+ lines) per module; suite runtime (>10 min) — parallelise with per-file databases.

### B) Security — **8 / 10**

Rubric: auth/session (2), access control & scoping (2), injection/XSS (2), data exposure (2), secrets handling (1), residual risk (1).

| Area | Score | Notes |
|---|---|---|
| Auth / session | 2/2 | HS256 pinned, session-bound tokens, rotation with reuse detection, idle timeout, persistent throttles, per-account lease, CSRF double-submit with `__Host-` cookie |
| Access control | 1.5/2 | Strong server-side scoping; two scope gaps found and fixed (F, A); scoping logic is spread across many controllers, so regressions remain possible |
| Injection / XSS | 2/2 | Mongo sanitize, escaped regexes, validated URLs, no HTML sinks, strict CSP, CSV formula neutralisation |
| Data exposure | 1.5/2 | Alumni over-sharing and OTP misrouting fixed; responses still return fairly wide user documents in places |
| Secrets | 0.5/1 | Bundle scan, gitleaks CI, no secrets in repo **now**, but the PII PDF is still in git history until you purge it |
| Residual risk | 0.5/1 | No WAF/DDoS edge yet; no MFA for admin; Atlas hardening unverified |

- **Strengths:** defense in depth on sessions; server-side enforcement everywhere (UI hiding is never the control); regression test per finding.
- **Top issues found:** (High) OTP to student-typed number; (High) CSRF header-missing bypass; (High) lockout race; (High) alumni PII exposure — all fixed.
- **To raise it:** purge the PDF from history and rotate anything it implies; Cloudflare WAF + rate rules; MFA (TOTP) for admin/principal/HOD; Atlas least-privilege user + IP allow-list; Dependabot + secret scanning; periodic ZAP results triage.

## 5. Per-module table

| Module | Works (Y/N) | Security notes | Worst issue (status) |
|---|---|---|---|
| Authentication & sessions | Y | Lockout race (I), CSRF bypass (G), in-memory throttles (L2.5), cookie prefixes (L2.4) | High — fixed |
| User / role management | Y | Scope-tampering tests exist; nothing new found | — |
| Announcements | Y | Audience tampering covered by existing tests | — |
| Clubs | Y | Social links rendered only if http(s) | — |
| Events (+ attendance integration) | Y | Overwrite without confirmation (L5.14) | Medium — fixed |
| Discussions | Y | Owner / moderator checks verified | — |
| Chat (private + group) | Y | Attachment traversal (L3.7b) | Low — fixed |
| Attendance | Y | Event override audit trail added | Medium — fixed |
| Timetable (incl. master) | Y | Role scoping covered by existing tests | — |
| OD / leave | Y | Document URL validated with `safeUrl` | — |
| Gate pass (all flows, OTP, QR, return/geofence) | Y | OTP misrouting (C), invented parent number (D), duplicates (E), year scope (F), `/dev/otp` in prod (L6.16) | High — fixed |
| SOS | Y | Existing hardening suite passes | — |
| Hostel | Y | — | — |
| Complaints (anonymous + escalation) | Y | Attachment traversal (L3.7b) | Low — fixed |
| Study materials / AI assistant | Y | Remote fetch allow-listed to Cloudinary (no SSRF); Markdown renderer safe | — |
| Alumni (directory, mentorship, jobs, events, chapters) | Y | PII exposure (A), email oracle (A4), CSV privacy (A5), job search (H) | High — fixed |
| Achievements | Y | CSV now via shared writer | Medium — fixed |
| Holidays | Y | — | — |
| Reports / PDF / CSV exports | Y | Formula injection (B) | Medium — fixed |
| Notifications | Y | Owner-scoped reads / deletes verified | — |
| Search | Y | Regexes escaped | — |
| Admin & security logs | Y | — | — |
| Keep-alive | Y | — | — |
| Static serving / deployment | Y | Fallback 200 for file paths, HSTS, trust proxy | Medium — fixed |

## 6. Coverage limits (honest scope)

This is a code review plus integration tests, not a full manual penetration test. Every module listed above has passing functional and authorization tests in the suite. In this pass, the modules marked "—" were checked by code review of their authorization paths and by the existing suites (`*-scope`, `*-security`, `*-hardening` tests); no new defects were found in them. No live production system or third-party service was attacked. The mobile app was changed only where an API contract changed, and was not built or run.

## 7. Intentionally NOT changed

- **DOMPurify not added** — no raw-HTML rendering exists in the web app; a guard test (L3.7) fails if one is ever introduced. Add DOMPurify at that point.
- **Bearer-only, non-browser requests are not CSRF-checked** — no cookie and no `Sec-Fetch-Site` means it is not a browser, so cross-site forgery is impossible; the mobile app works this way.
- **Refresh endpoint stays CSRF-exempt** (as specified): it is protected by `SameSite=Strict`, the Origin check, and rotation, and its response is unreadable cross-origin.
- **`Login_Security_Report.pdf`** (untracked, your file) was left in place; it is now ignored by `/*.pdf`.
- **Git history not rewritten** — commands below.
- **Older day-scholar tests** that asserted the student-typed number were rewritten to assert the new rule (required by item 15), not deleted.

## 8. Purge the profiles PDF from git history (run yourself — not run here)

```bash
# 1. Fresh mirror clone (filter-repo refuses a working clone with local changes)
git clone --mirror https://github.com/<owner>/<repo>.git cmp-purge.git
cd cmp-purge.git

# 2. Remove the file from every commit
pip install git-filter-repo        # once
git filter-repo --invert-paths --path CampusConnect_Profiles_Directory.pdf

# 3. Verify it is gone
git log --all --oneline -- CampusConnect_Profiles_Directory.pdf   # prints nothing

# 4. Force-push the rewritten history (coordinate with everyone who has a clone)
git push --force --mirror

# 5. Everyone re-clones; ask GitHub Support to purge cached views / PR refs.
```

## 9. Manual steps still required (outside the code)

1. **Cloudflare in front of Render:** proxied DNS, WAF managed rules (OWASP core set), rate-limiting rule on `/api/auth/*`, Bot Fight Mode, "Always use HTTPS". Then set `TRUST_PROXY=2` in Render (Cloudflare + Render hops).
2. **MongoDB Atlas:** encryption at rest (default on M10+; enable customer-managed key if required), least-privilege DB user (`readWrite` on the app DB only), network access allow-list (no `0.0.0.0/0`), automated backups with point-in-time restore, alerting.
3. **GitHub settings:** enable Dependabot alerts + security updates, secret scanning + push protection, branch protection requiring the `CI` and `Secret scan` checks.
4. **ZAP:** create a staging deployment and add repository secret `ZAP_STAGING_URL`.
5. **security.txt:** replace `security@example.edu` in `client/public/.well-known/security.txt` with the real contact; renew `Expires` yearly.
6. **SMS vendor:** confirm the vendor accepts `https://` (production now refuses `http://`); set `SMS_API_URL` if the URL differs.
7. **Rotate secrets** if there is any doubt about past exposure (JWT secrets, `SMS_API_KEY`, Groq key, Atlas password).
8. **After deploy:** users will sign in once more (cookie names change in production); this is expected.

## 10. Files changed in this branch

Server: `app.js`, `config/env.js`, `middleware/security.js`, `utils/tokens.js`, `utils/loginSecurity.js`, `models/LoginThrottle.js` (new), `models/User.js`, `utils/csv.js` (new), `utils/alumniPrivacy.js`, `controllers/authController.js`, `controllers/eventController.js`, `controllers/gatePassController.js`, `controllers/achievementController.js`, `controllers/alumni/*` (6 files), `routes/index.js`, `services/otp/providers/collegeSmsProvider.js`, `scripts/generateProfilesPdf.js`, `.env.example`.
Tests: `defense-in-depth.test.js` (new), `security-qa-audit.test.js` (new), `helpers.js`, `idle-session.test.js`, `outpass-otp.test.js`, `day-scholar-outing.test.js`, `day-scholar-outing-hard.test.js`.
Client: `vite.config.js`, `services/api.js`, `services/studyAssistant.js`, `pages/events/EventDetail.jsx`, `pages/gatepass/GatePass.jsx`, `pages/alumni/AlumniJobsTab.jsx`, `public/.well-known/security.txt` (new).
Mobile: `services/api.js`, `components/EventParticipants.js`, `app/(app)/gate-pass/new.js`.
Repo: `.gitignore`, `package.json` (`verify:bundle`), `scripts/verify-bundle.mjs` (new), `render.yaml`, `.github/workflows/{ci,secret-scan,zap-baseline}.yml` (new), `CampusConnect_Profiles_Directory.pdf` (deleted).
