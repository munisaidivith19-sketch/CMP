You are working in the VEXON / CampusConnect repo (Node/Express/Mongoose server in server/, React+Vite web in client/, Expo app in mobile/, Kotlin app in mobile-kotlin/). Fix the security issues below. Read CLAUDE.md first and follow its conventions.

RULES
- Fix each item fully on the server. Do not rely on hiding things in the UI.
- Every fix needs at least one new or updated test in server/tests/ (node --test) that fails before the fix and passes after.
- Do not break existing behaviour or tests. Run `npm test --prefix server` after each group and before finishing. All tests must pass.
- Keep changes minimal and focused. No unrelated refactors.
- Give me COMPLETE updated files for anything you change, not diffs.
- Commit each group separately with a clear message.

GROUP 1 — HIGH PRIORITY
1. Day-scholar outing OTP (server/src/controllers/gatePassController.js, POST /gate-pass/outing):
   Send the parent OTP ONLY to the parent number saved on the student's User record (same rule as normal gate passes). Ignore any phone number the student types. Remove the parentPhoneDiffers workaround. If the student has no registered parent phone, reject with a clear 422. Update day-scholar-outing*.test.js to match. Add a test proving a typed number is never used.
2. render.yaml: set DEV_OTP_PORTAL to "false". Fix the comment above OTP_SMS_ENABLED so it matches its value. Do not change any other env var.
3. OTP secrets (server/src/services/otp/otpService.js, server/src/config/env.js):
   a) Derive OTP HMAC and seal keys from a NEW env var OTP_SECRET, not from the JWT accessSecret. Production must refuse to start without it, like the other secrets. Add it to .env.example and to render.yaml with generateValue: true.
   b) Only store the decryptable copy (otpSealed) while OTP_SMS_ENABLED is false. When SMS is enabled, store the hash only, and the admin OTP view returns "delivered by SMS" without the code.
   Add tests for both.
4. Delete CampusConnect_Profiles_Directory.pdf from the repo root and add *.pdf at the repo root to .gitignore. In server/scripts/generateProfilesPdf.js, remove the hard-coded Windows path (C:\Users\GAUTHAM P\.gemini\...). Write the output only to a path given by a CLI argument, defaulting to the OS temp directory. Then tell me the exact git commands to purge that PDF from git history (git filter-repo). Do not run them.
5. SMS gateway (server/src/config/env.js and services/otp/providers/collegeSmsProvider.js): change the default SMS_API_URL to https://. In production, refuse to send if the configured URL is not https and log a clear error. Add a test.

GROUP 2 — MEDIUM PRIORITY
6. Alumni data minimization (server/src/controllers/alumni/*):
   Every .populate() that crosses roles must select only 'name avatar department year role designation title'. Never send phone, email or rollNo unless the viewer is the person themselves, admin, or same-department HOD. This covers job postedBy, event createdBy, mentorship requests and sessions, job applications, and event attendees and their CSV export. Apply alumniPrivacy.js rules to alumni contact fields everywhere they are returned. Add tests proving an alumnus cannot see a student's phone, email or roll number, and a student cannot see a hidden alumni phone.
7. Alumni directory search: never match the search term against email. Search name, company, designation, department and city only. Add a test.
8. CSV exports (alumni directory, event attendees, achievements and any other CSV): add one shared helper server/src/utils/csv.js that wraps cells in quotes, doubles any inner quotes, and prefixes a single quote to any cell starting with = + - @ tab or carriage return. Use it in every CSV export. Also make the alumni directory CSV respect privacy levels. Add tests.
9. CSRF (server/src/middleware/security.js): for browser write requests (POST/PUT/PATCH/DELETE), REJECT with 403 when the CSRF cookie or X-CSRF-Token header is missing or they don't match. Keep the existing exemptions: mobile clients, and the login/refresh/alumni-claim endpoints that issue the token. Check the web client always sends the header (client/src/services/api.js). Add tests: missing header returns 403, matching header passes, mobile is unaffected.
10. HSTS: in server/src/app.js, in production only, send Strict-Transport-Security: max-age=31536000; includeSubDomains via helmet. Add a test.
11. Cookie prefixes: in production, name the refresh cookie __Secure-cc_refresh (keep Path=/api/auth) and the CSRF cookie __Host-cc_csrf (Path=/, Secure, no Domain). Keep the current names in development. Read cookies through one helper so every code path uses the right name. Update tests.
12. Persistent lockouts (server/src/utils/loginSecurity.js): move the in-memory IP and unknown-email counters into a MongoDB collection with a TTL index, so they survive restarts and are shared between instances. Behaviour (thresholds, durations, messages) must stay identical. Existing lockout tests must still pass. Add a test that the counter persists.
13. Staff scoping: in mentorshipController getRequestById, an HOD may only read requests involving students of their own department (admin and principal unchanged). In alumniProfileController getAlumniProfile, a profile with showInDirectory=false is visible only to the owner and staff. Also: club_admin users are students, so allow them on student-only mentorship and job-apply routes. Add tests.

GROUP 3 — LOW PRIORITY
14. SOS (server/src/controllers/sosController.js, mobile/src/app/(app)/sos.js):
    a) Mobile SOS gets one GPS reading (expo-location, with permission prompt) and sends lat/lng/accuracy like the web version. If permission is denied, still send the alert without location.
    b) Make the 5-per-10-minutes flood cap atomic (e.g. an atomic counter document) so parallel requests can't bypass it.
    c) Exclude the alumni role from SOS broadcasts.
    d) Fix the mobile confirmation text so it only names roles that actually respond.
    Add tests for b and c.
15. client/vite.config.js: set build.sourcemap: false explicitly, and add esbuild: { drop: ['console','debugger'], legalComments: 'none' } for production builds only.
16. mobile-kotlin/app/build.gradle.kts: add a release signingConfig that reads keystore path, store password, key alias and key password from environment variables or ~/.gradle/gradle.properties, never from the repo. Fall back to unsigned with a warning if they are missing. Document the setup steps in mobile-kotlin/README.md. Make sure *.jks and *.keystore stay in .gitignore.

FINISH
- Run the full server test suite and `npm run build --prefix client`. Both must pass.
- Give me a summary table: item number, files changed, tests added, status.
- List anything you could not fix and why.