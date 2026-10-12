You are performing an enterprise-grade, defense-in-depth security hardening pass on the VEXON / CampusConnect repo (Node/Express/Mongoose server in server/, React+Vite web in client/, Expo app in mobile/). The goal: make it as resistant to DATA THEFT as practical for an app this size — the layered approach large providers use. Read CLAUDE.md first and follow its rules. This is an authorized hardening pass on our own app.

GROUND RULES
- Work on a git worktree/branch. DO NOT commit, push, or force-push.
- Enforce every security rule SERVER-SIDE; never rely on hiding things in the UI.
- Do not weaken existing controls or delete tests to make things pass. Keep all features and business rules working.
- Give me COMPLETE updated files for anything you change, not diffs.
- Every fix needs a test in server/tests/ (node --test) that fails before and passes after. At the end run `npm test --prefix server` and `npm run build --prefix client`; both must pass.

LAYER 1 — ENCRYPT IN TRANSIT
1. In production, send HSTS: Strict-Transport-Security max-age=31536000; includeSubDomains (helmet.hsts).
2. SMS gateway (server/src/config/env.js + provider): default SMS_API_URL to https://, and in production refuse to send over non-https. Test.

LAYER 2 — AUTH / SESSION (prevent account takeover & session theft)
3. CSRF: in server/src/middleware/security.js, for browser write requests (POST/PUT/PATCH/DELETE) REJECT with 403 when the CSRF cookie OR X-CSRF-Token header is missing or they don't match — not only when both are present. Keep exemptions for the mobile client and the token-issuing endpoints (login, refresh, alumni-claim). Confirm client/src/services/api.js always sends the header. Tests: missing header → 403; mismatch → 403; valid → pass; mobile unaffected.
4. Cookies: in production, name the refresh cookie __Secure-cc_refresh (keep Path=/api/auth) and the CSRF cookie __Host-cc_csrf (Path=/, Secure, no Domain). Keep current names in dev. Read each cookie through one helper.
5. Make the IP and unknown-email login-lockout counters persistent (MongoDB + TTL index) instead of in-memory, so they survive restarts and scale across instances. Keep thresholds/messages identical. Test persistence.
6. Verify (add tests if missing): a token with a tampered role/sub is rejected (HS256-only); an old rotated refresh jti is rejected AND revokes the session; a revoked/expired session cannot refresh or open a Socket.IO connection.

LAYER 3 — INPUT DEFENSE (prevent injection / XSS data exfiltration)
7. Audit the web app for dangerouslySetInnerHTML or any raw HTML rendering of user/content data (chat, discussions, complaints, announcements, markdown). Sanitize with DOMPurify (safe-tag allow-list). Keep the strict CSP; confirm script-src has no 'unsafe-inline'/'unsafe-eval'. Keep express-mongo-sanitize and the prototype-pollution/null-byte input guard.

LAYER 4 — NO SECRET / BACKEND FILE LEAKAGE
8. Verify Express serves ONLY client/dist and /uploads — never server/, .env, config, or source maps. Add a test requesting /.env, /server/src/config/env.js, /render.yaml etc. and expecting 404.
9. client/vite.config.js: set build.sourcemap: false explicitly, and for production add esbuild: { drop: ['console','debugger'], legalComments: 'none' }. Confirm no import.meta.env.VITE_* secret is referenced in client/src (only the public API base URL is allowed).
10. Add a package.json script "verify:bundle" that greps built client/dist for secret patterns (gsk_, mongodb+srv://, SMS_API_KEY, GROQ, JWT_, SECRET, api keys) and fails if any match.
11. .gitignore: add *.pdf at repo root and server/.env* (keep .env.example). Delete the committed CampusConnect_Profiles_Directory.pdf from the working tree, and remove the hard-coded Windows path in server/scripts/generateProfilesPdf.js (write only to a CLI-arg path, default OS temp). Print the exact `git filter-repo` commands to purge that PDF from history — do NOT run them.

LAYER 5 — LEAST PRIVILEGE / DATA MINIMIZATION
12. Alumni (controllers/alumni/*): never return student phone/email/rollNo to alumni via mentorship, job applications, or event attendees; apply privacy levels to alumni contact fields everywhere; don't match directory search against hidden emails. Tests for each.
13. CSV exports: one shared helper that quotes/escapes cells and neutralizes leading = + - @ (formula injection); use it in every export; respect privacy in the alumni CSV. Test.
14. Event attendance: require a confirmation flag or an audit-log entry visible to the class in-charge before an event coordinator's marking rewrites a student's full-day academic attendance. Keep the feature; add the guard + test.

LAYER 6 — CLOSE REMAINING LEAKS
15. Day-scholar outing OTP: send only to the parent number on the student's account (req.user), never req.body.parentPhone. Remove the typed-number path; reject if no registered parent phone. Test.
16. render.yaml: set DEV_OTP_PORTAL to "false"; make /dev/otp return 404 in production regardless; fix the OTP_SMS_ENABLED comment.

LAYER 7 — EDGE / SUPPLY-CHAIN (in-repo parts)
17. Confirm `app.set('trust proxy', ...)` is correct so rate limiting sees the real client IP behind a reverse proxy / Cloudflare.
18. Add .github/workflows: (a) CI running `npm audit --audit-level=high` + the server test suite on PRs; (b) a gitleaks secret-scan job; (c) a scheduled OWASP ZAP baseline scan against a staging URL stored as a repo secret placeholder. No real secrets in the repo.
19. Add public/.well-known/security.txt with a vulnerability-report contact (placeholder email).

FINISH
- Run the server tests, the client build, and verify:bundle. All must pass.
- Summary table: layer, item, files changed, test added, status.
- List the steps I must do myself outside the code (Cloudflare WAF/DDoS in front of the site; MongoDB Atlas encryption-at-rest + least-privilege DB user + automated backups; enabling Dependabot + secret scanning in GitHub repo settings) and anything you couldn't fix.



You are acting as a SENIOR SOFTWARE QA ENGINEER and a SENIOR APPLICATION SECURITY TESTER for the VEXON / CampusConnect project (Node/Express/Mongoose server in server/, React+Vite web in client/, Expo app in mobile/). This is an authorized audit of our own application. Read CLAUDE.md first and follow its rules.

OBJECTIVE
Test the entire application module by module — both as a product (does it work correctly) and as a security target (can it be attacked) — fix the real issues you find, then give me a professional rating for product quality and for security, with evidence.

GROUND RULES
- Work on a git worktree/branch. DO NOT commit, push, or force-push.
- Enforce every rule SERVER-SIDE. Never trust the frontend, query params, headers, or hidden fields.
- For every real bug or vulnerability: find it, reproduce it with a failing test in server/tests/ (node --test), fix the ROOT CAUSE, then confirm the test passes. Do NOT hide errors, weaken validation, or remove features to make tests pass.
- Give me COMPLETE updated files for anything you change, not diffs.
- At the end, run the full server test suite and `npm run build --prefix client`; both must pass. Report the numbers.

PHASE 1 — RECONNAISSANCE
Build an inventory of every module, route, role, and dashboard before testing. Roles: student, club_admin, faculty, hod, principal, admin, security, dean, ao, chairman, warden, alumni.

PHASE 2 — PRODUCT / FUNCTIONAL QA (test EVERY module)
Modules to test: authentication & sessions, user/role management, announcements, clubs, events (incl. attendance integration), discussions, chat (private + group), attendance, timetable (incl. master timetable), OD/leave, gate pass (normal, emergency, mass outpass, bind groups, parent OTP, QR, return/geofence), SOS, hostel, complaints (incl. anonymous + escalation), study materials, AI Study Assistant, alumni (directory, mentorship, jobs, events, chapters), achievements, holidays, reports/PDF exports, notifications, search, admin & security logs, keep-alive.
For each module test: happy path, empty/invalid/null/wrong-type inputs, missing fields, duplicate/double submissions, wrong IDs, deleted resources, pagination/filter/sort correctness, counts/totals, error messages, and failure recovery. Fix real bugs.

PHASE 3 — SECURITY / PENETRATION TESTING (every module, server-side)
For each endpoint and socket event test: missing auth, expired/forged/revoked token, wrong role, object-level authorization (IDOR/BOLA), horizontal and vertical privilege escalation, cross-department / cross-year / cross-section / cross-user access, parameter/body/header/path tampering, mass assignment, NoSQL/operator injection, prototype pollution, regex abuse, race conditions and replay (tokens, OTPs, QR codes, approvals), CSRF (including header-missing bypass), CORS and security headers, XSS/HTML injection in rendered content, file upload abuse (MIME/magic-byte/path-traversal/oversized), unauthorized downloads/exports/PDF generation, rate-limit weaknesses, session fixation/stale authorization, and information leakage in errors. Also verify: no secret/.env/backend file is reachable from the browser, no secret ships in the client bundle, sensitive data isn't over-shared in API responses. Fix every confirmed vulnerability (root cause + regression test). Do not stop at the first finding in a module.

PHASE 4 — REGRESSION
Re-run the complete test suite, the security tests you added, and the client build. Re-test anything your fixes touched. Everything must pass.

PHASE 5 — RATING (this is a required deliverable)
Produce two ratings out of 10, each with a short rubric and justification — not arbitrary numbers:
A) PRODUCT QUALITY rating /10 — based on correctness, completeness, error handling, UX edge cases, and test coverage.
B) SECURITY rating /10 — based on auth/session, access control & scoping, injection/XSS defense, data exposure, secrets handling, and remaining risk.
For EACH give: the score, the top 3 strengths, the top issues found (with severity Critical/High/Medium/Low), and what would raise the score.
Also give a per-module table: module | works correctly (Y/N) | security notes | severity of worst issue.

FINAL REPORT (write it to a file in the repo, e.g. SECURITY_QA_REPORT.md, AND print a summary)
Include: modules audited, total functional bugs found/fixed, total vulnerabilities found/fixed by severity, tests added, existing tests passed (count), client build result, the two ratings with justification, the per-module table, what you intentionally did NOT change and why, remaining risks, and manual steps still required (e.g. Cloudflare, Atlas encryption, deployment config). For each vulnerability include: what it was, affected module/role, attack scenario, root cause, fix, and the regression test that now guards it.