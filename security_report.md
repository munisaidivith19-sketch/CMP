# VEXON security audit — run-1 report

## 1. Run facts

- **Target:** `D:/POJECTS/AI ATDDENCE/CMP` (branch `fix/csrf-legacy-cookie`, commit `af623fb5be25553f3d662e7b30a5747e737d86de`). The worktree was dirty: the as-is working tree was reviewed, so findings refer to it rather than to the commit alone.
- **Profile:** `standard`. **Scope:** `server`, `client`, `mobile-kotlin`, `mobile-ios`, `mobile`, `render.yaml`, `.github`. **Budget:** none set.
- **Execution policy:** sandboxed source-and-local-only. **No OS-enforced sandbox was available** (Docker daemon stopped; Windows Home has no Windows Sandbox). As a result, no target code was executed and every check is a source review. No finding could reach `confirmed`, which requires a reproduced bounded local result. Every surviving candidate is therefore `needs_validation` with an exact local test plan.
- **Prior runs:** none. This is the first ledger for this target, so no earlier coverage was carried or suppressed.
- **Out of scope / deferred:** 0 deferred units, 0 out-of-scope units, 0 blocked units. Deployed endpoints, the Render dashboard environment, the SMS vendor and released APK/IPA binaries were not observed (by design).
- **Hunting:** 6 waves. The critics ran after every wave. Post-wave critics added 7 units in wave 2, 3 in wave 3, 1 in wave 4 (a separate root cause raised by a Phase 3 verifier), 2 in wave 5 and 1 in wave 6. The post-wave-3 and post-wave-6 critics returned no gaps. A distinct final-clean critic then ran: it found no missing units and no reassignments (stop: true), so coverage is complete for this run within its source-only limits.
- **Validation:** every candidate went through an independent Phase 3 verifier and then a separate fresh Phase 5 record verifier. Phase 5 results: 21 verified as written, 5 with non-material line/wording corrections applied.

## 2. Security posture summary

VEXON's core authentication is sound in source: HS256 access tokens bound to a server-side Session row, rotating refresh tokens with reuse detection, a SameSite=Strict refresh cookie, double-submit CSRF with an Origin allowlist, roles re-read from the database, and step-up re-authentication for Super Admin. No source path to unauthenticated code execution, full database access or arbitrary account takeover was found. The weaknesses are concentrated in three places. (1) Scope checks are spread across many controllers, so several staff features read or act on records outside the caller's own section or department. (2) State-machine handlers check who the caller is but not the record's current state, so moderation and removal can be undone or skipped. (3) There are edge-of-system gaps: an exported Android activity that turns an intent extra into an authenticated API call, plain-HTTP SMS allowed by the production manifest, a public lockdown gate that trusts any Bearer header, and a login throttle that resets on the attacker's own successful logins. Separately, the unauthenticated `/uploads` route serves sensitive attachments to anyone who has the link. None of these could be confirmed by execution in this run.

## 3. Confirmed findings

**None.** No finding could be confirmed in this run, because confirmation requires a sandboxed local reproduction and no sandbox was available. This is not evidence that the leads below are false. Each is a complete, source-traced path whose decisive remaining step is a bounded local test.

## 4. NEEDS VALIDATION (26 leads, in recommended remediation order — no severity assigned)

| # | Lead | Entry → sink | Exact blocker (besides the missing sandbox) | Bounded local next step |
|---|---|---|---|---|
| 1 | **Exported Kotlin MainActivity turns an untrusted notificationId intent extra into an authenticated PATCH to an attacker-chosen VEXON API path**<br>`kotlin-mainactivity-notificationid-extra-path-injection` | `mobile-kotlin/app/src/main/AndroidManifest.xml:54` → `server/src/controllers/alumni/alumniProfileController.js:346` | OkHttp 4.12.0 HttpUrl dot-segment resolution and '?' handling for the concatenated path must be observed with the pinned library rather than inferred from source. / The final merged manifest of the built/released APK must be observed to confirm MainActivity remains exported without a protecting permission after manifest merge. / Whether Chrome or other browsers deliver S.vexon.notificationId string extras from an intent: URI to this activity (remote, user-click variant) is an Android/browser runtime fact not visible in source; the local malicious-app variant does not depend on it. / Requires a signed-in user (Auth.user != null) when handleLink runs; on a cold start session restore may be asynchronous and the extra may be dropped, so the reliable path is a warm/backgrounded app receiving onNewIntent (singleTask). | In an isolated emulator with a debug build pointed at a local test server seeded with dummy data: (1) JVM unit test (app/src/test) asserting that ("http://10.0.2.2:5000/api" + "/notifications/../alumni/000000000000000000000001/verify?x=/read").toHttpUrlOrNull(… |
| 2 | **Security guards can read every pending gate pass college-wide via the dashboard, and any pass in any state by ID, including parent and student phone numbers**<br>`gatepass:security-role-unscoped-pass-read` | `server/src/routes/index.js:1836` → `server/src/controllers/gatePassController.js:1359` | The product owner needs to confirm that security staff should not see pending passes, or open non-approved passes by ID, along with the full parent and student contact numbers. The source comment at routes/index.js:1772, test F4, GUARD_STUDENT_FIELDS and the /users/:id 403 for security all indicate they should not. | In the mongo test harness (for example a new test in server/tests/security-audit.test.js using the existing security and student fixtures), create a GatePass with status 'pending_faculty' for a dummy student in another department. Give it parentPhone '90000000… |
| 3 | **Job poster can undo a staff removal (or skip moderation) by closing and then reopening the job**<br>`alumniJobsController.closeJob:missing-status-precondition` | `server/src/routes/alumniRoutes.js:277` → `server/src/controllers/alumni/alumniJobsController.js:261` | The pending_review variant applies only when ALUMNI_JOBS_REQUIRE_APPROVAL=true in the deployment. The reviewed source (render.yaml) does not set it, so by default only the staff-removal variant applies; the Render dashboard environment has not been observed. | In a sandboxed test run against a disposable MongoDB, add a test after alumni-security.test.js:97-104. The alumni fixture POSTs /alumni/jobs with jobBody (expect 201). The hod fixture DELETEs /alumni/jobs/:id with body { reason: 'Misleading posting' } (expect … |
| 4 | **Production manifest allows plain-HTTP SMS, which would send the vendor API key, parent numbers and gate-pass OTPs unencrypted**<br>`render.yaml:SMS_ALLOW_INSECURE_HTTP:collegeSmsProvider-cleartext-apikey` | `server/src/controllers/gatePassController.js:751` → `server/src/services/otp/providers/collegeSmsProvider.js:64` | The real SMS_API_URL value in the Render dashboard (sync: false) is not visible in source. The code default is https://, so whether the deployed value is http:// has to be observed by the owner. / Whether the vendor offers an HTTPS endpoint, and whether it IP-restricts or scopes the API key, is an external vendor fact. / The exploitability depends on an attacker holding an on-path network position between Render egress and the vendor, which source cannot establish. | In an isolated sandbox with no external network and dummy values: NODE_ENV=production, the required dummy secrets, OTP_SMS_ENABLED=true, SMS_ALLOW_INSECURE_HTTP=true, SMS_API_KEY=dummykey, SMS_SENDER_ID=TEST, SMS_OTP_TEMPLATE_ID=1, SMS_EXIT_TEMPLATE_ID=2, SMS_… |
| 5 | **Any 'Authorization: Bearer <anything>' header gets past the public-route maintenance/lockdown gate**<br>`public-platform-gate-unverified-bearer-bypass` | `server/src/routes/index.js:302` → `server/src/controllers/alumni/alumniImportController.js:436` | Only the missing sandbox. | Inside an isolated sandbox with a throwaway mongo:7 test DB and no external network, add a test in server/tests modelled on the super-admin tests. (1) Set the PlatformState document {_id:'platform'} to mode 'lockdown' and call invalidatePlatformCache(). (2) In… |
| 6 | **An attacker's own successful logins reset the per-IP sign-in throttle, so it never limits password spraying from one IP**<br>`loginSecurity:clearIpFailure-success-decay-bypasses-ip-throttle` | `server/src/routes/index.js:286` → `server/src/utils/loginSecurity.js:124` | The number of deployed Render instances (which multiplies the in-memory authLimiter bound) and any edge or WAF per-IP rate limit in front of /api/auth/login are not visible in source; an upstream limit would add an independent per-IP bound. | Inside an approved sandbox with a throwaway mongo test DB, follow the server/tests supertest pattern. Create dummy attacker user A with a known password and 9 dummy victim users. From one IP (supertest default), loop 9 times: POST /api/auth/login for victim[i]… |
| 7 | **Login 'attempts remaining' value reveals which emails have accounts: the unknown-email counter is per IP with a 2h idle TTL, while the real account counter is global and kept for 24h**<br>`loginSecurity:anon-counter-scope-diverges-from-account-counter-enumeration` | `server/src/routes/index.js:286` → `server/src/controllers/authController.js:323` | Owner policy fact: whether the existence of an @jnn.edu.in account address is treated as confidential. Institutional email formats may already be predictable, which lowers the impact. | Use the existing server test harness (supertest + test MongoDB) with app trust proxy = 1. Create a dummy user u@test.local. Send POST /api/auth/login {email:'u@test.local', password:'wrong'} with X-Forwarded-For: 10.0.0.1, then send the same request with X-For… |
| 8 | **Login CSRF: Origin 'null' skips the Origin allowlist on CSRF-exempt POST /api/auth/login (alumni-claim variant narrower)**<br>`csrf-guard-null-origin-exempt-auth-login` | `server/src/app.js:167` → `server/src/controllers/authController.js:124` | Decisive browser behavior is not source-visible: whether current target browsers send Origin: null (and no Referer) on a no-referrer cross-site top-level form POST, and whether they store the __Secure-cc_refresh / __Host-cc_csrf SameSite=Strict cookies from that navigation's response. | In server/tests (following tests/csrf-self-heal.test.js) against the mongo:7 test DB, with a dummy active student whose password is known: send supertest POST /api/auth/login with headers {Origin: 'null', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'applic… |
| 9 | **SOC error capture keeps alumni invite-claim bearer tokens from the URL path and sends them to the AI provider**<br>`soc-route-template-keeps-path-bearer-tokens` | `server/src/routes/alumniRoutes.js:32` → `server/src/controllers/socController.js:190` | Who counts as an unauthorized reader is a policy question. Staff who import or resend invites already receive the raw claim URL. Whether Super Admin, SOC console viewers, or database/backup readers are outside the alumni-invite boundary is set by institutional policy, not by the source. The clearest outside reader is the Groq provider. / Groq retention and logging of ai-explain prompts is outside the repository. Whether a Super Admin ever runs ai-explain on such a row, and whether claim requests actually hit 429/403/5xx in production, can only be checked by the owner. | In a sandboxed server test harness (mongo:7, supertest, no network, mocked Groq): (1) Unit-test routeTemplate('/api/auth/alumni-claim/' + 'a1'.repeat(32)) and assert that the 64-hex segment is returned unchanged. (2) Create a pending AlumniInvite with a known … |
| 10 | **Department-scoped Staff Management view grant reads campus-wide staff and HOD contact data via role-assignments overview**<br>`vexon:role-assignments-overview:department-scoped-staff-grant-unscoped-read` | `server/src/routes/index.js:874` → `server/src/controllers/adminRoleAssignmentController.js:18` | Whether any deployed staff account actually holds staff_management.view at department scope (the Super Admin console allows saving it via staffCatalogue). | In a sandboxed copy using the server/tests staff-policies test style with a throwaway mongo: seed HOD A (dept CSE), faculty B (ECE, email set) and HOD H (ECE, phone set); as Super Admin after reauth PUT /api/admin/users/<A>/policies with [{module:'staff_manage… |
| 11 | **Faculty analytics returns low-attendance students from sections the faculty does not teach**<br>`server/src/controllers/analyticsController.js:facultyAnalytics:subject-level-scope` | `server/src/routes/index.js:2123` → `server/src/controllers/analyticsController.js:241` | Only the missing sandbox. | In an isolated test DB, create subject S (semester N, sections ['A','B']), faculty FA with a timetable slot for S section A only, faculty FB with a slot for S section B, and dummy student SB in section B with AttendanceRecords for S that are mostly absent. Aut… |
| 12 | **Faculty can list and approve attendance corrections for sections of a subject they do not teach (Subject.faculty membership used as authority)**<br>`server/src/controllers/attendanceController.js:reviewCorrection:subject-level-faculty-authority` | `server/src/routes/index.js:1360` → `server/src/controllers/attendanceController.js:1756` | Institutional intent is not confirmed: the source does not say whether any faculty listed on a subject may adjudicate correction requests for every section of that subject. The staffScope comments and the section-scoped reads point against it, but the owner must confirm. | In the sandbox, extend server/tests/academic.test.js next to the existing correction test (line 221). Create subject S with sections ['A','B']. Create timetable slots for facultyA on S section A and facultyB on S section B, which puts both in S.faculty. Create… |
| 13 | **Faculty without a Class In-Charge section can forward or reject any pending OD/leave request in their department**<br>`server/src/controllers/odLeaveController.js:reviewScope:faculty-department-fallback` | `server/src/routes/index.js:1408` → `server/src/controllers/odLeaveController.js:474` | Deployment data fact that is not visible in source: how many active faculty accounts have an empty section or a null inChargeYear, which sets how many staff hold department-wide or cross-year OD review authority. | In a sandboxed copy, add to server/tests/od-leave-scope.test.js a faculty user make('faculty', {department:'CSE'}) with no section, and a CSE year 3 section A semester 5 student. As the student, POST /attendance/od-leave with a valid future request. As the sec… |
| 14 | **HOD can read admin-uploaded alumni import batches across departments (and commit any uncommitted batch by ID)**<br>`alumni-import-batch-hod-department-scope` | `server/src/routes/alumniRoutes.js:441` → `server/src/controllers/alumni/alumniImportController.js:252` | Commit variant requires an HOD to hold the ObjectId of an uncommitted cross-department batch; no source path discloses such an ID to a different-department HOD, so that variant's practical likelihood is unestablished. / Real-world impact of the read variant depends on whether admins upload mixed-department batches containing rows for departments that have HOD accounts (deployment data state). | Using the server/tests alumni-flows.test.js pattern (startServer helper, in-memory/local Mongo, dummy users): (1) as admin POST /api/alumni/import/preview with a CSV containing one CSE row and one ECE row (dummy phone values), then POST /api/alumni/import/<id>… |
| 15 | **Assigned grievance authority can reopen or mark RESOLVED a complaint the student cancelled or closed**<br>`complaintController.authorityUpdate:missing-status-precondition` | `server/src/routes/index.js:2108` → `server/src/controllers/complaintController.js:246` | Source does not document the institutional policy on whether an assigned authority or admin may reopen or resolve a student-cancelled or student-closed grievance. The invariant is inferred from COMPLAINT_OPEN_STATUSES, COMPLAINT_CANCELLABLE_STATUSES and the state-gated sibling handlers. | Inside a sandbox with a local mongo:7, add a test to server/tests/complaints.test.js. (1) The student creates {category:'academics', subCategory:'subject', escalateTo:'faculty', description:'Withdrawn grievance for state test.'}. (2) The student sends PATCH /c… |
| 16 | **Branch HOD attendance reports include their department's 1st-year students when year is omitted or semester 1/2 is requested**<br>`attendanceReport:resolveReportScope:branch-hod-first-year-not-excluded` | `server/src/routes/index.js:1219` → `server/src/services/attendanceReport.js:510` | Deployment data fact (not decisive for the source flaw): the owner must confirm that production 1st-year User and AttendanceSession documents carry the branch department value (as the test fixtures and the S&H HOD's department query parameter imply) rather than 'Science & Humanities'. | In an isolated sandbox with a throwaway MongoDB, create a branch HOD (role hod, department 'CSE'), a CSE year-1 student (semester 1, section A, rollNo F1) and a CSE year-2 student (semester 3, section A, rollNo S3). Add one finished AttendanceSession for each … |
| 17 | **An HOD can turn an achievement post into a campus-wide announcement they can rewrite and pin, which only the Principal is allowed to publish**<br>`achievement:createFeedEntry:hod-authored-campus-wide-announcement` | `server/src/routes/index.js:575` → `server/src/controllers/announcementController.js:150` | Product intent is undocumented: nothing says whether an HOD who edits or pins their own achievement feed entry is an accepted exception to the Principal-only campus-wide announcement policy. The only related note is the comment at announcementController.js:145 about legacy audiences. | In an isolated test DB using the server's existing test harness, create a HOD with department 'CSE', one active CSE student, and one active student in another department. As the HOD, POST /api/achievements with that student, a valid achievedOn and the required… |
| 18 | **Approved achievement privacy-removal request (and resulting auto soft-delete) leaves the student's name in the campus-wide announcement**<br>`achievement:resolveHideRequest:feed-entry-not-revoked` | `server/src/routes/index.js:583` → `server/src/controllers/achievementController.js:337` | Product owners have not stated whether an approved privacy-removal request must also withdraw the student's name from the already-published campus feed announcement (the UI wording implies it should; the server contract only covers the Achievement record). | In a sandboxed test DB: as Principal create an achievement tagging dummy students S1 only; record Achievement.announcement. As S1 POST /api/achievements/<id>/hide-request; as Principal PATCH /api/achievements/<id>/hide-request/<reqId> {"action":"approve"}. The… |
| 19 | **Legacy Expo push tokens keep receiving notification content after the registering session is revoked**<br>`expo-push-tokens-not-session-bound` | `server/src/routes/index.js:354` → `server/src/services/pushService.js:112` | Real-world exposure depends on whether the legacy Expo app (mobile/) is still distributed and has registered tokens in production. | In server/tests against the mongo:7 test DB with global fetch stubbed: sign in dummy student S as a mobile client (session A) and POST /api/auth/push-token {token:'ExponentPushToken[dummy]'} with session A's access token. Sign in S again (session B) and POST /… |
| 20 | **Any signed-in user can grow the production MongoDB without limit through POST /api/uploads, because unattached StoredFile blobs are never deleted**<br>`server/src/utils/storage.js:persistFile:unbounded-orphan-storedfile-growth` | `server/src/routes/index.js:375` → `server/src/utils/storage.js:104` | Two deployment facts are decisive and not visible in source: whether CLOUDINARY_* are set on the Render service (if they are, the bytes go to Cloudinary and the impact becomes provider quota and spend), and the storage limit of the production MongoDB plan or cluster, together with any alerting or auto-scaling on it. | In a sandboxed run of the existing server test harness (the test MongoDB used by server/tests) with NODE_ENV=production and no CLOUDINARY_* variables, sign in as a dummy student. POST /api/uploads?kind=document three times with a small (for example 10 KB) vali… |
| 21 | **Anonymous 429 responses on arbitrary /api paths create a new SOC ErrorEvent row per distinct path and use up the shared per-minute capture budget, so real server faults are dropped**<br>`soc-capture-global-budget-and-rows-from-anonymous-429-paths` | `server/src/app.js:165` → `server/src/services/soc/capture.js:229` | Whether this matters for persistence depends on the deployed MongoDB storage quota and on any Render edge or proxy request-rate limits, neither of which is in the repository. / The deployed Node instance count is not visible in source, and each process has its own GLOBAL_PER_MIN budget and its own row ceiling. | In a sandboxed Jest test against a local test MongoDB, call resetCaptureForTests(). Then, within one minute, call captureError({source:'rate_limit', httpStatus:429, message:'Rate limit exceeded', route:'/api/zz' + String.fromCharCode(97 + (i % 26)) + 'q' + i.t… |
| 22 | **Announcement authors who lose posting authority can still rewrite, delete and (if staff) pin announcements they posted to audiences they can no longer reach**<br>`announcementController:updateAnnouncement:stale-author-audience-authority` | `server/src/routes/index.js:524` → `server/src/controllers/announcementController.js:150` | Institutional policy is not stated in source: should a former principal, HOD or club admin keep edit/delete/pin rights over announcements they posted earlier, after a role downgrade, department move or removal as club admin? The code comment covers only posting-rule changes. Severity depends on this policy (likely low: the actor was once a legitimate author, edits are logged, and no new notifications are sent). | In a sandboxed test DB, extend server/tests/announcement-tampering.test.js with dummy users. (1) A principal POSTs /announcements with audience {scope:'all'}. An admin PATCHes the user to role 'faculty' through the admin user-update endpoint, or the test sets … |
| 23 | **Alumni or faculty organizer can rewrite an approved event without re-approval**<br>`alumni-event-post-approval-edit-bypasses-review` | `server/src/routes/alumniRoutes.js:338` → `server/src/controllers/alumni/alumniEventsController.js:230` | Source does not document whether institutional policy requires edits to approved alumni events to be reviewed again; if post-approval edits by organizers are intended, this is a hardening gap rather than a bypass. | In a sandbox, with server/tests helpers, an isolated test MongoDB and dummy users: (1) a verified alumnus POSTs /api/alumni/events with a valid future event; expect status pending_approval. (2) A dummy admin POSTs /api/alumni/events/:id/approve; expect status … |
| 24 | **Alumni job owner can change an approved job's content without re-review when job approval is enabled**<br>`alumni-job-post-approval-edit-bypasses-review` | `server/src/routes/alumniRoutes.js:276` → `server/src/controllers/alumni/alumniJobsController.js:224` | The impact requires ALUMNI_JOBS_REQUIRE_APPROVAL=true. render.yaml does not set it, and source cannot show whether the production Render environment sets it outside render.yaml. | In a sandboxed server test using the existing alumni test harness and a disposable mongo test DB, set process.env.ALUMNI_JOBS_REQUIRE_APPROVAL='true' before importing env. Steps: (1) Create a dummy alumni user and POST /api/alumni/jobs with a benign title, a d… |
| 25 | **Alumni job eligibility (departments/years) is enforced only in the student listing, not on apply**<br>`alumni-job-apply-eligibility-not-enforced` | `server/src/routes/alumniRoutes.js:288` → `server/src/controllers/alumni/alumniJobsController.js:333` | Only the missing sandbox. | With a local mongo and dummy users only: as a dummy faculty/alumni poster, POST /api/alumni/jobs with eligibleDepartments ['CSE'] and eligibleYears [4] and a future deadline. As a dummy student with department 'ECE' and year 2, GET /api/alumni/jobs and confirm… |
| 26 | **Stale faculty score shown on unreviewed college-published project content and on the faculty leaderboard**<br>`skill-wallet:facultyScore-not-cleared-on-material-revision` | `server/src/controllers/skillWallet/projectController.js:172` → `server/src/controllers/skillWallet/galleryController.js:319` | Only the missing sandbox. | Inside an approved sandbox with a local mongo and dummy fixtures (server/tests/skill-wallet-fixtures.js), extend the existing flow in server/tests/skill-wallet-projects.test.js that approves a solo project (facultyScore 80): as the owner, PUT /api/skill-wallet… |

Full traces, evidence, blockers and owner-side checks are in `NEEDS-VALIDATION.md`.

## 5. Hardening notes and positive patterns

These are not findings. Hunters recorded them as defense-in-depth gaps or as cases with no demonstrated boundary crossing.

**Most important hardening items (parent-selected):**

- `/uploads` serves OD-leave/medical, gate-pass, complaint and chat attachments to anyone holding the UUID URL, with no authentication or expiry (`server/src/app.js`, `server/src/utils/storage.js`). Upload references are also not bound to the uploader, and the Cloudinary branch stores document files as public raw resources. Move sensitive kinds to the authorized, viewer-bound token scheme already used by Skill Wallet private files.
- `adminPolicyGuard` is inert because `isPolicyManaged` is constant false (`server/src/policies.js:154`), so Super Admin policy limits on Admins are stored but never enforced. Either enforce them or remove the UI that implies they apply.
- Android release builds are signed with the debug key unless a keystore is configured (`mobile-kotlin/app/build.gradle.kts`). Fail release builds that have no protected signing config.
- Several staff read paths return student/parent phone numbers college-wide (`staffAttendanceController.js:16`, `listJobApplications`, mentorship `getRequestById`). Apply the same department scoping that the list endpoints use.
- Seed scripts create accounts with a published default password and can wipe collections with no production/Atlas guard.
- `authLimiter` uses an in-memory store, so it resets on restart and is per instance. Combined with lead #6, per-IP login throttling is weak.
- Pin GitHub Actions to commit SHAs, use `npm ci` in `render.yaml`, and extend `.gitignore` to keystores, `*.pem`/`*.p12` and `google-services.json`.

<details><summary>All 99 hunter hardening notes</summary>

- **h01-auth:** Access and refresh JWTs carry no typ/aud claim (tokens.js:25-35); separation relies on JWT_ACCESS_SECRET != JWT_REFRESH_SECRET, which env.js does not enforce. Add a typ/aud claim or reject equal secrets at startup.
- **h01-auth:** logout() revokes a session from any signature-valid refresh token without checking the current jti (authController.js:443-456); consider requiring a jti match.
- **h01-auth:** Alumni claim creates its Session without idleTimeoutMs (alumniImportController.js:484); protect still enforces the idle rule but the background sweep will not reap it.
- **h02-admin:** Super Admin step-up covers only Admin-account operations and policy assignment; resetting passwords/editing/deleting principal, chairman, dean and other non-admin accounts runs without requireRecentReauth and the non-admin reset does not set mustChangePassword.
- **h02-admin:** updateUser uses Boolean(isActive) after isBoolean() without toBoolean(); JSON string "false" coerces to true (adminController.js:335,444).
- **h02-admin:** Changing a staff grantee's role leaves stored additional policies in place; they reactivate if the account returns to a STAFF_GRANT_ROLES role.
- **h02-admin:** Role-assignment controller has no in-controller authorization; the department-scope DENY in adminPolicy.js:88-95 is inert because isPolicyManaged is constant false (Super Admin policies on admins are stored but never enforced).
- **h03-gatepass:** withGatePassLock (gatePassController.js:256-268) releases the lock with an unconditional $unset; bind it to a per-call token so a request exceeding 10s cannot release another request's lock.
- **h03-gatepass:** requestParentOtp alternate-number path lets any class faculty or admin send the parent OTP to a number they type with a 3-character reason, so parent consent rests on faculty honesty; it is audited and flagged (parentVerifiedAlternate) but consider requiring HOD acknowledgement for alternate-number verifications.
- **h03-gatepass:** OTP is 4 digits by default with 5 attempts per code and unlimited regeneration after cooldown; only class faculty/admin can verify, so not exploitable by students, but a 6-digit default would reduce risk if verification is ever exposed more widely.
- **h03-gatepass:** bindGatePass/unbindGatePass: the group's class is reset when the last member is unbound without re-checking concurrently bound passes; a race could leave mixed-class members. Re-validate member class on submit.
- **h03-gatepass:** createGatePass accepts a fromDate in the past (only to>=from and 30-day span are checked); consider bounding fromDate to today or later.
- **h04-files:** /uploads serves sensitive attachments (OD-leave/medical documents, gate-pass documents, complaint and chat attachments) by bearer UUID URL with no auth, no expiry, no owner binding and 'Cache-Control: public, max-age=604800, immutable' (server/src/app.js:131,147); anyone who ever obtained a URL (removed chat member, reassigned faculty, logs, shared proxy cache) keeps access forever. The repo documents this store as public, so it is not reported as a broken guarantee; recommend moving document-kind uploads to the private store with viewer-bound signed tokens like Skill Wallet and using 'private, no-store'.
- **h04-files:** Upload references are not bound to the uploader: safeUrl/attachment validators (server/src/routes/index.js:251-256, 1087-1090, 2095-2099) accept any /uploads/<name> or any https URL, so a user can attach another user's upload if the name is known; bind StoredFile rows to an owner and verify ownership when attaching.
- **h04-files:** Cloudinary branch (server/src/utils/storage.js:88-97) uploads document-kind files (PDF/DOCX/medical proofs) as public 'raw' resources with no access mode; consider type: 'authenticated' / private delivery.
- **h04-files:** Avatar convertAvatarToWebp passes maxBytes 10 MB (imagePipeline.js:131) while multer caps at 5 MB; harmless but the two limits should agree. Sharp decode of up to 40 MP images runs on the libuv threadpool with no global sharp.concurrency cap; consider sharp.concurrency(1) and a lower pixel cap for avatars.
- **h04-files:** Skill Wallet asset tokens remain valid for the bound viewer until expiry even after logout/session revocation (fileController.js re-checks only user.isActive and asset authorization); acceptable given the 10-minute default but could be bound to the session id.
- **h05-skillwallet:** reviewController/access.js canReviewProject keys reviewer access on review.submittedRevision, which is never cleared on withdrawSubmission; assigned reviewers, coordinators in scope and the department HOD keep reading the live private content (including later material edits) after the student withdraws. reviewQueue status=draft lists such projects. Consider clearing submittedRevision on withdraw or limiting reviewer reads to the submitted revision snapshot.
- **h05-skillwallet:** galleryController.listContactRequests (line ~274) falls back to the live private project.title when published is null, so a requester keeps seeing a renamed title after the owner unpublishes to private; prefer only published.title or a placeholder.
- **h05-skillwallet:** Race: publicationController.setConsent computes activeMemberIds before save; acceptInvitation's seat $inc on memberCount does not bump __v and its public->college narrowing is a no-op while the project is still college, so a member joining concurrently with the last consent can end up on a public project without consenting. Recheck membership inside a conditional update or bump __v on seat changes.
- **h05-skillwallet:** The 'project_reviewer' designation capability is granted by the Principal but never consulted by canReviewProject/reviewerQueueFilter (functional gap, not a privilege gain).
- **h05-skillwallet:** reviewController rejection of an already-approved revision clears approvedRevision/publicRequest but leaves an already-public project public on the withdrawn approval; document or narrow to college.
- **h06-alumni:** mentorshipController.getRequestById (line 140) lets any HOD read any mentorship request and its sessions regardless of department, while listRequests (lines 103-107) scopes HODs to their department students; requires a known request ObjectId.
- **h06-alumni:** alumniEventsController.approveEvent/rejectEvent do not apply the HOD department/audience scope that listEvents(when=pending) uses (lines 41-45); getEventById (line 181) returns pending/rejected proposals to anyone who knows the ID.
- **h06-alumni:** alumniJobsController.listJobApplications (line 373) lets any HOD read applications to any job (student email/phone/resume link) without department scoping.
- **h06-alumni:** Alumni claim proves possession of the emailed/CSV token only; committing/resending staff receive raw claim URLs (alumniImportController.js:252-258, 363) and could claim an invite themselves. Consider an email-verification step or not returning tokens when mail is enabled.
- **h06-alumni:** jobsRequireApproval: updateJob lets a poster change content of an approved job without re-review, mirroring the event issue (config default off).
- **h06-alumni:** commitImport status check-then-set is non-atomic; concurrent commits are stopped only by the partial unique email index on pending invites (insertMany error), not by an atomic status transition.
- **h07-academic:** server/src/controllers/staffAttendanceController.js:16 returns student phone and parentPhone college-wide to every ATTENDANCE_SUMMARY_ROLES caller (office, coe, super_admin, principal ...); consider dropping parentPhone for read-only oversight roles given gate pass masks it for out-of-class faculty.
- **h07-academic:** server/src/controllers/reportController.js:33 listReports preview for targetType=user exposes name+email of any reported user id to faculty/hod/principal, beyond their people-directory scope; createReport also acts as an existence oracle for arbitrary ObjectIds.
- **h07-academic:** server/src/controllers/examController.js:178 overlap 409 conflict detail can reveal another manager's draft exam (code/time) to an HOD whose draft is outside their visibility.
- **h07-academic:** server/src/controllers/attendanceController.js:117 roleScope 'listed but not scheduled' fallback grants all declared sections of a subject; combined with never-pruned Subject.faculty, removing a faculty's timetable slot can widen rather than remove their read scope.
- **h07-academic:** server/src/controllers/complaintController.js:349 markResolved lets the student set CLOSED from any status (including CANCELLED); owner-only, low impact.
- **h08-realtime:** Tracker webhook uses one global TRACKER_WEBHOOK_SECRET and takes deviceId from the signed body (transportController.js:253,263-266); per-device secrets would limit blast radius of one compromised tracker.
- **h08-realtime:** Gate-pass live updates are emitted to all GATE_STAFF role rooms including every faculty member (gatePassController.js:21,78-82) with passId/status/studentId metadata; scope faculty emits to class faculty.
- **h08-realtime:** Restricting an admin via adminPolicies does not revoke sessions or move sockets out of role:admin (moot while isPolicyManaged is a no-op, policies.js:154).
- **h08-realtime:** Students whose stayType/transport assignment changes keep joined bus rooms until reconnect (socket.js:103-121); bus position data only.
- **h09-web:** server/src/routes/alumniRoutes.js:276 PATCH /alumni/jobs/:id has no validators and server/src/controllers/alumni/alumniJobsController.js:218-224 assigns externalUrl (and applyMode) unvalidated, bypassing the create-time https check at lines 134-138. Web impact is blocked by the default helmet CSP, but the stored javascript:/data: value reaches native sinks. Fix: apply body('externalUrl').optional({values:'falsy'}).isURL({protocols:['https'],require_protocol:true}) on PATCH and re-run the external_link check in updateJob after merging; also change the POST validator to require_protocol with http(s) only. Regression test: PATCH externalUrl='javascript:alert(1)' returns 422.
- **h09-web:** client/src/pages/alumni/AlumniJobsTab.jsx:185 calls window.open(selectedJob.externalUrl, ...) without the shared safeHref guard used elsewhere. Wrap it with safeHref from utils/format.js so the client does not depend on CSP alone.
- **h09-web:** client/src/utils/format.js:55 safeHref accepts '/\\host' (slash then backslash), which browsers normalize to the protocol-relative '//host'. Same-site-path intent is not enforced, but it only causes external navigation, not script execution. Tighten it to /^\/(?![\/\\])/.
- **h09-web:** Club socialLinks are stored unvalidated (clubController.js:12 EDITABLE includes socialLinks, no route validator in index.js:403-417). The web client filters them at render time, but other clients may not. Add https validators for socialLinks.* on POST/PUT /clubs.
- **h10-android:** Kotlin Route decodes each path segment after splitting (nav/Nav.kt Route.init), so %2F and %2e%2e inside a vexon:// or EXTRA_LINK segment bypass Push.safeLink's literal '..' check and reach screen ids that are interpolated into API paths (e.g. GatePassDetailScreen -> /gate-pass/$id). Only GETs run automatically today, but action buttons on those screens would send mutations to the retargeted path; validate ids as 24-hex ObjectIds in Routes.kt and build API URLs with HttpUrl.Builder.addPathSegment.
- **h10-android:** Fix for the candidate: ignore EXTRA_NOTIFICATION_ID/EXTRA_LINK unless the intent came from the app's own PendingIntent (e.g. carry a per-process random nonce or use a non-exported trampoline activity for notification taps), and require id to match ^[0-9a-f]{24}$ before calling Api.markNotificationRead; build all API paths with addPathSegment so ids cannot add segments or queries.
- **h10-android:** Kotlin openUrl (screens/Explore.kt line 130-132) launches ACTION_VIEW on any string without a scheme allowlist; current callers receive server-validated http(s) or /uploads values, but an https/http-only check at the sink would keep future fields safe.
- **h10-android:** AppState.pendingLink survives sign-out and is opened after the next account signs in (AppRoot.kt); navigation only, but clearing it on sign-out avoids cross-account handoff of a link.
- **h10-android:** Release build signs with the debug key unless a keystore is configured (mobile-kotlin/app/build.gradle.kts release signingConfig); owned by the CI/release-signing unit.
- **h10-android:** Expo mobile/android (untracked, generated) sets allowBackup=true with secure_store backup rules; tracked config is app.config.js, so not reported.
- **h11-ios:** iOS keychain items persist across app uninstall/reinstall; KeychainStore keeps vexon.refreshToken after deletion, so a reinstall on the same device silently restores the previous session (AppModel.start -> APIClient.restore). Same device-owner principal, so not a boundary violation; consider a first-launch marker in UserDefaults that wipes keychain items when absent (mobile-ios/VEXON/Core/Authentication/KeychainStore.swift).
- **h11-ios:** KeychainStore.set ignores SecItemUpdate/SecItemAdd/SecItemDelete status (KeychainStore.swift:29-46); a failed delete on logout would leave the refresh token stored without notice. Check the status and retry/log a redacted failure.
- **h11-ios:** ServerConfiguration.assetURL accepts any absolute http(s) URL from server data; with NSAllowsLocalNetworking a server-stored avatar like http://192.168.x.x/... makes viewers' devices fetch LAN hosts. Restrict avatars to same-origin /uploads paths or https.
- **h11-ios:** AsyncImage uses URLSession.shared (default on-disk URLCache) for avatars, unlike the ephemeral API transport; avatars are public /uploads files so impact is minimal, but a dedicated ephemeral image loader would keep the no-disk-cache guarantee consistent.
- **h12-deploy:** mobile-kotlin/app/build.gradle.kts:59 always signs release builds with the debug key; add a protected release signingConfig and fail release builds without it.
- **h12-deploy:** Seed scripts create accounts with the published Password@123 and wipe collections with no NODE_ENV/Atlas guard; refuse when isProd or DB_TARGET=atlas.
- **h12-deploy:** Root .gitignore does not cover *.jks, *.keystore, *.pem, *.p12 or mobile-kotlin/app/google-services.json.
- **h12-deploy:** GitHub Actions use mutable tags; pin third-party actions to commit SHAs.
- **h12-deploy:** render.yaml buildCommand uses npm install instead of npm ci.
- **h12-deploy:** TRUST_PROXY=1 assumes exactly one appending proxy hop; owner should confirm req.ip is the real client IP.
- **h12-deploy:** pdfIndexer extracts every page before applying MAX_PAGES and has no global concurrency cap.
- **h12-deploy:** /uploads static and DB-backed GET /uploads/:filename are outside the /api limiter; add a per-IP limiter for the DB route.
- **h12-deploy:** CSP disables upgrade-insecure-requests; enable it in HTTPS production.
- **h13-reports:** ACHIEVEMENT_VIEW_ROLES is derived as ROLES minus a block list, so the 'alumni' role can read every achievement with current students' roll number, section, year and avatar; consider an allow-list that excludes alumni if alumni are not meant to see the current-student directory.
- **h13-reports:** lowAttendanceMonitor accepts any subjectId without checking it belongs to the scoped department; harmless today because records are restricted to the scoped students, but the subject filter could be validated for consistency.
- **h13-reports:** congratulate re-reads with findOneAndUpdate({_id}) without isDeleted:false; a race with deletion only toggles a counter on a deleted record.
- **h14-fanout:** server/src/config/socket.js transport:subscribe and discussion:join: bus and discussion room membership is checked only at join time; if a student's bus assignment changes or a discussion is later hidden, the existing socket keeps receiving bus:location fixes / discussion:reply id signals until reconnect. Consider re-checking or evicting rooms (removeUsersFromRoom) on bus reassignment and on hide.
- **h14-fanout:** server/src/middleware/realtime.js:21 broadcasts the acting user's id and the entity id for every announcement/event/club/discussion write to all connected users, including writes to department-targeted or hidden items; payload has no content, but dropping the 'by' field would avoid revealing who moderated or authored restricted items.
- **h14-fanout:** server/src/controllers/alumni/alumniChaptersController.js:379 emits full chapter posts to room 'chapter:<id>' which no socket handler ever joins; remove the dead emit or add an authorized join so a future join handler does not leak post content.
- **h15-urlchain:** server/src/controllers/alumni/alumniJobsController.js updateJob (PATCH /alumni/jobs/:id) stores externalUrl/applyMode without the create-time https check; apply assertHttpUrl(patch.externalUrl) and require externalUrl when the resulting applyMode is external_link, and replace the createJob regex with assertHttpUrl. Currently neutralized only by the web CSP (script-src 'self') and by the native clients' 'external' vs 'external_link' enum mismatch.
- **h15-urlchain:** client/src/pages/alumni/AlumniJobsTab.jsx:185 calls window.open on a raw server URL; wrap it in the existing safeHref helper so it does not rely on CSP.
- **h15-urlchain:** server/src/routes/alumniRoutes.js:148 mentorship slot meetingLink uses isURL() defaults, which accept 'scheme:user@host' strings (e.g. mailto:); use isURL({protocols:['http','https'], require_protocol:true}) or assertHttpUrl for parity with event meetingLink.
- **h15-urlchain:** server/src/controllers/alumni/alumniChaptersController.js createPost accepts arbitrary strings in images with no type/scheme/length validation; validate as /uploads/ paths or https URLs before any client starts rendering them.
- **h15-urlchain:** mobile-kotlin Explore.kt openUrl and Expo Linking.openURL perform no scheme allowlist; add an http(s) check at the sink.
- **h15-urlchain:** Expo (mobile/src/app/(app)/alumni/jobs/*.js) and Kotlin (Alumni.kt, AlumniMore.kt) use applyMode 'external' while the server enum is 'external_link', so external-link jobs cannot be created or opened from native apps (functional bug).
- **h16-staff:** staffController.js:45-50 managesSlot does not exclude the caller's own periods, unlike managesFaculty (line 40) which explicitly excludes self: an HOD can mark their own timetable periods 'not_conducted' (which blocks attendance and removes them from 'held' counts) or assign a substitute for them without Principal involvement, even though the HOD's own early exit requires Principal approval. Every such action is recorded in PeriodCover.history and the activity log; consider requiring a college role when slot.faculty is the caller.
- **h16-staff:** staffController.js:362 assignCover accepts any active faculty/hod college-wide as substitute, while availableSubstitutes (line 339-340) only offers the slot's/original faculty's/caller's departments; the server does not enforce the same department set, so the substitute (who then gains attendance write for that period) can be from an unrelated department. Within the HOD's authority, so not reported as a vulnerability.
- **h16-staff:** staffController.js:38-42 managesFaculty lets an HOD decide/record early exits for any other 'hod' account in the same department; only safe while set-hod keeps a single HOD per department (adminRoleAssignmentController.js demotes the previous HOD). Consider also excluding faculty.role==='hod' for HOD callers so HOD exits always route to the Principal as the notification logic at line 122 assumes.
- **h17-login:** Per-account lockout is triggerable by any anonymous party (3 failures -> 5 min, escalating to 60 min) for any account including security guards and admins; even without the IP-decay bypass this is a targeted availability lever. Consider not escalating locks from unauthenticated failures alone or exempting the owner's known devices.
- **h17-login:** authLimiter uses the default in-memory store, so its 20-failures/15-min window resets on every process restart and is per instance; it is the only per-IP bound once the LoginThrottle IP counter is evaded.
- **h17-login:** Concurrent login attempts for an existing account are serialized by the lease while unknown-email attempts run in parallel, giving a weak burst-timing existence oracle; lower priority than the counter-scope oracle.
- **h17-login:** Lockout email/notification includes req.ip of the attacker; fine, but the HTML email interpolates parseDevice() output unescaped (authController.js:303); verify parseDevice cannot return user-agent-controlled HTML.
- **h18-modlife:** PATCH /alumni/jobs/:id (alumniRoutes.js:276) has no express-validator body rules, unlike POST /alumni/jobs; updateJob also skips the external_link https check done in createJob (alumniJobsController.js:134-138). URL-scheme impact is owned by the peer stored-alumni-URL unit.
- **h18-modlife:** Club profile fields (name, logo, coverImage, description) can be changed by club admins after admin approval with no re-review; this matches the club-admin management model and is not reported, but a name/logo change audit to admins would reduce impersonation risk.
- **h18-modlife:** reviewClub (clubController.js:155-173) promotes the creator to club_admin on approval but does not demote on a later rejection of an approved club.
- **h19-announce:** deleteAnnouncement (announcementController.js:156-163) shares the same stale-authorship canEdit check; a demoted author can delete their former campus-wide broadcast. Lower impact than rewrite; fix together by requiring checkAudience(user, ann.audience) to succeed (or admin) in canEdit for mutations.
- **h19-announce:** updateAnnouncement does not re-send notifications on edit, so silent content rewrites after notification are possible even for currently authorized authors; consider recording an edited marker visible to readers.
- **h20-imgurl:** safeUrl (server/src/routes/index.js:251-256) accepts any https host for student-writable lost-found photo (index.js:2041, 2058) and club/event/announcement images. The web CSP img-src blocks third-party hosts, but the Kotlin (Coil via VexonApp.kt:42-44), Expo (RN Image), and iOS clients have no equivalent policy, so a student can set photo=https://attacker.example/p.png?item=X and record viewers' IP address, User-Agent, and open time. No credential, cookie, or navigation is exposed. Suggested change: limit image fields to '/uploads/' paths or the CSP image origins (for example res.cloudinary.com) in a dedicated safeImageUrl validator, and add a regression test that POST /lost-found with an external https photo returns 422.
- **h21-jobstatus:** reopenJob does not clear removedBy/removeReason and does not re-check that an alumni poster's AlumniProfile is still verified; after the closeJob fix, consider re-checking poster eligibility on reopen.
- **h21-jobstatus:** closeJob/reopenJob use read-then-save without a conditional update; concurrent close/remove requests can race (last write wins). A conditional findOneAndUpdate on the expected source status would make transitions atomic.
- **h21-jobstatus:** reopenJob does not check deadline; a poster can reopen an expired-deadline job, though students' listJobs and applyToJob still filter/reject past deadlines.
- **h22-grievance:** complaintController.markResolved (line 350) has no status precondition: a student can set CLOSED on their own CANCELLED or NOT_RESOLVED complaint and re-close it repeatedly; restrict to RESOLVED (or open) states.
- **h22-grievance:** lostFoundController.updateStatus (line 175): the reporter can 'close' an item staff already marked 'returned', overwriting resolvedBy/resolvedAt of the staff handover record; skip the overwrite when the item is already returned/closed.
- **h22-grievance:** lostFoundController.updateStatus (line 173): re-linking an item to a new match leaves the previous counterpart's matchedWith pointing at this item (asymmetric stale link).
- **h22-grievance:** COMPLAINT_ESCALATION_CHAINS end at 'chairman' but the authority-update authorize() list (COMPLAINT_AUTHORITY_ROLES plus admin) excludes chairman, so chairman-level grievances can only be updated by admin; functional gap, not a vulnerability.
- **h23-applications:** updateApplication (server/src/controllers/alumni/alumniJobsController.js:432-439) has no source-state precondition: a poster can move a 'withdrawn' application back to referred/shortlisted/rejected, overriding the student's withdrawal and desynchronising applicationCount; restrict transitions to non-withdrawn sources.
- **h23-applications:** withdrawApplication and the reapply branch of applyToJob are read-then-save without a status-conditional update, so concurrent requests double-adjust AlumniJob.applicationCount; use a conditional findOneAndUpdate and conditional $inc.
- **h23-applications:** cancelEvent (server/src/controllers/alumni/alumniEventsController.js:293-321) is not idempotent and has no source-state check: repeated calls on an already cancelled, rejected or completed event re-send cancellation notifications with organizer-supplied reason text to all going/waitlisted RSVPs; refuse when already terminal.
- **h23-applications:** Route validator for PATCH /alumni/job-applications/:id (server/src/routes/alumniRoutes.js:308) allows 'pending' and 'hired', which the controller rejects and which are not in JOB_APPLICATION_STATUSES; align the lists.
- **h24-soc:** messageShape (sanitize.js:95-102) is applied to the unredacted message for fingerprinting only. It is hashed and not stored, so this is not a leak.
- **h24-soc:** redactText does not mask roll numbers or hall-ticket numbers (alphanumeric, under 10 digits) in free-text error messages. Server-generated 403/5xx ApiError messages reviewed in this path do not interpolate them, but adding a generic high-entropy/identifier mask would reduce risk.
- **h24-soc:** client/src/services/api.js:96 reports endpoint URLs with path segments (e.g. /auth/alumni-claim/<token>). Reports require sign-in, so an unauthenticated claimant does not trigger it, but the same path-token redaction gap applies to the endpoint/apiEndpoint field (socController.js:471).

</details>

**Positive source patterns observed:**

- Access tokens are bearer-only and bound to a live Session row (`server/src/middleware/auth.js`). Refresh tokens rotate and reuse triggers session revocation.
- CSRF uses a double-submit token plus an Origin allowlist (`server/src/middleware/security.js`). The refresh cookie is SameSite=Strict, scoped to `/api/auth`.
- Skill Wallet private files use HMAC tokens bound to the viewer. NPTEL certificate images are magic-byte checked and re-encoded to WebP server-side.
- OTPs are HMAC-hashed with attempt limits. The GPS tracker webhook is HMAC-signed with a time window.
- The Kotlin `Push.safeLink` allowlist and the web `safeHref` helper guard most client navigation from server data. The iOS app registers no URL types.
- Mongo query input passes through `mongoSanitize` and an input-hygiene guard. No injection path was found in the query-construction unit.

## 6. Coverage summary

- Ledger units: **46**, covered 24, candidate 22, blocked 0, deferred 0, in progress 0.
- Rejected records: 1.
- One candidate was rejected in Phase 3: alumni-job-application-withdraw-reapply-resets-poster-decision. A student withdrawing and reapplying to their own application crosses no boundary. It is kept in findings.json so future runs do not re-raise it.
- Coverage is source-only. One run never exhausts a target. A follow-up run with a working sandbox should first execute the local plans in `NEEDS-VALIDATION.md` to confirm or reject each lead.

### Units by area

| Status | Hunter | Surface |
|---|---|---|
| candidate | h01-auth | Browser cross-site requests to /api |
| covered | h01-auth | Auth routes: login, refresh, logout, sessions, change-password, register |
| candidate | h01-auth | Push token / device registration |
| candidate | h01-auth | Public routes during maintenance/lockdown |
| covered | h02-admin | Admin and staff account management |
| candidate | h02-admin | Admin policies, staff grants, HOD/class-in-charge assignment |
| covered | h02-admin | Super Admin console |
| covered | h03-gatepass | Gate pass state machine: approval, QR verify, exit, return |
| candidate | h03-gatepass | Gate pass routes |
| covered | h03-gatepass | Parent OTP send/verify |
| covered | h04-files | Uploaded file download |
| candidate | h04-files | Generic file upload |
| covered | h04-files | Skill Wallet private file tokens and image pipeline |
| covered | h05-skillwallet | Skill Wallet authenticated routes |
| candidate | h05-skillwallet | Skill Wallet public gallery |
| candidate | h06-alumni | Alumni, chapters, jobs, events, mentorship |
| candidate | h06-alumni | Alumni invite claim and CSV import |
| candidate | h07-academic | Academic records routes |
| covered | h07-academic | Community and messaging routes |
| candidate | h07-academic | People directory, search, reports and exports |
| covered | h07-academic | MongoDB query construction from request input |
| covered | h08-realtime | Socket.IO connection and room events |
| covered | h08-realtime | AI study assistant and SOC AI explain |
| covered | h08-realtime | GPS tracker webhook and transport routes |
| covered | h09-web | Web SPA rendering and navigation |
| covered | h10-android | Expo React Native app |
| candidate | h10-android | Kotlin Android app |
| covered | h11-ios | SwiftUI iOS app |
| covered | h12-deploy | Repository-wide basics |
| covered | h12-deploy | CI workflows and mobile release signing |
| candidate | h12-deploy | Deployment configuration and env defaults |
| covered | h12-deploy | Pre-auth and per-user expensive work |
| candidate | h13-reports | Achievements module |
| candidate | h13-reports | Attendance reports and exports (JSON/CSV/PDF) |
| covered | h14-fanout | Socket.IO server-initiated broadcasts |
| covered | h15-urlchain | Stored alumni URLs rendered by web and native clients |
| covered | h16-staff | Hostel, security logs and holidays |
| covered | h16-staff | Staff early exit and cover workflow |
| candidate | h17-login | Anonymous login abuse controls |
| candidate | h18-modlife | Owner edits after moderator approval (alumni jobs, clubs) |
| candidate | h19-announce | Announcement edit and pin |
| covered | h20-imgurl | Student/club-writable https image URLs rendered by native clients |
| candidate | h21-jobstatus | Alumni job status transitions by the poster (close, reopen) and staff (remove) |
| candidate | h22-grievance | Grievance and lost-found status transitions |
| candidate | h23-applications | Alumni job application and event lifecycle transitions |
| candidate | h24-soc | Client-submitted and server-captured error events into the SOC store read by Super Admin |


---

# Appendix — full lead details


## 1. Exported Kotlin MainActivity turns an untrusted notificationId intent extra into an authenticated PATCH to an attacker-chosen VEXON API path

- **Fingerprint:** `kotlin-mainactivity-notificationid-extra-path-injection`
- **Affected boundary / root cause (claimed):** MainActivity.handleLink accepts EXTRA_NOTIFICATION_ID from any caller of the exported activity (the extra is intended only for the app's own immutable notification PendingIntent) and passes it unvalidated to Api.markNotificationRead, which interpolates it into a URL path that Http.url parses as a full URL string (dot-segment resolution and query splitting) instead of adding it as an encoded path segment, letting the sender choose any /api path for an authenticated PATCH.

MainActivity is exported (LAUNCHER filter plus a BROWSABLE vexon:// VIEW filter) with no android:permission. handleLink() runs on onCreate and onNewIntent and, independently of the link/safeLink handling, reads the string extra 'vexon.notificationId' from any incoming intent. If a user is signed in (Auth.user != null), it calls Api.markNotificationRead(id), which builds '/notifications/$id/read' by raw string interpolation and sends it as PATCH with an empty body, the mobile client headers (x-client-platform: mobile) and the signed-in user's bearer access token; on a 401 it refreshes the session and replays. Http.url() parses the concatenated string with OkHttp 4.12 HttpUrl (toHttpUrlOrNull), which resolves '..' segments and treats '?' as the start of the query, so an id such as '../alumni/<ObjectId>/verify?x=' yields 'PATCH /api/alumni/<ObjectId>/verify'. Because the request is mobile-identified with no Sec-Fetch-Site, csrfAndOriginGuard returns before Origin/CSRF checks; server-side authorization is evaluated as the victim. A malicious app on the same device (explicit intent, no permission) — and plausibly a web page via a Chrome intent: URI targeting the BROWSABLE vexon filter with S.vexon.notificationId=... — can thus make the victim's session perform empty-body PATCH actions the victim is authorized for: e.g. an HOD/admin victim verifies an attacker-controlled alumni profile (verifyAlumniProfile takes no body; HOD limited to own department), or a student victim's gate pass is cancelled, or a faculty victim publishes an exam, notifications are bulk-marked read, achievements are featured, alumni jobs closed, or alumni invites revoked. The attacker gets no response data (the result is discarded by runCatching); the impact is blind state change limited to empty-body PATCH routes the victim's role permits.

**Source trace**

1. *entrypoint* `mobile-kotlin/app/src/main/AndroidManifest.xml:54` — `MainActivity <activity android:exported="true">`: MainActivity is exported with a LAUNCHER filter and a VIEW/DEFAULT/BROWSABLE filter for scheme vexon (line 70), with no android:permission, so any installed app can start it with arbitrary extras and browser intent: URIs can plausibly reach it.
1. *propagation* `mobile-kotlin/app/src/main/java/com/vexon/campus/MainActivity.kt:72` — `MainActivity.handleLink`: intent.getStringExtra(Push.EXTRA_NOTIFICATION_ID) (called from onCreate line 42 and onNewIntent line 59) is, when Auth.user != null, launched into Api.markNotificationRead(id) at line 73 with no format validation and no check that the intent came from the app's own PendingIntent. The separate safeLink allowlist only applies to EXTRA_LINK/data.
1. *propagation* `mobile-kotlin/app/src/main/java/com/vexon/campus/core/Api.kt:106` — `Api.markNotificationRead`: patch("/notifications/$id/read", null, "Notification") interpolates the raw attacker string into the request path.
1. *propagation* `mobile-kotlin/app/src/main/java/com/vexon/campus/core/Http.kt:117` — `Http.url`: "${ServerConfig.apiUrl}/api$path".toHttpUrlOrNull() parses the concatenated string (OkHttp 4.12.0): '..' segments are resolved and '?' starts the query, so '/notifications/../alumni/<id>/verify?x=/read' becomes path /api/alumni/<id>/verify.
1. *propagation* `mobile-kotlin/app/src/main/java/com/vexon/campus/core/Http.kt:138` — `Http.raw`: Adds mobileHeaders (x-client-platform: mobile, line 65/137) and 'authorization: Bearer <victim access token>'; PATCH with null body sends an empty body (line 132); authed() (lines 96-113) refreshes and replays on 401.
1. *propagation* `server/src/middleware/security.js:82` — `csrfAndOriginGuard`: isMobileClient(req) (x-client-platform: mobile and no sec-fetch-site; utils/tokens.js line 74) returns next() before any Origin/CSRF check; protect then authenticates the victim's bearer token.
1. *sink* `server/src/controllers/alumni/alumniProfileController.js:346` — `verifyAlumniProfile`: Reached via alumniRoutes.js line 450 PATCH /alumni/:id/verify (mounted at routes/index.js line 2131; authorize admin/hod; no body fields): sets profile.isVerified = true and verifiedBy = victim (HOD restricted to own department at line 342), then auto-joins chapters. Other empty-body PATCH sinks reachable the same way include /gate-pass/:id/cancel (index.js line 1972).

**Evidence**

- `mobile-kotlin/app/src/main/AndroidManifest.xml:54`: android:exported="true" on MainActivity; no permission attribute protects it; BROWSABLE vexon filter at lines 66-71.
- `mobile-kotlin/app/src/main/java/com/vexon/campus/MainActivity.kt:72`: intent?.getStringExtra(Push.EXTRA_NOTIFICATION_ID)?.takeIf { Auth.user != null }?.let { id -> ... Api.markNotificationRead(id) }
- `mobile-kotlin/app/src/main/java/com/vexon/campus/push/Push.kt:157`: The legitimate producer of this extra is the app's own FLAG_IMMUTABLE PendingIntent (putExtra at line 157, PendingIntent.getActivity at line 159); nothing distinguishes it from an external intent carrying the same extra (EXTRA_NOTIFICATION_ID = "vexon.notificationId", line 50).
- `mobile-kotlin/app/src/main/java/com/vexon/campus/core/Api.kt:106`: suspend fun markNotificationRead(id: String) = patch("/notifications/$id/read", null, "Notification")
- `mobile-kotlin/app/src/main/java/com/vexon/campus/core/Http.kt:117`: val base = "${ServerConfig.apiUrl}/api$path".toHttpUrlOrNull() — path string is parsed as a URL, not built with addPathSegment, so dot segments and '?' are interpreted.
- `mobile-kotlin/app/src/main/java/com/vexon/campus/core/Http.kt:138`: builder.header("authorization", "Bearer $token") attaches the signed-in user's access token; mobileHeaders with x-client-platform: mobile added at line 137.
- `server/src/utils/tokens.js:74`: isMobileClient = x-client-platform === 'mobile' && !sec-fetch-site; csrfAndOriginGuard (security.js line 82) skips Origin/CSRF for such requests.
- `server/src/routes/alumniRoutes.js:450`: alumniRouter.patch('/:id/verify', idParam('id'), authorize('admin', 'hod'), validate, alumniProfile.verifyAlumniProfile) — no body required.
- `server/src/controllers/alumni/alumniProfileController.js:346`: profile.isVerified = true; profile.verifiedBy = req.user._id — privilege-bearing state change performed as the victim.
- `server/src/routes/index.js:1972`: router.patch('/gate-pass/:id/cancel', idParam('id'), gatePass.cancelGatePass) — another empty-body PATCH reachable through the same primitive.

**Blockers**

- No OS-enforced sandbox available to execute a bounded local check (Docker daemon stopped on the Windows host); no target code was run in this verification.
- OkHttp 4.12.0 HttpUrl dot-segment resolution and '?' handling for the concatenated path must be observed with the pinned library rather than inferred from source.
- The final merged manifest of the built/released APK must be observed to confirm MainActivity remains exported without a protecting permission after manifest merge.
- Whether Chrome or other browsers deliver S.vexon.notificationId string extras from an intent: URI to this activity (remote, user-click variant) is an Android/browser runtime fact not visible in source; the local malicious-app variant does not depend on it.
- Requires a signed-in user (Auth.user != null) when handleLink runs; on a cold start session restore may be asynchronous and the extra may be dropped, so the reliable path is a warm/backgrounded app receiving onNewIntent (singleTask).

**Resolution plan**

- *Local (sandboxed, dummy data):* In an isolated emulator with a debug build pointed at a local test server seeded with dummy data: (1) JVM unit test (app/src/test) asserting that ("http://10.0.2.2:5000/api" + "/notifications/../alumni/000000000000000000000001/verify?x=/read").toHttpUrlOrNull()!!.encodedPath == "/api/alumni/000000000000000000000001/verify" with okhttp 4.12.0. (2) Sign in as a dummy HOD in the app, background it, then run: adb shell am start -n com.vexon.campus.native/com.vexon.campus.MainActivity --es vexon.notificationId '../alumni/<dummyUnverifiedSameDeptAlumniProfileId>/verify?x=' and observe on the local server log a single PATCH /api/alumni/<id>/verify authenticated as the HOD and the dummy AlumniProfile.isVerified flipped to true. Stop after that single record change.
- *Owner-observed (no audit traffic):* Owner inspects the released APK's merged manifest (aapt dump xmltree / apkanalyzer manifest print) for MainActivity exported=true without android:permission, and confirms the release build contains the MainActivity.handleLink EXTRA_NOTIFICATION_ID path and the Http.url string-concatenation code; no requests against the deployed service are needed.

## 2. Security guards can read every pending gate pass college-wide via the dashboard, and any pass in any state by ID, including parent and student phone numbers

- **Fingerprint:** `gatepass:security-role-unscoped-pass-read`
- **Affected boundary / root cause (claimed):** Security's status scope is enforced only inside listGatePasses. canView grants 'security' unconditional access to any pass. getGatePassUserScopeFilter has no security branch and returns an empty, match-all filter for roles it does not list. dashboardGuard and parentPhoneGuard do not mask parentPhone for security, and the dashboard populates the student with STUDENT_FIELDS (email, phone) instead of GUARD_STUDENT_FIELDS.

The code says the security role should only see approved, active and completed passes (routes/index.js:1772-1773). listGatePasses enforces this (gatePassController.js:381-382), and security-audit.test.js F4 tests it. Two other read paths for the same GatePass resource do not enforce it. (1) GET /gate-pass/dashboard is authorized for GATE_VIEW, which includes 'security' (index.js:1778, 1835-1841), and gate-dashboard-roles.test.js:133-134 expects security to get 200 from it. gateDashboard builds its scope with getGatePassUserScopeFilter, which has no security branch and falls through to `return {}` (gatePassController.js:1208). merge() then applies no scope (1286-1289). As a result, pendingStudents (1312-1319) holds every pass in GATE_PASS_PENDING_STATUSES across the college, with the student populated with STUDENT_FIELDS (email and phone). Each pass also carries description (the emergency reason), supportingDocument {url,name,mimeType} and parentPhone. dashboardGuard (1161-1168) wraps parentPhoneGuard (68-75), which returns the pass unchanged for every role except faculty, so security receives the parent number unmasked. (2) GET /gate-pass/:id (index.js:1927) has no role gate. canView returns true for 'security' on any pass (gatePassController.js:423), so a security user can open a pending, rejected, cancelled or emergency pass by ID with the same fields. Pass IDs and student IDs for every state change are pushed to GATE_STAFF, which includes security, through the gatepass:updated socket event (21, 78-82). No intervening control blocks this: confinedRoleGuard has no rule set for security, and the HOD/faculty-style scoping is never applied. The intended design for security is visible elsewhere. securityDashboard and the student lists use GUARD_STUDENT_FIELDS ('The guard needs to recognise the student, not contact them: no email / phone', 1538-1539), and GET /users/:id returns 403 for security (gate-dashboard-roles.test.js:181). The exposure is limited to an authenticated insider holding the security role. No anonymous or student access is involved, and the date-history branch is closed to security (1277).

**Source trace**

1. *entrypoint* `server/src/routes/index.js:1836` — `GET /gate-pass/dashboard`: Authenticated route authorized for GATE_VIEW (line 1778: [...STAFF_VIEW, 'security']) plus the emergency authorities and super_admin. A security-role user is accepted, and gate-dashboard-roles.test.js:133-134 expects 200.
1. *propagation* `server/src/controllers/gatePassController.js:1284` — `gateDashboard`: scopeFilter = await getGatePassUserScopeFilter(req.user); the guard comes from dashboardGuard(req.user) on line 1283.
1. *propagation* `server/src/controllers/gatePassController.js:1208` — `getGatePassUserScopeFilter`: No branch for 'security', so the function falls through to `return {}`. merge() (1286-1289) then returns the base query with no scope.
1. *propagation* `server/src/controllers/gatePassController.js:1312` — `gateDashboard pendingStudents query`: GatePass.find({status: {$in: GATE_PASS_PENDING_STATUSES}}) college-wide, populated with STUDENT_FIELDS (name, email, rollNo, phone, ...) and reviewer names.
1. *propagation* `server/src/controllers/gatePassController.js:1161` — `dashboardGuard -> parentPhoneGuard`: dashboardGuard masks only for ao/dean/chairman. parentPhoneGuard (line 69) returns the pass unchanged for any role other than faculty, so parentPhone is unmasked for security.
1. *sink* `server/src/controllers/gatePassController.js:1359` — `gateDashboard JSON response`: pendingStudents: pendingStudents.map(formatPending). This returns every pending pass with parentPhone, description, supportingDocument and the student's email and phone to the security user.

**Evidence**

- `server/src/routes/index.js:1772`: Stated design: 'security only ever sees approved/active/completed passes to record OUT / IN.'
- `server/src/controllers/gatePassController.js:382`: listGatePasses restricts security to approved/active/completed. This is the intended control, and the status query can only narrow it.
- `server/src/controllers/gatePassController.js:423`: canView returns true for 'security' on any pass regardless of status. GET /gate-pass/:id (routes/index.js:1927, no authorize) relies on it and returns the pass through parentPhoneGuard (line 458), which does not mask for security.
- `server/src/controllers/gatePassController.js:31`: STUDENT_FIELDS includes email and phone and is used by the dashboard populates.
- `server/src/controllers/gatePassController.js:1539`: GUARD_STUDENT_FIELDS deliberately omits email and phone for the security-specific endpoints ('The guard needs to recognise the student, not contact them').
- `server/src/controllers/gatePassController.js:81`: publish() emits passId, status and studentId for every state change to GATE_STAFF, which includes 'security' (line 21). This hands security the IDs to use with GET /gate-pass/:id.
- `server/tests/security-audit.test.js:120`: Asserts 'security only ever sees approved / active / completed passes', but only for GET /gate-pass.
- `server/tests/gate-dashboard-roles.test.js:181`: Security is denied GET /users/:id (403). This shows that student contact and profile data is intentionally withheld from security.
- `server/src/middleware/coeGuard.js:88`: confinedRoleGuard has no ALLOWED entry for security, so it does not restrict these reads.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check (Docker daemon stopped on the Windows host). The trace is source-verified only.
- The product owner needs to confirm that security staff should not see pending passes, or open non-approved passes by ID, along with the full parent and student contact numbers. The source comment at routes/index.js:1772, test F4, GUARD_STUDENT_FIELDS and the /users/:id 403 for security all indicate they should not.

**Resolution plan**

- *Local (sandboxed, dummy data):* In the mongo test harness (for example a new test in server/tests/security-audit.test.js using the existing security and student fixtures), create a GatePass with status 'pending_faculty' for a dummy student in another department. Give it parentPhone '9000000002', description 'test reason' and supportingDocument {url:'/uploads/dummy.pdf', name:'d.pdf', mimeType:'application/pdf'}. As the dummy security user, call GET /gate-pass/dashboard and GET /gate-pass/<id>. Vulnerable result: dashboard pendingStudents contains the pass with parentPhone '9000000002', the description, the supportingDocument and student.email/student.phone, and GET /gate-pass/<id> returns 200 with the same fields. Fixed result: the pass is absent from the dashboard (or the response has no pending list for security), and GET /gate-pass/<id> returns 403/404 for non-approved/active/completed passes. Delete the test document afterwards.
- *Owner-observed (no audit traffic):* On a staging copy only, with owner consent: raise a dummy gate-pass request from a test student account. Sign in with a security test account and fetch GET /gate-pass/dashboard. Check whether pendingStudents lists the dummy request with the unmasked parent number and the student's phone and email, and whether GET /gate-pass/<dummy id> returns 200 while the request is pending. Do not use real student records.

## 3. Job poster can undo a staff removal (or skip moderation) by closing and then reopening the job

- **Fingerprint:** `alumniJobsController.closeJob:missing-status-precondition`
- **Affected boundary / root cause (claimed):** closeJob (server/src/controllers/alumni/alumniJobsController.js:231-244) checks only that the caller is the poster or an admin (line 237). It then sets job.status='closed' at line 241 with no check on the current status, so it accepts 'removed' and 'pending_review' as starting states. reopenJob (line 257) treats 'closed' as a state the poster may reopen. The status guard was added only to reopenJob, not to closeJob, the step that feeds it.

PATCH /api/alumni/jobs/:id/close sets status='closed' on any job the caller posted, whatever its current status. reopenJob then lets a non-admin poster reopen any 'closed' job. So a poster (alumni, faculty or hod) whose job was removed by staff (status 'removed', set by an HOD/admin with a required reason) can call /close and then /reopen to put the job back to 'open'. An open job is listed to students and accepts applications. Once the status is no longer 'removed', updateJob's removed-edit block (line 216) no longer applies, so the poster can also edit the reinstated posting. The same chain moves a 'pending_review' job to 'open' when ALUMNI_JOBS_REQUIRE_APPROVAL=true. This defeats the explicit guard in reopenJob (lines 255-259), whose comment says a staff-removed or pending job 'is not theirs to put back online'. No router-level role guard, validator, model hook or other control blocks the chain: the routes add only idParam validation, and AlumniJob.status is a plain enum with no transition hook. The reinstated job keeps the stale removedBy/removeReason fields.

**Source trace**

1. *entrypoint* `server/src/routes/alumniRoutes.js:277` — `PATCH /alumni/jobs/:id/close`: Authenticated route (mounted behind protect at routes/index.js:2131) with only idParam validation; no role or status guard.
1. *propagation* `server/src/controllers/alumni/alumniJobsController.js:237` — `closeJob`: Only checks that the caller is the poster or an admin.
1. *propagation* `server/src/controllers/alumni/alumniJobsController.js:241` — `closeJob`: Sets job.status='closed' with no status check, turning a 'removed' or 'pending_review' job into 'closed'.
1. *propagation* `server/src/routes/alumniRoutes.js:278` — `PATCH /alumni/jobs/:id/reopen`: The poster calls reopen on the job, which is now 'closed'.
1. *propagation* `server/src/controllers/alumni/alumniJobsController.js:257` — `reopenJob`: The guard allows a non-admin to reopen because the status is now 'closed'.
1. *sink* `server/src/controllers/alumni/alumniJobsController.js:261` — `reopenJob`: Sets status='open'. The job is then listed to students (listJobs line 32) and accepts applications (applyToJob line 313).

**Evidence**

- `server/src/controllers/alumni/alumniJobsController.js:241`: job.status = 'closed' is set with no prior status check.
- `server/src/controllers/alumni/alumniJobsController.js:255`: Comment states the intent: a job removed by staff, or still awaiting review, is not the poster's to put back online.
- `server/src/controllers/alumni/alumniJobsController.js:257`: reopenJob lets a non-admin reopen only from 'closed' or 'expired'.
- `server/src/controllers/alumni/alumniJobsController.js:283`: removeJob (HOD/admin, reason required at line 279) sets status='removed'. This is the staff moderation state that close overwrites.
- `server/src/controllers/alumni/alumniJobsController.js:216`: updateJob refuses edits only while the status is 'removed', so after the chain the poster can also edit the reinstated job.
- `server/src/controllers/alumni/alumniJobsController.js:140`: Posts by roles other than admin/hod are created as 'pending_review' only when env.alumni.jobsRequireApproval is true (env.js:213, ALUMNI_JOBS_REQUIRE_APPROVAL==='true').
- `server/src/controllers/alumni/alumniJobsController.js:32`: Students see only jobs with status 'open', so the reopened job becomes visible again.
- `server/tests/alumni-security.test.js:97`: The existing test covers only a direct reopen of a removed job, not the close-then-reopen chain.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check (Docker daemon stopped on the Windows host), so the chain has not been observed running.
- The pending_review variant applies only when ALUMNI_JOBS_REQUIRE_APPROVAL=true in the deployment. The reviewed source (render.yaml) does not set it, so by default only the staff-removal variant applies; the Render dashboard environment has not been observed.

**Resolution plan**

- *Local (sandboxed, dummy data):* In a sandboxed test run against a disposable MongoDB, add a test after alumni-security.test.js:97-104. The alumni fixture POSTs /alumni/jobs with jobBody (expect 201). The hod fixture DELETEs /alumni/jobs/:id with body { reason: 'Misleading posting' } (expect 200). The alumni fixture sends PATCH /alumni/jobs/:id/close (currently expected 200) and then PATCH /alumni/jobs/:id/reopen (currently expected 200). Assert that AlumniJob.findById(id).status === 'open' and that GET /alumni/jobs as a student fixture in an eligible department lists the job. Repeat with ALUMNI_JOBS_REQUIRE_APPROVAL=true to show pending_review -> close -> reopen -> open. Fix: in closeJob, refuse with 409 unless the status is 'open' or 'expired', using an atomic AlumniJob.findOneAndUpdate({ _id: id, status: { $in: ['open', 'expired'] } }, { status: 'closed' }); admins may keep their override. After the fix, the test should get a non-200 response from /close and the status should stay 'removed' or 'pending_review'.
- *Owner-observed (no audit traffic):* The owner checks the Render service environment to see whether ALUMNI_JOBS_REQUIRE_APPROVAL is set. Read-only, the owner queries AlumniJob documents where removedBy exists, removedBy is not the poster, and status is 'closed' or 'open', to see whether the chain has already been used.

## 4. Production manifest allows plain-HTTP SMS, which would send the vendor API key, parent numbers and gate-pass OTPs unencrypted

- **Fingerprint:** `render.yaml:SMS_ALLOW_INSECURE_HTTP:collegeSmsProvider-cleartext-apikey`
- **Affected boundary / root cause (claimed):** The production manifest overrides the code's secure default (collegeSmsProvider.js:49-53 refuses non-https URLs in production) by setting SMS_ALLOW_INSECURE_HTTP=true (render.yaml:59-60). deliver() then puts the static vendor API key and personal data in the URL query string (collegeSmsProvider.js:56-60) and sends it with fetch over http:// (line 64), with no transport protection. The only other control is a console warning (env.js:146-148, collegeSmsProvider.js:54).

render.yaml sets SMS_ALLOW_INSECURE_HTTP="true" for the production service, with a comment saying the college vendor (bulksms.2020sms.com) has no HTTPS endpoint. It also turns on OTP_SMS_ENABLED="true", and OTP_PROVIDER defaults to college_sms, so collegeSmsProvider is the live sender. When the flag is on and SMS_API_URL is an http:// URL, deliver() skips its production HTTPS-only check. It then sends a GET whose query string holds the static SMS API key, the sender ID, the template ID, the parent's mobile number (91 prefix) and the full message text. For a parent OTP that text includes the student's name and the plaintext OTP; for an exit notice it includes the name, date and time. SMS_API_URL itself is set in the Render dashboard (sync: false) and the code defaults to https://, so the cleartext send happens only if the dashboard value is http://, which the manifest comment implies. A passive observer on the network path between the Render instance and the vendor could read the long-lived API key and reuse it to send SMS as the college's DLT-registered sender (SMS spend and parent-facing spoofing), and could collect parent phone numbers, student names and OTPs. The attacker needs an on-path network position. An intercepted OTP gives little direct gain, because only the authenticated class faculty can submit it.

**Source trace**

1. *entrypoint* `server/src/controllers/gatePassController.js:751` — `requestParentOtp`: An authenticated faculty member asks for a parent OTP on a pending_faculty gate pass. This calls otpService.requestOtp with the student's name (line 757).
1. *propagation* `server/src/services/otp/otpService.js:183` — `requestOtp`: provider.sendOtp is called with the parent's mobile number, the student's name and the plaintext OTP. The provider is chosen by getOtpProvider (lines 18-23), which returns collegeSmsProvider when OTP_SMS_ENABLED=true and OTP_PROVIDER is unset or college_sms (env.js:120-121).
1. *propagation* `render.yaml:59` — `jnn-api service envVars`: SMS_ALLOW_INSECURE_HTTP is set to "true" (value on line 60) for the production web service. OTP_SMS_ENABLED="true" is set at lines 41-42, and SMS_API_URL is a dashboard secret (lines 55-56).
1. *propagation* `server/src/config/env.js:144` — `env.sms.allowInsecureHttp`: The flag becomes env.sms.allowInsecureHttp=true. Its only effect at startup is a console warning (lines 146-148). apiUrl defaults to https:// at line 141 unless SMS_API_URL overrides it.
1. *propagation* `server/src/services/otp/providers/collegeSmsProvider.js:49` — `deliver()`: A non-https URL is refused in production only when allowInsecureHttp is false (lines 50-53). Otherwise the code just logs a warning (line 54) and carries on.
1. *propagation* `server/src/services/otp/providers/collegeSmsProvider.js:56` — `deliver()`: apikey, senderid, templateid, number and message are set as URL query parameters (lines 56-60).
1. *sink* `server/src/services/otp/providers/collegeSmsProvider.js:64` — `deliver()`: fetch(url, {method:'GET'}) sends the request to the vendor. If SMS_API_URL is http://, it travels over plain HTTP.

**Evidence**

- `render.yaml:59`: SMS_ALLOW_INSECURE_HTTP is "true" (line 60). The comment at lines 57-58 says bulksms.2020sms.com has no HTTPS endpoint, so production must opt in to plain http.
- `render.yaml:41`: OTP_SMS_ENABLED is "true", so the real SMS provider is active in production.
- `server/src/services/otp/providers/collegeSmsProvider.js:50`: The only production transport guard is bypassed when the flag is set.
- `server/src/services/otp/providers/collegeSmsProvider.js:56`: url.searchParams.set('apikey', env.sms.apiKey) puts the static credential in the query string. The number and the message text, which carries the student name and OTP (renderOtpSms, line 12-13), follow at lines 59-60.
- `server/src/config/env.js:147`: The startup warning itself says the API key, parent numbers and OTPs may cross the network unencrypted.
- `server/src/services/otp/otpService.js:244`: sendParentMessage, which sends gate-pass exit notices from server/src/services/gatePassReturn.js:147, uses the same deliver path through collegeSmsProvider.sendMessage.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check (Docker daemon stopped on the Windows host), so no target code was executed.
- The real SMS_API_URL value in the Render dashboard (sync: false) is not visible in source. The code default is https://, so whether the deployed value is http:// has to be observed by the owner.
- Whether the vendor offers an HTTPS endpoint, and whether it IP-restricts or scopes the API key, is an external vendor fact.
- The exploitability depends on an attacker holding an on-path network position between Render egress and the vendor, which source cannot establish.

**Resolution plan**

- *Local (sandboxed, dummy data):* In an isolated sandbox with no external network and dummy values: NODE_ENV=production, the required dummy secrets, OTP_SMS_ENABLED=true, SMS_ALLOW_INSECURE_HTTP=true, SMS_API_KEY=dummykey, SMS_SENDER_ID=TEST, SMS_OTP_TEMPLATE_ID=1, SMS_EXIT_TEMPLATE_ID=2, SMS_API_URL=http://127.0.0.1:<port>/vb/apikey.php. Import collegeSmsProvider and call sendOtp({to:'9999999999',studentName:'Test',otp:'1234'}) against a loopback HTTP listener that returns 200. Observe a cleartext GET whose query holds apikey=dummykey, number=919999999999 and message text containing 'Test' and '1234'. As a control, repeat with SMS_ALLOW_INSECURE_HTTP unset and observe a 503 with no request sent.
- *Owner-observed (no audit traffic):* Without sending any SMS, the owner checks in the Render dashboard whether SMS_API_URL starts with http://. They then ask the vendor for an HTTPS endpoint and for API-key IP allowlisting. If HTTPS is available, they set SMS_API_URL to https://, remove SMS_ALLOW_INSECURE_HTTP from render.yaml (or set it to "false") and rotate the API key, because it may already have crossed the network in clear text.

## 5. Any 'Authorization: Bearer <anything>' header gets past the public-route maintenance/lockdown gate

- **Fingerprint:** `public-platform-gate-unverified-bearer-bypass`
- **Affected boundary / root cause (claimed):** publicPlatformGate (server/src/middleware/platform.js:15) treats a 'Bearer ' prefix as proof that protect and platformGate will judge the request downstream. But public routers mounted after publicPlatformGate and before protect (server/src/routes/index.js:274-310) never reach those middlewares, and their handlers do not check the platform mode themselves.

publicPlatformGate is meant to close every public endpoint except login/refresh/logout/status while the platform is in maintenance, lockdown or recovery. It calls next() for any request whose Authorization header starts with 'Bearer ', without checking the token or the platform mode, on the assumption that protect and platformGate will decide later (platform.js:15). The routers mounted between publicPlatformGate (index.js:271) and protect (index.js:313) never run protect or platformGate. These are /auth/register (index.js:274, refused anyway unless ALLOW_SELF_SIGNUP is on, authController.js:161), /auth/alumni-claim GET/POST (index.js:302), the HMAC-gated tracker webhook (index.js:306) and the Skill Wallet public gallery, leaderboard and signed file router (index.js:310). Neither the alumni claim router nor its controller checks the platform mode. So an anonymous caller who adds 'Authorization: Bearer x' can, during an emergency lockdown, redeem a pending alumni invite token: this creates an alumni User and AlumniProfile, consumes the invite and creates a Session with refresh/access tokens. They can also read the invite's prefilled PII through GET, and read already-published gallery data. The impact is limited. The session issued during lockdown cannot be used: platformGate (platform.js:24) blocks every protected route and refresh blocks the refresh (authController.js:435) for anyone except a Super Admin until the mode returns to normal. Gallery and file content is limited to what is already published or token-authorized. The core effect is that the lockdown freeze fails for public state-changing flows: accounts are created and invites consumed while the platform is closed. Nothing here gives cross-user data access or privilege escalation.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:302` — `router.use('/auth/alumni-claim', alumniPublicRouter)`: Anonymous public alumni claim router, mounted after publicPlatformGate (line 271) and before protect (line 313) and platformGate (line 315). CSRF does not apply: /auth/alumni-claim is in CSRF_EXEMPT_PATHS (security.js:129).
1. *propagation* `server/src/middleware/platform.js:15` — `publicPlatformGate`: If the Authorization header starts with 'Bearer ', next() is called before getPlatformState() runs. There is no token verification and no mode check.
1. *propagation* `server/src/routes/alumniRoutes.js:33` — `alumniPublicRouter POST /:token`: Only authLimiter, the password format and the accept flag are checked. There is no platform-mode check.
1. *sink* `server/src/controllers/alumni/alumniImportController.js:436` — `submitPublicClaim`: Creates the alumni User (line 436) and AlumniProfile (line 447), marks the invite claimed (line 458) and creates a Session with signed refresh/access tokens (lines 484-495) while the platform is outside normal mode.

**Evidence**

- `server/src/middleware/platform.js:9`: PUBLIC_OPEN lists only /auth/login, /auth/refresh, /auth/logout and /platform/status as allowed outside normal mode.
- `server/src/routes/index.js:310`: The Skill Wallet public router (gallery, leaderboard, signed files) is mounted before protect and can be reached through the same bypass. Its content is limited to published or token-authorized data.
- `server/src/routes/index.js:306`: The tracker webhook can be reached through the bypass during maintenance. It is still HMAC-gated by transport.trackerWebhook.
- `server/src/controllers/alumni/alumniImportController.js:384`: getPublicClaim returns the invite's name, email, phone, department and company to the token holder. With the bypass this also works during lockdown.
- `server/src/services/platformState.js:74`: platformAllows lets only a Super Admin through outside normal mode. platformGate (platform.js:24) and refresh (authController.js:435) use it, so the session created during lockdown cannot be used until the mode returns to normal. This limits the impact.
- `server/src/controllers/authController.js:161`: register is refused unless env.allowSelfSignup is set, so register is reachable through the bypass only in deployments that enable self sign-up.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check: the Docker daemon is stopped on the Windows host and Windows Sandbox is unavailable. The parent therefore forbade running the target's tests or server, and the bypass has not been observed in a running instance.

**Resolution plan**

- *Local (sandboxed, dummy data):* Inside an isolated sandbox with a throwaway mongo:7 test DB and no external network, add a test in server/tests modelled on the super-admin tests. (1) Set the PlatformState document {_id:'platform'} to mode 'lockdown' and call invalidatePlatformCache(). (2) Insert a dummy pending AlumniInvite whose tokenHash = hashToken('dummytoken'), with a future expiresAt and email dummy-alumni@example.test. (3) GET /api/auth/alumni-claim/dummytoken and GET /api/skill-wallet/public/gallery (confirm the exact public path in skillWalletRoutes.js) without an Authorization header, and expect 503 MAINTENANCE. (4) Repeat with 'Authorization: Bearer x', and expect 200/404 handler responses instead of 503. (5) POST /api/auth/alumni-claim/dummytoken with header 'Authorization: Bearer x' and 'X-Client: mobile' (or no browser headers) and body {password:'Passw0rd1',accept:true}. Expect 200 with tokens, a new User with role 'alumni' and the invite status 'claimed'. (6) Check that the returned access token gets 503 on GET /api/auth/me while lockdown is active, which confirms the limited impact.
- *Owner-observed (no audit traffic):* Owner-observed only, in a staging copy rather than production: put the staging instance into maintenance, run curl -i https://<staging>/api/skill-wallet/public/gallery once without and once with -H 'Authorization: Bearer x', compare 503 with 200, and then return the instance to normal. Do not redeem real invites.

## 6. An attacker's own successful logins reset the per-IP sign-in throttle, so it never limits password spraying from one IP

- **Fingerprint:** `loginSecurity:clearIpFailure-success-decay-bypasses-ip-throttle`
- **Affected boundary / root cause (claimed):** clearIpFailure (server/src/utils/loginSecurity.js:121-129; decrement at line 124) lowers the per-IP failure counter by 2 on every successful sign-in from that IP, and authController.login calls it on every success (server/src/controllers/authController.js:354). The same client that causes the failures therefore controls the reset. The decrement is not tied to the accounts that failed, and a success on an unrelated attacker-owned account counts as evidence that the IP is benign.

The persistent per-IP failure counter (LoginThrottle, kind 'ip') is the server's only persistent control meant to stop one address from guessing passwords across many accounts. It locks the IP for 5 minutes at 10 failures, 15 minutes at 20 and 60 minutes at 30. clearIpFailure subtracts 2 from that counter after every successful sign-in from the same IP, whichever account signed in. Anyone who holds a valid account (for example any student) can repeat this cycle: 2 wrong-password attempts against victim accounts, then 1 correct sign-in to their own account. The IP counter then stays at 0-2 and never reaches 10, so the IP lock never applies. The only per-IP bound left is authLimiter, which is in memory and per process: 20 non-successful requests per 15 minutes, and successful requests are not counted. That allows about 80 guesses per hour per IP per instance with no end. Without the reset, a sustained run gets at most about 1 guess per hour once the counter passes 30. Each victim gets at most 2 guesses per more-than-24-hour cooldown, which stays under the per-account lock (every 3rd failure) and its email and in-app alert. The result is a silent, slow password spray across the user base from one IP. The same rate also lets one IP keep a limited set of chosen accounts locked, roughly 26 at the 60-minute tier. That lockout does trigger alert emails to the victims. Detection-only controls remain: SOC computeAlerts flags 10 or more LOGIN_FAILED events from one IP, and every success is logged as LOGIN_SUCCESS with the attacker's own account, so the attack can be traced. A dedicated attacker could also rotate IPs, so this weakens a defence-in-depth bound and does not remove a primary authentication control.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:286` — `POST /api/auth/login`: Anonymous login route (after publicPlatformGate at line 271). Only authLimiter (line 288; in-memory, 20 non-successful requests per 15 minutes, skipSuccessfulRequests) and input validators run before the controller.
1. *propagation* `server/src/controllers/authController.js:181` — `login`: checkIpThrottled(req.ip) rejects with 423 only when the LoginThrottle IP entry has an active lockUntil.
1. *propagation* `server/src/controllers/authController.js:266` — `login (wrong password, existing account)`: Each wrong password calls recordIpFailure(req.ip). The per-account failedLogins counter only locks and alerts at every 3rd failure (line 271-272), so 2 guesses per victim stay silent.
1. *propagation* `server/src/utils/loginSecurity.js:95` — `recordIpFailure`: Increments the IP counter and sets a lock only when count >= 10 (5m), >= 20 (15m) or >= 30 (60m) (lines 101-103).
1. *propagation* `server/src/controllers/authController.js:354` — `login (success)`: A successful sign-in to any account, including the attacker's own, calls clearIpFailure(req.ip) with no link to the accounts that failed.
1. *sink* `server/src/utils/loginSecurity.js:124` — `clearIpFailure`: Sets count = max(0, count - 2) and deletes the row at 0 (line 128). At a 2:1 ratio of failures to successes the IP counter never reaches 10, so no IP lock is ever applied.

**Evidence**

- `server/src/utils/loginSecurity.js:124`: findOneAndUpdate pipeline $set count = $max[0, $subtract[$count, 2]] on the IP key, run on every success from that IP.
- `server/src/utils/loginSecurity.js:101`: IP lock tiers 30 -> 60m, 20 -> 15m, 10 -> 5m. Apart from clearIpFailure, the only decay is the 2h idle expiry (ENTRY_MAX_AGE, line 14, refreshed on each bump at line 26).
- `server/src/controllers/authController.js:180`: Comment states the intended invariant: the IP check 'protects against distributed attacks from a single IP'.
- `server/src/controllers/authController.js:354`: clearIpFailure(req.ip) runs on every successful sign-in, whichever account it is for.
- `server/src/middleware/rateLimit.js:37`: authLimiter: 20 requests per 15 minutes per IP, skipSuccessfulRequests: true, default in-memory (per-process) store. It is the only remaining per-IP bound, about 80 failures per hour per instance.
- `server/src/controllers/authController.js:243`: The per-account failedLogins counter resets only after more than 24h since the last failure, so 2 guesses per account per cooldown never reach the 3-failure lock, email or in-app alert at lines 271-310.
- `server/src/services/soc/detections.js:33`: Mitigation, detective only: computeAlerts groups LOGIN_FAILED events by IP and flags 10 or more (medium) or 30 or more (high). It only detects and does not block.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check (Docker daemon stopped, no Windows Sandbox on this host), so the interleaving behaviour has not been observed.
- The number of deployed Render instances (which multiplies the in-memory authLimiter bound) and any edge or WAF per-IP rate limit in front of /api/auth/login are not visible in source; an upstream limit would add an independent per-IP bound.

**Resolution plan**

- *Local (sandboxed, dummy data):* Inside an approved sandbox with a throwaway mongo test DB, follow the server/tests supertest pattern. Create dummy attacker user A with a known password and 9 dummy victim users. From one IP (supertest default), loop 9 times: POST /api/auth/login for victim[i] with a wrong password twice, then POST /api/auth/login for A with the correct password. That is 18 failures, under the 20-failure authLimiter window. Assert that no response is 423 with ipLocked, and that LoginThrottle.findOne({kind:'ip'}) is absent or has count < 10 at the end. Control run: the same 18 failures without the successful logins should produce a 423 ipLocked response at the 11th attempt (the lock is set on the 10th failure). Unit-level alternative: call recordIpFailure(ip) twice, then clearIpFailure(ip), repeated N times, and assert that checkIpThrottled(ip).locked stays false.
- *Owner-observed (no audit traffic):* Owner, without testing against production: confirm the Render instance count and whether Render or any edge proxy or WAF applies a per-IP request limit to POST /api/auth/login. Review SecurityLog and LoginHistory for one IP alternating LOGIN_FAILED against several accounts with LOGIN_SUCCESS for one account.

## 7. Login 'attempts remaining' value reveals which emails have accounts: the unknown-email counter is per IP with a 2h idle TTL, while the real account counter is global and kept for 24h

- **Fingerprint:** `loginSecurity:anon-counter-scope-diverges-from-account-counter-enumeration`
- **Affected boundary / root cause (claimed):** The emulated counter for unknown emails is keyed by client IP plus email (anonKey, server/src/utils/loginSecurity.js:19) and expires after 2h idle (ENTRY_MAX_AGE at loginSecurity.js:14, TTL index at server/src/models/LoginThrottle.js:26). The real counter is per account with no IP in the key, and only a 24h idle cooldown or a successful login resets it (User.failedLogins at server/src/controllers/authController.js:243 and 268). The remaining-attempts value derived from each counter is returned to the client (authController.js:235 and 323), so the two branches can be told apart once requests come from different IPs or more than 2h apart.

POST /api/auth/login tries to make unknown emails look like real accounts so attackers cannot tell which emails exist. Every 401 includes 'N attempt(s) remaining' in the message and in the remainingAttempts field. For an existing account, N comes from User.failedLogins. That counter is shared across all client IPs and is only reset when the last failure is more than 24h old or when the user signs in successfully. For an unknown email, N comes from a LoginThrottle row keyed by sha256('anon', req.ip, email), which the TTL index deletes after 2h idle. An anonymous attacker can send one wrong-password attempt for a target email from IP A and then one from IP B, or send one attempt, wait more than 2h, and send another from the same IP. An existing account answers '1 attempt(s) remaining'. An unknown email answers '2 attempt(s) remaining'. Two probes per email stay below the 3-failure lock, so no lockout email or notification goes to the real user. The only per-IP bounds are authLimiter and the LoginThrottle 'ip' counter, and neither stops this low-volume probing. The result is an account-existence oracle for college staff and student emails, which helps targeted password spraying and phishing. Caveats: the two probes add 2 to the real user's failedLogins for up to 24h, and a successful sign-in by the real user between the probes resets the count and causes a false negative.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:286` — `POST /api/auth/login (public, authLimiter + email/password validators only)`: Anonymous login with an attacker-chosen email and a wrong password.
1. *propagation* `server/src/controllers/authController.js:222` — `login, unknown-email branch`: recordAnonFailure(req.ip, normalizedEmail) increments a LoginThrottle counter keyed by IP + email.
1. *propagation* `server/src/utils/loginSecurity.js:19` — `anonKey / bumpCounter`: The key includes the client IP, so the count starts at 1 from every new IP. bumpCounter (line 26) sets expiresAt to now + 2h, so the TTL index removes an idle row after 2h.
1. *propagation* `server/src/controllers/authController.js:268` — `login, existing-account wrong password`: user.failedLogins is incremented regardless of IP. It is reset only when the last failure is more than 24h old (line 243) or on a successful login (line 349).
1. *sink* `server/src/controllers/authController.js:323` — `login 401 response (existing account)`: Returns 'Invalid email or password. ${remaining} attempt(s) remaining...' plus remainingAttempts from the global counter. The unknown-email branch (line 235) returns the same template from the per-IP counter, so the value differs across IPs or after a 2h gap.

**Evidence**

- `server/src/utils/loginSecurity.js:19`: anonKey = throttleKey('anon', ip || 'unknown', email): the counter is scoped per IP.
- `server/src/utils/loginSecurity.js:14`: ENTRY_MAX_AGE is 2 hours. bumpCounter (line 26) sets expiresAt to now + 2h. The LoginThrottle TTL index (server/src/models/LoginThrottle.js:26) deletes idle anon rows.
- `server/src/controllers/authController.js:233`: Code comment: 'any difference in the message tells an attacker which emails have accounts'. This is the anti-enumeration invariant the code intends to keep.
- `server/src/controllers/authController.js:235`: The unknown-email 401 includes anonRes.remainingAttempts, which comes from the per-IP counter.
- `server/src/controllers/authController.js:243`: The existing-account counter is only reset when the last failure is more than 24h old. That is 24h, not 2h, and the counter has no IP in its key.
- `server/src/controllers/authController.js:323`: The existing-account 401 includes remaining, derived from the global user.failedLogins.
- `server/src/utils/loginSecurity.js:61`: getRemainingAttempts / recordAnonFailure use the same modulo-3 arithmetic, so the only difference is the counter's scope and lifetime, not the formula.

**Blockers**

- No OS-enforced sandbox is available on this host (Docker daemon stopped, no Windows Sandbox), so the bounded local reproduction could not be run and the finding rests on source review only.
- Owner policy fact: whether the existence of an @jnn.edu.in account address is treated as confidential. Institutional email formats may already be predictable, which lowers the impact.

**Resolution plan**

- *Local (sandboxed, dummy data):* Use the existing server test harness (supertest + test MongoDB) with app trust proxy = 1. Create a dummy user u@test.local. Send POST /api/auth/login {email:'u@test.local', password:'wrong'} with X-Forwarded-For: 10.0.0.1, then send the same request with X-Forwarded-For: 10.0.0.2. Expected: the second response has remainingAttempts 1. Repeat with nobody@test.local. Expected: the second response has remainingAttempts 2. Same-IP variant: after one failure for each email, delete the kind:'anon' LoginThrottle row to simulate the 2h TTL, then repeat from the same IP. Expected: the existing account reports 1 and the unknown email reports 2. Never send a third probe, so the dummy account is not locked.
- *Owner-observed (no audit traffic):* The owner should confirm, with a test account they own, that production login 401 responses still include remainingAttempts and the attempt text unchanged (no edge rewriting). They should also decide whether the existence of a college email account is considered confidential.

## 8. Login CSRF: Origin 'null' skips the Origin allowlist on CSRF-exempt POST /api/auth/login (alumni-claim variant narrower)

- **Fingerprint:** `csrf-guard-null-origin-exempt-auth-login`
- **Affected boundary / root cause (claimed):** security.js:49-57 treats an opaque or unparseable Origin ('null') as absent instead of rejecting it: extractOrigin returns null, so the `if (requestOrigin)` allowlist block at security.js:93 is skipped. For CSRF_EXEMPT_PATHS (security.js:129) no other check applies (security.js:116), so a browser request with an opaque or suppressed origin, which still carries Sec-Fetch-Site: cross-site, is accepted on session-issuing endpoints.

csrfAndOriginGuard is the only cross-site defense for the CSRF-exempt paths /auth/login, /auth/register, /auth/refresh and /auth/alumni-claim. extractOrigin() returns null for the literal Origin value 'null' because new URL('null') throws, and with no Referer header requestOrigin is null, so the allowlist block is skipped; the exempt-path check then skips the double-submit token check. Per the Fetch spec a browser sends Origin: null on a cross-site form POST whose referrer policy is no-referrer, with no Referer. A cross-site page can therefore auto-submit a top-level application/x-www-form-urlencoded POST to /api/auth/login with the attacker's own credentials (express.urlencoded parses it; the express-validator chain accepts it). The 200 response sets the attacker's refresh cookie (Path=/api/auth, SameSite=Strict) and CSRF cookie in the victim's browser. When the victim next opens the SPA, App.jsx calls POST /api/auth/refresh on load with credentials:'include', so the victim is signed into the attacker's account, and data the victim then submits, such as gate-pass requests, complaints, chat messages or skill-wallet uploads, lands in an attacker-controlled account. An existing victim session in another tab is also overwritten once its in-memory access token next refreshes. Narrower variants: /auth/register is disabled by default (env.allowSelfSignup). /auth/refresh has no cross-site effect because the Strict refresh cookie is not sent cross-site. POST /auth/alumni-claim/:token has the same guard gap, but the attacker needs their own unused alumni invitation token. Impact is login CSRF (session fixation into the attacker's account), not takeover of the victim's account.

**Source trace**

1. *entrypoint* `server/src/app.js:167` — `createApp`: All /api traffic passes apiLimiter then csrfAndOriginGuard before routes. express.urlencoded (app.js:121) parses a cross-site HTML form body, and cors() (app.js:110) does not block a top-level form navigation.
1. *propagation* `server/src/middleware/security.js:90` — `csrfAndOriginGuard`: requestOrigin = extractOrigin(origin) || extractOrigin(referer). extractOrigin('null') hits new URL('null'), which throws and returns null (security.js:49-57). With no Referer, requestOrigin is null.
1. *propagation* `server/src/middleware/security.js:93` — `csrfAndOriginGuard`: `if (requestOrigin)` is false, so the allowlist rejection (ORIGIN_BLOCKED, line 104) is never evaluated.
1. *propagation* `server/src/middleware/security.js:116` — `csrfAndOriginGuard`: req.path '/auth/login' matches CSRF_EXEMPT_PATHS (line 129), so the double-submit check, which would otherwise reject the request because Sec-Fetch-Site is present, is skipped.
1. *propagation* `server/src/routes/index.js:287` — `POST /auth/login`: authLimiter plus express-validator email/password rules accept form-encoded fields and call auth.login. No captcha, MFA or second factor is required (authController.js login, lines ~180-368).
1. *sink* `server/src/controllers/authController.js:124` — `issueSession`: For a non-mobile request (Sec-Fetch-Site present, so isMobileClient is false), setRefreshCookie and setCsrfCookie (line 126) write the attacker account's session cookies into the victim's browser. login reaches this at line 368.

**Evidence**

- `server/src/middleware/security.js:53`: Origin is normalized only via new URL(...).origin. A parse failure, including the literal 'null', returns null instead of being rejected.
- `server/src/middleware/security.js:129`: CSRF_EXEMPT_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/alumni-claim'].
- `server/src/utils/tokens.js:47`: setRefreshCookie: httpOnly, Secure in prod, SameSite=Strict, Path=/api/auth. Under RFC 6265bis, SameSite=Strict does not stop a cookie being set by the response to a top-level cross-site navigation.
- `client/src/App.jsx:195`: On first load the SPA calls refreshSession() (POST /api/auth/refresh, credentials:'include'), so a planted refresh cookie silently signs the victim into the attacker's account.
- `server/src/controllers/alumni/alumniImportController.js:500`: submitPublicClaim also sets a refresh cookie for a non-mobile request on the exempt /auth/alumni-claim prefix. This requires the attacker's own valid unused claim token.

**Blockers**

- No OS-enforced sandbox is available on this Windows host (Docker daemon stopped, no Windows Sandbox), so the bounded local server-side request test could not be executed.
- Decisive browser behavior is not source-visible: whether current target browsers send Origin: null (and no Referer) on a no-referrer cross-site top-level form POST, and whether they store the __Secure-cc_refresh / __Host-cc_csrf SameSite=Strict cookies from that navigation's response.

**Resolution plan**

- *Local (sandboxed, dummy data):* In server/tests (following tests/csrf-self-heal.test.js) against the mongo:7 test DB, with a dummy active student whose password is known: send supertest POST /api/auth/login with headers {Origin: 'null', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/x-www-form-urlencoded'}, body email=<dummy>&password=<dummy>, no Referer and no cookies. Vulnerable: 200 with Set-Cookie for the refresh and CSRF cookies. Fixed: 403 ORIGIN_BLOCKED. Control: repeat with Origin https://evil.example and expect 403 ORIGIN_BLOCKED; repeat with Sec-Fetch-Site: cross-site and no Origin/Referer to decide whether that shape should also be blocked.
- *Owner-observed (no audit traffic):* Owner-observed in current Chrome and Firefox against a staging instance (not production) with a dummy account: host a page on another origin with <meta name=referrer content=no-referrer> that auto-submits a form POST to https://<staging>/api/auth/login with the dummy credentials. In devtools, confirm the request carries Origin: null and no Referer, the response is 200, and the app origin now stores __Secure-cc_refresh and __Host-cc_csrf. Then open the app and confirm it loads signed in as the dummy account. Delete the dummy session afterwards.

## 9. SOC error capture keeps alumni invite-claim bearer tokens from the URL path and sends them to the AI provider

- **Fingerprint:** `soc-route-template-keeps-path-bearer-tokens`
- **Affected boundary / root cause (claimed):** In sanitize.js, routeTemplate/redactLine (lines 82-89) have no rule for opaque high-entropy path segments. capture.js:129-130 stores the template of the raw originalUrl for every source, including public routes that carry tokens. The template design assumes secrets appear only in query strings or in key=value form, but the alumni claim API carries the bearer secret as a path parameter (alumniRoutes.js:32-34; client api.js:962-965).

Requests to GET/POST /api/auth/alumni-claim/:token can get a 429 (from the shared per-IP authLimiter or from apiLimiter), a 403 (on the POST this can only be an Origin-allowlist refusal, because the claim path is exempt from the CSRF double-submit check) or a non-maintenance 5xx. In each case captureError stores routeTemplate(req.originalUrl) in ErrorEvent.route. routeTemplate replaces only the query string, standalone 24-hex ObjectIds, UUIDs and all-digit segments, and none of the redactLine patterns match a bare 64-hex path segment, so the raw claim token is kept. The row is retained for 90 days after it was last seen. The Super Admin SOC console shows it (getError/explain.js), and the facts that the SOC ai-explain feature sends to the third-party Groq API include it. While the invite is still pending and unexpired (default 14 days), anyone holding the token can read the invitee's PII (name, email, phone, department, company, designation, location) through the public GET endpoint and create the alumni account with a password they choose through the public POST endpoint. Calibration: the staff who import or resend invites already receive the raw claimUrl (alumniImportController.js:211, 363). That limits how much exposure inside the institution adds. The clearest reader outside the boundary is the external AI provider, plus anyone who can read the database or its backups. The window is short because a claimed, revoked or expired token stops working.

**Source trace**

1. *entrypoint* `server/src/routes/alumniRoutes.js:32` — `alumniPublicRouter GET/POST /:token (mounted at /auth/alumni-claim, routes/index.js:302)`: Unauthenticated claim endpoints. The raw invite token is a path segment, and both endpoints use the shared authLimiter.
1. *propagation* `server/src/middleware/rateLimit.js:36` — `authLimiter`: One limiter instance allowing 20 failed requests per 15 minutes per IP, with skipSuccessfulRequests. It is shared with the other auth routes, so failed requests from the same IP make a claim request return 429.
1. *propagation* `server/src/middleware/error.js:76` — `captureRateLimited`: When a response finishes with status 429, it calls captureError with route: req.originalUrl. errorHandler (error.js:38-39) captures 403 and non-maintenance 5xx responses with req, which also uses req.originalUrl.
1. *propagation* `server/src/services/soc/capture.js:130` — `captureError`: route = routeTemplate(rawPath), where rawPath is o.route or req.originalUrl (line 129).
1. *propagation* `server/src/services/soc/sanitize.js:88` — `routeTemplate`: It strips the query string and replaces OBJECT_ID (\b[a-f0-9]{24}\b), UUID and /digits segments, then calls redactLine. A 64-hex segment has no word boundary inside it, so OBJECT_ID does not match, and no PATTERNS entry (Bearer, JWT, gsk_/sk-, key=value, email, phone) matches it either. The 87-character route is under the 160-character cap.
1. *propagation* `server/src/services/soc/capture.js:220` — `ErrorEvent upsert $setOnInsert.route`: The route containing the token is saved. The fingerprint includes the route (capture.js:147), so each token gets its own row.
1. *sink* `server/src/controllers/socController.js:190` — `aiExplain (POST /super-admin/soc/errors/:id/ai-explain)`: facts.route (line 170) goes through redactObject, which does not mask it (the key 'route' is not credential-like and the value matches no pattern), and is sent to groq.chat. getError and explain.js:96/167 also show it in the Super Admin console.

**Evidence**

- `server/src/controllers/alumni/alumniImportController.js:192`: The claim token is crypto.randomBytes(32).toString('hex'), which is 64 lowercase hex characters (the same at line 339 on resend).
- `server/src/controllers/alumni/alumniImportController.js:384`: getPublicClaim returns name, email, department, gradYear, company, designation, location and phone for a pending, unexpired token.
- `server/src/controllers/alumni/alumniImportController.js:409`: submitPublicClaim creates the alumni User with a password chosen by the caller, then marks the invite claimed, which ends the window.
- `server/src/controllers/alumni/alumniImportController.js:185`: Invites expire after inviteExpiresDays, 14 by default.
- `server/src/controllers/alumni/alumniImportController.js:211`: Staff who import invites already receive the raw claimUrl (and again on resend, line 363). This limits how much exposure inside the institution adds.
- `server/src/services/soc/sanitize.js:82`: OBJECT_ID, UUID and NUMBER_SEGMENT are the only rules that normalize the path. The PATTERNS list (lines 17-29) has no rule for opaque hex segments.
- `server/src/models/ErrorEvent.js:82`: A TTL index on lastSeenAt keeps ErrorEvent rows for RETAIN_DAYS=90 (line 31).
- `server/src/app.js:165`: captureRateLimited is mounted for all /api requests, including public ones, before apiLimiter (line 167).
- `server/src/routes/superAdminRoutes.js:171`: The ai-explain route is reachable by Super Admin and sends the stored route to the AI provider.
- `server/src/middleware/security.js:129`: /auth/alumni-claim is in CSRF_EXEMPT_PATHS, so the claim POST never gets a CSRF 403. A POST with a non-allowlisted Origin/Referer still gets the 403 ORIGIN_BLOCKED refusal (line 103), and errorHandler captures that 403.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check (Docker daemon stopped, no Windows Sandbox on this host), so the capture and retention of the token in ErrorEvent.route has not been observed.
- Who counts as an unauthorized reader is a policy question. Staff who import or resend invites already receive the raw claim URL. Whether Super Admin, SOC console viewers, or database/backup readers are outside the alumni-invite boundary is set by institutional policy, not by the source. The clearest outside reader is the Groq provider.
- Groq retention and logging of ai-explain prompts is outside the repository. Whether a Super Admin ever runs ai-explain on such a row, and whether claim requests actually hit 429/403/5xx in production, can only be checked by the owner.

**Resolution plan**

- *Local (sandboxed, dummy data):* In a sandboxed server test harness (mongo:7, supertest, no network, mocked Groq): (1) Unit-test routeTemplate('/api/auth/alumni-claim/' + 'a1'.repeat(32)) and assert that the 64-hex segment is returned unchanged. (2) Create a pending AlumniInvite with a known dummy raw token. From one test IP, send 20 failed POST /api/auth/login, then send GET /api/auth/alumni-claim/<token> and expect 429. Call flushCaptureForTests() and assert that ErrorEvent.findOne({source:'rate_limit'}).route contains the token. (3) With a mocked groq.chat, call POST /api/super-admin/soc/errors/<id>/ai-explain as a dummy re-authenticated super_admin and assert that the captured prompt contains the token. (4) From a fresh IP, GET /api/auth/alumni-claim/<token> and confirm the dummy invitee fields come back, then stop. Do not submit the claim.
- *Owner-observed (no audit traffic):* Owner check, read-only: query the production ErrorEvent collection for route matching /alumni-claim\/[0-9a-f]{20,}/ to see whether claim tokens have already been captured. Cross-check those rows against AlumniInvite rows that are still pending and unexpired, then revoke or resend the affected invites. Review the Groq account's prompt retention and logging settings for the SOC ai-explain key, and the SOC audit log (SOC_AI_EXPLANATION) for explanations run on alumni-claim rows.

## 10. Department-scoped Staff Management view grant reads campus-wide staff and HOD contact data via role-assignments overview

- **Fingerprint:** `vexon:role-assignments-overview:department-scoped-staff-grant-unscoped-read`
- **Affected boundary / root cause (claimed):** adminPolicy.js:85 maps /admin/role-assignments/ READ to staff_management.view regardless of the grant's scope; staffGrantGuard (adminPolicy.js:124-129) then sets req.policyGrant, which confinedRoleGuard (coeGuard.js:92) and authorize('admin') (auth.js:77) accept; getRoleAssignmentsOverview (adminRoleAssignmentController.js:18) queries User/TimetableSlot campus-wide with no department filter derived from the grant (unlike userListScope/adminAllows).

A staff account (faculty/hod/principal/dean/ao/chairman/office/coe) holding the additional policy staff_management.view at scope 'department' (allowed by staffCatalogue/normalizeStaffPolicies) is elevated by staffGrantGuard for GET /api/admin/role-assignments/overview, because the RULES entry maps that path to staff_management.view without checking the grant's scope. getRoleAssignmentsOverview ignores req.user and returns every department's active faculty (name, email, employeeId, class in-charge), every department's HOD with email and phone, and per-class student counts. The parallel GET /api/admin/users path limits the same grant to its department via userListScope, and policies.js states a scope is only offered where the server filters by it, so the department scope is silently not enforced here. Marginal exposure is bounded: principal/dean/ao/chairman already browse the campus directory; faculty can already enumerate all staff via the chat picker (chatScope.js:69,88-90) and read any staff profile including email/phone via GET /users/:id (peopleScope.js:114, userController.js:117). The real increment is for HOD grantees (normally limited to their own department, peopleScope.js:110), office/coe grantees (no profile access), and dean/ao/chairman (no contact fields on profiles): cross-department staff emails and HOD phone numbers, plus the campus in-charge map. Impact is a low-severity internal staff-contact disclosure that violates the configured department scope; writes on this router remain department-checked (adminPolicy.js:87-95).

**Source trace**

1. *entrypoint* `server/src/routes/index.js:874` — `GET /admin/role-assignments/overview`: Authenticated route (after protect and staffGrantGuard at line 319, confinedRoleGuard at 322) guarded only by authorize('admin', SUPER_ADMIN_ROLE).
1. *propagation* `server/src/middleware/adminPolicy.js:85` — `RULES`: Any READ under /admin/role-assignments/ requires only staff_management.view; no scope check, unlike the POST rule at 88-95 which denies a department-scoped grant outside its department.
1. *propagation* `server/src/middleware/adminPolicy.js:128` — `staffGrantGuard`: staffHolds (policies.js:203-205) checks module/action only, so a department-scoped grant sets req.policyGrant = true.
1. *propagation* `server/src/middleware/coeGuard.js:92` — `confinedRoleGuard`: req.policyGrant bypasses role confinement, so office/coe grantees also pass.
1. *propagation* `server/src/middleware/auth.js:77` — `authorize`: req.policyGrant accepted in place of the admin role.
1. *sink* `server/src/controllers/adminRoleAssignmentController.js:18` — `getRoleAssignmentsOverview`: Handler ignores req (_req); unscoped queries select all in-charge faculty (line 70) and all active faculty (line 77) with email/employeeId, and all HODs with email and phone (line 85), returned in res.json for every department.

**Evidence**

- `server/src/policies.js:13`: Catalogue comment: a scope is only offered where the server filters by it.
- `server/src/policies.js:54`: staff_management offers scopes campus and department; STAFF_GRANTABLE allows staff_management view for staff accounts (line 183) and staffCatalogue keeps the department scope (lines 208-216).
- `server/src/policies.js:288`: userListScope restricts the same grant to its department for GET /admin/users.
- `server/src/controllers/adminRoleAssignmentController.js:85`: HOD select includes phone and email for all departments; no req.user scope consulted.
- `server/src/utils/peopleScope.js:110`: Baseline: an HOD may view profiles only in its own department, so cross-department staff contacts are a real increment for HOD grantees (faculty already see any staff profile per line 114).

**Blockers**

- No OS-enforced sandbox available on this Windows host (Docker daemon stopped, no Windows Sandbox), so the bounded local reproduction could not be executed; source review only.
- Whether any deployed staff account actually holds staff_management.view at department scope (the Super Admin console allows saving it via staffCatalogue).

**Resolution plan**

- *Local (sandboxed, dummy data):* In a sandboxed copy using the server/tests staff-policies test style with a throwaway mongo: seed HOD A (dept CSE), faculty B (ECE, email set) and HOD H (ECE, phone set); as Super Admin after reauth PUT /api/admin/users/<A>/policies with [{module:'staff_management',actions:['view'],scope:'department',department:'CSE'}]; as A call GET /api/admin/users (expect only CSE staff) and GET /api/admin/role-assignments/overview (vulnerable if 200 and the body contains B's email and H's phone). Also confirm GET /api/users/<H> as A returns 403 to show the increment.
- *Owner-observed (no audit traffic):* Owner queries (read-only) for users with role in STAFF_GRANT_ROLES whose policies contain module 'staff_management' with scope 'department', and checks in the Super Admin console that such a grant can be saved; no requests to production endpoints are needed.

## 11. Faculty analytics returns low-attendance students from sections the faculty does not teach

- **Fingerprint:** `server/src/controllers/analyticsController.js:facultyAnalytics:subject-level-scope`
- **Affected boundary / root cause (claimed):** facultyAnalytics builds its AttendanceRecord match from Subject.find({faculty: req.user._id}) (analyticsController.js:191-196). It never intersects that match with the section-exact staffScope/roleScope clauses (facultyAssignments subject+department+section), which attendanceController.js applies to faculty attendance reads.

GET /api/analytics/faculty (authorize(...STAFF_VIEW) = admin, faculty, hod, principal) for a faculty caller selects every active Subject whose faculty array contains the caller and matches AttendanceRecord only by {subject: {$in: subjectIds}} plus a date window. It has no section or department constraint. The response includes per-subject totals and up to 50 below-75% rows, each joined to the student's name, rollNo, section and avatar plus the attendance percentage, for every section of those subjects. Subject.faculty is subject-level: timetable slot creation and update add the slot's faculty with $addToSet. Slot changes and deletions never remove them, and only a manual admin/HOD subject edit (updateSubject) can. So a faculty member scheduled only for section A of a subject, or one who no longer teaches it, receives section-B students' identities and attendance percentages. This contradicts the documented staffScope rule in attendanceController.js, which limits faculty to the exact timetable sections and says a faculty member assigned Section A must never see Section B. The disclosure is limited to authenticated faculty accounts. It covers student names, roll numbers, sections, avatars and attendance percentages, but no contact details.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:2123` — `GET /analytics/faculty`: Route is behind protect and the global guards, then authorize(...STAFF_VIEW) (admin, faculty, hod, principal per index.js:1018-1020) and rangeQuery validation. It applies no section scoping.
1. *propagation* `server/src/controllers/analyticsController.js:191` — `facultyAnalytics`: For role faculty, filter.faculty = req.user._id. Subject.find(filter) (line 194) yields subjectIds, and match = {subject: {$in: subjectIds}, date window} (line 196) has no section or department clause.
1. *propagation* `server/src/controllers/analyticsController.js:209` — `facultyAnalytics belowThreshold aggregation`: Groups AttendanceRecord by student+subject over the unscoped match, keeps rows below the threshold, and does $lookup on users projecting name, rollNo, section and avatar (line 214), limited to 50 rows.
1. *sink* `server/src/controllers/analyticsController.js:241` — `facultyAnalytics response`: res.json (line 234) returns belowThreshold with studentInfo for students in every section of the matched subjects, plus subjectStats and overall totals computed across all sections.

**Evidence**

- `server/src/controllers/attendanceController.js:71`: Documented staffScope invariant: faculty are limited to their actual teaching assignments (subject + department + section), and a faculty member assigned Section A must never see Section B.
- `server/src/controllers/attendanceController.js:116`: roleScope for faculty builds section-exact clauses from facultyAssignments for scheduled subjects and uses Subject.sections only for unscheduled listed subjects. facultyAnalytics applies none of this.
- `server/src/controllers/timetableController.js:808`: linkFacultyToSubject adds the slot's faculty to Subject.faculty with $addToSet when any slot of the subject is created or updated (callers at 846 and 882). Slot changes and deletions never remove the faculty. Only a manual admin/HOD updateSubject (line 217) that replaces the faculty array does.
- `server/src/controllers/analyticsController.js:214`: The belowThreshold $lookup projects student name, rollNo, section and avatar into the response.

**Blockers**

- No OS-enforced sandbox is available on this Windows host (Docker daemon stopped, no Windows Sandbox), so the bounded local fixture test could not be run. The source trace is complete and no compensating control was found.

**Resolution plan**

- *Local (sandboxed, dummy data):* In an isolated test DB, create subject S (semester N, sections ['A','B']), faculty FA with a timetable slot for S section A only, faculty FB with a slot for S section B, and dummy student SB in section B with AttendanceRecords for S that are mostly absent. Authenticate as FA, call GET /api/analytics/faculty?range=all, and assert that SB's name and rollNo appear in belowThreshold. As a control, the attendance endpoints that use staffScope for FA should not return SB. For regression after the fix, AND the match with the faculty's staffScope (export it from attendanceController or move it to a shared util) and expect SB to be absent.
- *Owner-observed (no audit traffic):* Not required. The behavior is fully source-determined. If owner confirmation is wanted, ask a faculty member who is scheduled for only one section of a multi-section subject to open the faculty analytics view and check whether the low-attendance list includes students from the other sections.

## 12. Faculty can list and approve attendance corrections for sections of a subject they do not teach (Subject.faculty membership used as authority)

- **Fingerprint:** `server/src/controllers/attendanceController.js:reviewCorrection:subject-level-faculty-authority`
- **Affected boundary / root cause (claimed):** listCorrections uses Subject.find({faculty: user._id}) and reviewCorrection uses isAssigned(subject, user) (attendanceController.js:63, subject.faculty includes user) as faculty authority. Both are subject-level, not section-level, and Subject.faculty is not automatically pruned. They do not apply the section-level teaching assignment (facultyAssignments/roleScope) that every other faculty attendance read uses, or the slot-ownership rule that faculty writes use.

Attendance reads by faculty are confined by staffScope/roleScope to their exact subject+department+section timetable assignments, and faculty writes by assertCanWrite to their own live timetable slot. The correction workflow instead authorizes faculty by membership in Subject.faculty, a subject-wide list that the model itself describes as holding several faculty 'for different sections' and that linkFacultyToSubject adds to on every slot assignment without automatic removal when a slot is reassigned or deleted (only a manual HOD/admin updateSubject overwrite changes it). A faculty member listed on a subject because they teach section A (or once did) can therefore list correction requests from section-B students of that subject (populated name, email, rollNo, avatar, section) and approve or reject them. Approving rewrites the section-B student's AttendanceRecord to the status the student requested, for any past date. The reviewer cannot choose the new status (it comes from the student's request), so the effect is approving or rejecting a student-initiated change outside the reviewer's section, plus disclosure of those students' identifying fields.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:1360` — `PATCH /attendance/corrections/:id`: Authenticated route behind protect. authorize(...STAFF) at line 1363 (STAFF = admin, faculty, hod; line 1018) and body('action').isIn(['approved','rejected']), then attendance.reviewCorrection. Any faculty account reaches the controller.
1. *propagation* `server/src/controllers/attendanceController.js:1731` — `reviewCorrection faculty branch`: The faculty branch loads Subject.faculty and checks only isAssigned(subject, req.user). It does not check the requesting student's section or department, or the date/period slot owner, against the reviewer's timetable assignments.
1. *propagation* `server/src/controllers/timetableController.js:808` — `linkFacultyToSubject`: Each timetable slot assignment $addToSet's the slot's faculty into Subject.faculty for the whole subject (all sections). No code automatically removes the entry when the slot is reassigned or deleted. The only way it changes is a manual faculty-array overwrite through updateSubject by HOD/admin.
1. *sink* `server/src/controllers/attendanceController.js:1756` — `reviewCorrection approve`: On action 'approved', AttendanceRecord.updateOne sets status to request.requestedStatus, plus correctedBy and a history entry, for the requesting student's record. Section is not checked.

**Evidence**

- `server/src/controllers/attendanceController.js:71`: Documented invariant: faculty scope is only actual teaching assignments (subject + department + section). A faculty member assigned Section A must never see Section B.
- `server/src/controllers/attendanceController.js:109`: roleScope for faculty uses timetable assignments as exact subject+department+section clauses. It falls back to Subject.faculty/subject.sections only for subjects with no timetable row ('the timetable is more precise'). The correction path skips this narrowing.
- `server/src/controllers/attendanceController.js:226`: assertCanWrite: faculty may write only through their own (or substitute) timetable slot, on the day, while ACTIVE. This is the intended write control, and it is much stricter than reviewCorrection.
- `server/src/controllers/attendanceController.js:1694`: listCorrections faculty filter is subject IN Subject.find({faculty: user._id}), covering every section. Results populate student name, email, rollNo, avatar and section (line 1711).
- `server/src/controllers/attendanceController.js:1676`: requestCorrection notifies every Subject.faculty member, so faculty teaching other sections are alerted to the request.
- `server/src/models/Subject.js:15`: Schema comment: Subject.faculty holds faculty teaching this subject, 'can have multiple for different sections'. So a section mismatch arises in normal operation, not only from stale entries.
- `server/src/controllers/timetableController.js:803`: linkFacultyToSubject's comment says it exists to gate attendance marking on Subject.faculty. Its only operation is $addToSet.

**Blockers**

- No OS-enforced sandbox is available on this Windows host (Docker daemon stopped, no Windows Sandbox), so the bounded local HTTP check could not be executed. No target code was run.
- Institutional intent is not confirmed: the source does not say whether any faculty listed on a subject may adjudicate correction requests for every section of that subject. The staffScope comments and the section-scoped reads point against it, but the owner must confirm.

**Resolution plan**

- *Local (sandboxed, dummy data):* In the sandbox, extend server/tests/academic.test.js next to the existing correction test (line 221). Create subject S with sections ['A','B']. Create timetable slots for facultyA on S section A and facultyB on S section B, which puts both in S.faculty. Create a section-B student with an AttendanceRecord for S marked 'absent'. As that student, POST /attendance/corrections with requestedStatus 'present'. As facultyA: GET /attendance/corrections and expect the section-B request with student email/rollNo; then PATCH /attendance/corrections/:id with {action:'approved'} and expect 200 and the record status 'present' with correctedBy=facultyA. Also check that facultyA gets 403 or an empty result from section-scoped reads (e.g. GET attendance records filtered to section B) to show the inconsistency. Regression test: after reviewCorrection/listCorrections are limited to the reviewer's facultyAssignments (subject+department+section of the student) or to the slot faculty/substitute for that date and period, expect 403 and no listing.
- *Owner-observed (no audit traffic):* The owner, using dummy accounts in a staging tenant: confirm whether any subject has more than one Subject.faculty member, or members with no current timetable slot for the section of pending correction requests (non-destructive query: AttendanceCorrectionRequest pending joined with student section versus TimetableSlot faculty for that subject+section). Confirm policy intent for who may adjudicate corrections.

## 13. Faculty without a Class In-Charge section can forward or reject any pending OD/leave request in their department

- **Fingerprint:** `server/src/controllers/odLeaveController.js:reviewScope:faculty-department-fallback`
- **Affected boundary / root cause (claimed):** reviewScope applies the gate-pass read-queue fallback (department-wide for a faculty member with no section, and all years for a sectioned faculty member without inChargeYear) to state-changing review actions as well. inReviewScope is the only authorization in reviewStage. It does not use facultyClassInChargeScope (academicScope.js:96-117, which returns [] for a faculty member with no section) or facultyClasses/inClasses, which gate pass review actions require through isClassFaculty.

The first stage of OD/leave review belongs to the student's Class In-Charge. reviewScope (odLeaveController.js:31-48) gives a faculty account with an empty User.section a department-wide scope covering every year and section. User.section is optional for faculty (User.js:44), so this applies to any faculty member who is not a class in-charge. A faculty member who has a section but no inChargeYear gets every year of that section letter. inReviewScope reuses the same scope as the only object-level check in reviewStage (line 434). As a result, such a faculty member can PATCH /attendance/od-leave/:id/review to forward any pending_faculty request in the department to the HOD (line 454), skipping the real Class In-Charge stage, or reject it (line 474). Rejection ends the request and tells the student that the Class In-Charge rejected it. The read side (GET /attendance/od-leave/reviews returns the requests with the student and the stored document) uses the same department-wide fallback that gate pass listing and canView use on purpose (gatePassController.js:346-350, 430-431), so the read exposure is a documented design choice. The real problem is on the write side. Gate pass review actions do not use that fallback; they require isClassFaculty, which is timetable or in-charge class membership (gatePassController.js:55-61, 715). The OD/leave actions do not. The HOD and principal stages still apply after a forward, so this does not grant final approval. The impact is a premature forward to the HOD, or a wrongful rejection by a staff member who is not the student's class in-charge.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:1408` — `PATCH /attendance/od-leave/:id/review`: Runs after protect and the global guards. idParam, authorize('faculty','hod','principal','admin'), writeLimiter, and body validation of action/reason, then odLeave.reviewStage. None of these checks the class in-charge relationship.
1. *propagation* `server/src/controllers/odLeaveController.js:31` — `reviewScope`: Faculty branch: returns {department} only when user.section is empty, and {department, section} with no year when inChargeYear is null.
1. *propagation* `server/src/controllers/odLeaveController.js:434` — `reviewStage`: inReviewScope(request, req.user) is the only object-level check. It passes for any request in the faculty member's department, since request.department/section/year are copied from the student at creation (lines 161-163).
1. *sink* `server/src/controllers/odLeaveController.js:474` — `reviewStage faculty reject`: request.status = 'rejected' with facultyReview.by set to the caller, the student notified that the Class In-Charge rejected it, and the change saved at line 561. On forward, line 454 sets status 'pending_hod' instead.

**Evidence**

- `server/src/controllers/odLeaveController.js:23`: The doc comment says the sectionless fallback mirrors the gate pass and that the scope is used for the queue AND every review action. This confirms the behavior is in the source and is applied to actions.
- `server/src/controllers/gatePassController.js:715`: The gate pass faculty review action requires isClassFaculty (facultyClasses + inClasses, lines 55-61). Gate pass limits the department-wide fallback to the read queue and canView (lines 346-350, 430-431), so OD/leave diverges from its stated precedent on writes.
- `server/src/utils/academicScope.js:100`: The canonical Class In-Charge resolver facultyClassInChargeScope returns [] when the faculty member has no department or section. It is imported in odLeaveController.js (line 14) but never used in reviewScope.
- `server/src/models/User.js:44`: User.section is optional (no required constraint), so faculty accounts that are not a class in-charge can legitimately have no section.
- `server/tests/od-leave-scope.test.js:60`: The scope tests cover only faculty with a section (and mostly an in-charge year). No test covers a faculty member with no section, or a sectioned faculty member without inChargeYear, acting on another class's request.

**Blockers**

- No OS-enforced sandbox is available on this Windows host (Docker daemon stopped, no Windows Sandbox), so the bounded local reproduction cannot be executed.
- Deployment data fact that is not visible in source: how many active faculty accounts have an empty section or a null inChargeYear, which sets how many staff hold department-wide or cross-year OD review authority.

**Resolution plan**

- *Local (sandboxed, dummy data):* In a sandboxed copy, add to server/tests/od-leave-scope.test.js a faculty user make('faculty', {department:'CSE'}) with no section, and a CSE year 3 section A semester 5 student. As the student, POST /attendance/od-leave with a valid future request. As the sectionless faculty member: GET /attendance/od-leave/reviews, expecting the request to be listed (read fallback, by design). Then PATCH /attendance/od-leave/:id/review with {action:'reject', reason:'test'} and expect 200 with status 'rejected' (the vulnerability). Repeat with a second request and {action:'forward'}, expecting status 'pending_hod'. Repeat with make('faculty', {department:'CSE', section:'A'}) and no inChargeYear, against a year 2 section A student. After the fix, which requires the review actions for role faculty to pass inClasses(await facultyClassInChargeScope(user), student) or isClassFaculty, expect 403 on all of these PATCH calls, while the existing in-charge tests still pass.
- *Owner-observed (no audit traffic):* Owner-run read-only query: db.users.countDocuments({role:'faculty', isActive:true, $or:[{section:{$in:[null,'']}}, {section:{$exists:false}}]}) and, separately, faculty with a section but inChargeYear null, grouped by department. Optionally, query ODLeaveRequest documents whose facultyReview.by user is not the class in-charge of the request's department/section/year to see whether out-of-class reviews have already happened.

## 14. HOD can read admin-uploaded alumni import batches across departments (and commit any uncommitted batch by ID)

- **Fingerprint:** `alumni-import-batch-hod-department-scope`
- **Affected boundary / root cause (claimed):** getImportBatch (server/src/controllers/alumni/alumniImportController.js:284) guards with `req.user.role === 'hod' && batch.department && batch.department !== req.user.department`, so batches with no department (admin uploads; previewImport sets `department: isHod ? hodDept : undefined` at line 158) pass for any HOD. commitImport (lines 168-260) loads the batch by ID (line 173), checks only that status is not 'done' (176), never compares batch.department or batch.uploadedBy with the caller, and returns raw-token claim URLs (211, 252-258). Route-level authorize('admin','hod') (alumniRoutes.js:433, 440) is the only other control.

Alumni import handlers confine an HOD to their department inconsistently. previewImport, listImports, listInvites, resendInvite and revokeInvite all scope an HOD to req.user.department, but getImportBatch skips the department check whenever batch.department is unset, which is the case for every admin-uploaded batch (department is stored only for HOD uploads). An HOD learns the ObjectId of an admin batch from GET /api/alumni/invites: each returned invite carries its batch ObjectId, and any admin batch that contains at least one committed row for the HOD's own department yields an invite visible to that HOD. GET /api/alumni/import/:id then returns the whole batch document, including every row (name, email, phone, company, designation, location, gradYear, and also invalid/duplicate rows) for alumni of all departments. This discloses contact data (phone/email) of other-department alumni that the alumni privacy model (levelAllows hodOk) and the HOD-scoped directory export withhold from that HOD. Secondarily, commitImport performs no department or uploader check: an HOD holding the ObjectId of any not-yet-committed batch (another HOD's or an admin's) can commit it and receive downloadLinksCsv with raw claim URLs for every valid row, enabling takeover-by-claim of the pending alumni invitations of other departments. No source path was found that discloses an uncommitted batch ID to a different-department HOD (batch IDs leak through invites only after commit, at which point commit returns 409), so the commit variant has low practical likelihood; the read variant is directly reachable.

**Source trace**

1. *entrypoint* `server/src/routes/alumniRoutes.js:441` — `GET /api/alumni/invites authorize('admin','hod')`: Authenticated HOD lists alumni invites; router mounted after protect at routes/index.js:2131.
1. *propagation* `server/src/controllers/alumni/alumniImportController.js:307` — `listInvites`: AlumniInvite.find(filter) with filter.department = HOD's department (line 299) returns lean invites including the batch ObjectId (AlumniInvite.batch, models/AlumniInvite.js:19); invites of the HOD's department created from an admin's mixed-department batch expose that batch ID.
1. *propagation* `server/src/routes/alumniRoutes.js:440` — `GET /api/alumni/import/:id`: Route requires only idParam and authorize('admin','hod').
1. *propagation* `server/src/controllers/alumni/alumniImportController.js:284` — `getImportBatch`: Department check short-circuits when batch.department is undefined (admin batch, see line 158).
1. *propagation* `server/src/controllers/alumni/alumniImportController.js:288` — `getImportBatch`: res.json(batch) returns all rows (name, email, phone, company, designation, location, gradYear) for every department in the admin batch.
1. *sink* `server/src/controllers/alumni/alumniImportController.js:252` — `commitImport`: With no department/uploader check after findById (line 173), an HOD holding an uncommitted batch ID commits it and receives raw claim URLs for every valid row in downloadLinksCsv (lines 252-258).

**Evidence**

- `server/src/controllers/alumni/alumniImportController.js:115`: Intended policy: previewImport rejects rows outside the HOD's department.
- `server/src/controllers/alumni/alumniImportController.js:158`: Batch department is stored only for HOD uploads; admin batches leave it undefined.
- `server/src/controllers/alumni/alumniImportController.js:266`: listImports scopes HOD to batch.department, so admin batches are hidden from HOD listings.
- `server/src/controllers/alumni/alumniImportController.js:299`: listInvites scopes HOD to invite.department but returns the batch ObjectId field.
- `server/src/controllers/alumni/alumniImportController.js:284`: `batch.department &&` short-circuit lets an HOD read admin batches.
- `server/src/controllers/alumni/alumniImportController.js:173`: commitImport loads by id and checks only status (176); no HOD department or uploader scope.
- `server/src/controllers/alumni/alumniImportController.js:331`: resendInvite/revokeInvite (331, 372) do enforce HOD department scope, confirming the intended confinement.
- `server/src/middleware/auth.js:77`: authorize() checks only role membership; no department scoping at route level.
- `server/src/utils/alumniPrivacy.js:22`: levelAllows: an HOD outside the alumnus's department is not entitled to staff/mentee-level contact fields.
- `server/src/controllers/alumni/alumniAnalyticsController.js:238`: Directory export restricts HODs to alumni of their own department, consistent with department confinement policy.

**Blockers**

- No OS-enforced sandbox available on this Windows host (Docker daemon stopped, no Windows Sandbox), so the bounded local reproduction with dummy admin/HOD accounts could not be executed.
- Commit variant requires an HOD to hold the ObjectId of an uncommitted cross-department batch; no source path discloses such an ID to a different-department HOD, so that variant's practical likelihood is unestablished.
- Real-world impact of the read variant depends on whether admins upload mixed-department batches containing rows for departments that have HOD accounts (deployment data state).

**Resolution plan**

- *Local (sandboxed, dummy data):* Using the server/tests alumni-flows.test.js pattern (startServer helper, in-memory/local Mongo, dummy users): (1) as admin POST /api/alumni/import/preview with a CSV containing one CSE row and one ECE row (dummy phone values), then POST /api/alumni/import/<id>/commit with {sendEmails:false}; (2) as dummy HOD-CSE GET /api/alumni/invites and read items[0].batch; (3) as HOD-CSE GET /api/alumni/import/<batch>; expected 403, vulnerable if 200 with the ECE row's email/phone. (4) Commit variant: admin previews a second mixed batch without committing; HOD-CSE POST /api/alumni/import/<id>/commit with {sendEmails:false}; expected 403, vulnerable if 200 with ECE claim URL in downloadLinksCsv. Stop at the first observed response; do not use the claim URL.
- *Owner-observed (no audit traffic):* Owner checks (read-only) whether any AlumniImportBatch documents lack a department field and contain rows spanning multiple departments, and whether HOD accounts exist for more than one of those departments.

## 15. Assigned grievance authority can reopen or mark RESOLVED a complaint the student cancelled or closed

- **Fingerprint:** `complaintController.authorityUpdate:missing-status-precondition`
- **Affected boundary / root cause (claimed):** authorityUpdate (complaintController.js:236-272) checks only the requested target status and whether the caller is admin or equal to complaint.currentAuthorityUserId. It never checks the stored complaint.status against an allowed source-state set. Its conditional update filter { _id, currentAuthorityUserId } (246-247) has no status predicate. Student-terminal states (CANCELLED, CLOSED) can therefore be overwritten. Sibling handlers do bind status: markNotResolved at 293 and 317, cancelComplaint at 372.

PATCH /api/complaints/:id/authority-update lets the currently assigned authority (faculty/hod/principal/dean/ao/warden) or any admin set status IN_REVIEW, IN_PROGRESS or RESOLVED whatever the complaint's current status is. cancelComplaint (student withdraws) and markResolved (student confirms and closes) set CANCELLED or CLOSED but leave currentAuthorityUserId unchanged. So the authority the student complained about or to can reopen a grievance the student withdrew, or relabel a CANCELLED or CLOSED grievance as RESOLVED with a new resolvedAt. The student is notified and the change is recorded in history. This falsifies the outcome the student chose and shifts the chairman/admin dashboard figures (resolved count, cancelled count, average resolution hours). The impact is limited to the integrity of grievance records: there is no data disclosure, the actor is already the authorised handler of that complaint, and the student can still cancel again from IN_REVIEW/IN_PROGRESS or escalate from RESOLVED. NOT_RESOLVED is not counted here because constants.js:275-276 lists it as an open status ('can still be cancelled or escalated from'). An authority or admin resolving it looks like intended behaviour. Chairman is also not an authority role, so a NOT_RESOLVED complaint at chairman level can only be changed by an admin, who already has broad authority.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:2108` — `PATCH /complaints/:id/authority-update`: idParam, authorize(...COMPLAINT_AUTHORITY_ROLES, 'admin') and body('status').isIn(['IN_REVIEW','IN_PROGRESS','RESOLVED']) at 2108-2116. Nothing validates the current state.
1. *propagation* `server/src/controllers/complaintController.js:242` — `authorityUpdate`: Only checks admin role or sameId(complaint.currentAuthorityUserId, req.user). complaint.status is loaded at 240 but never checked.
1. *propagation* `server/src/controllers/complaintController.js:371` — `cancelComplaint`: Student cancel sets status CANCELLED (373) and leaves currentAuthorityUserId pointing at the assigned authority. markResolved (350-354) does the same for CLOSED.
1. *sink* `server/src/controllers/complaintController.js:246` — `authorityUpdate findOneAndUpdate`: Filter { _id, currentAuthorityUserId } with $set { status, resolvedAt } (246-250) overwrites CANCELLED/CLOSED. A history entry and a student notification follow (253-268).

**Evidence**

- `server/src/controllers/complaintController.js:247`: The conditional update filter has no status predicate, unlike markNotResolved (293, 317) and cancelComplaint (372), which bind status.
- `server/src/constants.js:276`: COMPLAINT_OPEN_STATUSES (commented at 275 as the statuses a complaint can still be cancelled or escalated from) excludes CANCELLED and CLOSED and includes NOT_RESOLVED. COMPLAINT_CANCELLABLE_STATUSES (277) shows the codebase intends state-gated transitions.
- `server/src/controllers/complaintController.js:406`: complaintDashboard counts RESOLVED/CLOSED as resolved and CANCELLED separately (407), and averages resolvedAt - createdAt (412-416). A RESOLVED forged onto a cancelled complaint changes the reported outcomes.
- `server/tests/complaints.test.js:190`: The existing authority-update test covers only who may act, not which source states are allowed.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check (Docker daemon stopped on the Windows host), so the overwrite is not reproduced.
- Source does not document the institutional policy on whether an assigned authority or admin may reopen or resolve a student-cancelled or student-closed grievance. The invariant is inferred from COMPLAINT_OPEN_STATUSES, COMPLAINT_CANCELLABLE_STATUSES and the state-gated sibling handlers.

**Resolution plan**

- *Local (sandboxed, dummy data):* Inside a sandbox with a local mongo:7, add a test to server/tests/complaints.test.js. (1) The student creates {category:'academics', subCategory:'subject', escalateTo:'faculty', description:'Withdrawn grievance for state test.'}. (2) The student sends PATCH /complaints/:id/cancel and gets 200 with status CANCELLED. (3) The assigned faculty sends PATCH /complaints/:id/authority-update {status:'RESOLVED'}. Under the intended invariant this should return 422. Current source is expected to return 200 with status RESOLVED and resolvedAt set. (4) Repeat with a fresh complaint: the student sends PATCH /complaints/:id/resolved (CLOSED), then the faculty sends {status:'IN_REVIEW'}. Run with node --test. Stop once one overwritten record is observed.
- *Owner-observed (no audit traffic):* The owner confirms the grievance policy: whether CANCELLED and CLOSED are terminal for assigned authorities and admins, or whether reopening them is a sanctioned workflow.

## 16. Branch HOD attendance reports include their department's 1st-year students when year is omitted or semester 1/2 is requested

- **Fingerprint:** `attendanceReport:resolveReportScope:branch-hod-first-year-not-excluded`
- **Affected boundary / root cause (claimed):** In the branch-HOD branch of resolveReportScope (server/src/services/attendanceReport.js lines 132-151), the only check is a deny on the explicit value (qYear === 1 at line 134). The scope is never limited to years [2,3,4] and semesters outside [1,2] when year or semester is absent or first-year. As a result sessionFilter (line 179) and rosterOf (lines 193-195) apply no year restriction, unlike staffAttendanceController and attendanceMonitorController, which default an absent year to {$in:[2,3,4]}.

The codebase assigns every department's 1st year to the Science & Humanities HOD and limits a branch HOD to years 2-4 of their own department. This rule is enforced in the low-attendance monitor, staff attendance filters, roleScope, getReportOptions and the report service's own subject check, and it is stated in tests/first-year-hod.test.js. In the report service, resolveReportScope blocks a branch HOD only when year=1 is passed explicitly. If the HOD leaves out year, or passes semester=1 or semester=2 (the route accepts semester 1-12), the scope becomes {department: own, year: undefined, semester: as given}. sessionFilter and rosterOf then add no year restriction. 1st-year students carry the branch department (for example 'CSE' in the test fixtures), so the report returns their AttendanceSessions and their roster: names, roll numbers, and per-student present, absent, total and percentage. This affects GET /api/attendance/reports/:type (weekly/monthly/custom range, date and period reports, as JSON or PDF) and /api/attendance/reports/periods. The person who gains access is an authenticated staff HOD inside the same department, so the boundary crossed is an intra-institution role-scope rule, not access by an outsider.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:1219` — `GET /attendance/reports/:type`: authorize(...ATTENDANCE_VIEW_ROLES) includes hod. The year query parameter is optional (isIn ACADEMIC_YEARS) and semester is optional (isInt 1-12), so semester 1 or 2 is accepted. The route then calls attendance.getAttendanceReport, which goes through buildReport to resolveReportScope.
1. *propagation* `server/src/services/attendanceReport.js:134` — `resolveReportScope (branch HOD)`: Only qYear === 1 is refused. An undefined year, and a semester of 1 or 2, pass unchanged into the returned scope (year: qYear, semester: num(query.semester), lines 144-151). The 1st-year check at line 140 runs only when subjectId is supplied.
1. *propagation* `server/src/services/attendanceReport.js:179` — `sessionFilter`: A year filter is added only when scope.year !== undefined. The semester filter uses the requested semester, so semester=1 or 2 selects 1st-year sessions of the department.
1. *propagation* `server/src/services/attendanceReport.js:193` — `rosterOf`: With no year and no subject, the roster filter is the student role, isActive, department and optional section/semester, with no year restriction, so the department's 1st-year students are listed.
1. *sink* `server/src/services/attendanceReport.js:510` — `rangeReport students`: Per-student name, rollNo, year, section, present/absent/total periods and percentage are built for every roster entry, including 1st-year students, and returned as JSON or as a PDF by getAttendanceReport (attendanceController.js:1556-1565).

**Evidence**

- `server/src/controllers/attendanceMonitorController.js:191`: The low-attendance monitor limits a branch HOD to department plus year {$in:[2,3,4]} and returns an empty result for any other requested year. This is the intended policy.
- `server/src/controllers/staffAttendanceController.js:86`: For a branch HOD, year=1 matches no one (_id null) and an absent year becomes {$in:[2,3,4]}. Comment at line 85: '1st year belongs to the Science & Humanities HOD'.
- `server/src/controllers/attendanceController.js:106`: roleScope for a branch HOD excludes 1st-year subjects (subject $nin fySubjects).
- `server/src/controllers/attendanceController.js:1610`: getReportOptions offers a branch HOD only timetable years in [2,3,4] and subjects with semester not in [1,2]. This limit applies only in the UI and the report endpoint does not re-enforce it.
- `server/src/services/attendanceReport.js:140`: The same function refuses 1st-year subjects for a branch HOD, which shows the intended exclusion. That check applies only when subjectId is given.
- `server/tests/first-year-hod.test.js:17`: Test fixture: a 1st-year student ('Fresher', semester 1) has department 'CSE', the branch department. Line 5 states the policy: 'The Science & Humanities HOD owns every department's 1st year; branch HODs own years 2-4.' This supports the data-model premise that the year-less department filter matches 1st-year users.
- `server/src/models/AttendanceSession.js:26`: AttendanceSession has a required department plus a year field, and sessionFilter keys on these fields. With year absent, the department filter alone selects 1st-year sessions.

**Blockers**

- No OS-enforced sandbox is available on this Windows host (Docker daemon stopped, no Windows Sandbox), so the bounded local reproduction could not be run and target code was not executed.
- Deployment data fact (not decisive for the source flaw): the owner must confirm that production 1st-year User and AttendanceSession documents carry the branch department value (as the test fixtures and the S&H HOD's department query parameter imply) rather than 'Science & Humanities'.

**Resolution plan**

- *Local (sandboxed, dummy data):* In an isolated sandbox with a throwaway MongoDB, create a branch HOD (role hod, department 'CSE'), a CSE year-1 student (semester 1, section A, rollNo F1) and a CSE year-2 student (semester 3, section A, rollNo S3). Add one finished AttendanceSession for each year (department CSE, section A, past date) with an AttendanceRecord for each student. As the HOD, call GET /api/attendance/reports/weekly (no year) and GET /api/attendance/reports/weekly?semester=1. The finding holds if rollNo F1 appears in students[] with non-zero totalPeriods. As a control, GET ...?year=1 must return 403. Stop at the first observation of F1.
- *Owner-observed (no audit traffic):* Owner-observed and read-only: confirm that production 1st-year student User documents and 1st-year AttendanceSession documents use the branch department (for example 'CSE'), not 'Science & Humanities'. Optionally, a branch HOD test account can open the weekly report with Year set to All and the owner checks for absence of 1st-year roll numbers. Do not probe the deployed service from the audit.

## 17. An HOD can turn an achievement post into a campus-wide announcement they can rewrite and pin, which only the Principal is allowed to publish

- **Fingerprint:** `achievement:createFeedEntry:hod-authored-campus-wide-announcement`
- **Affected boundary / root cause (claimed):** achievementController.createFeedEntry (lines 79-88) writes the derived Announcement with audience {scope:'all'} and author = the posting user. It does not apply checkAudience and does not mark the record as a system or achievement-owned entry. The announcement module's author-based rights (canEdit line 25, togglePin line 169) and its audience re-check, which runs only when the audience changes (line 147), then give an HOD full control over an announcement with a Principal-only audience.

Only the Principal may publish campus-wide ('all') announcements: MAIN_ANNOUNCEMENT_ROLES = ['principal'], enforced in announcementController.checkAudience, which otherwise returns 403 'Only the Principal can publish the main campus announcement'. ACHIEVEMENT_POST_ROLES = ['principal','hod'], so an HOD can call POST /api/achievements after tagging one or more active students from their own department. createAchievement then calls createFeedEntry, which runs Announcement.create with audience {scope:'all'} and author = a.postedBy (the HOD). This never goes through checkAudience. The new announcement appears in the HOD's GET /api/announcements list with canEdit true. canEdit allows the author, and updateAnnouncement re-checks the audience only when req.body.audience differs from the stored one. So the HOD can send PUT /api/announcements/:id to replace the title (3-160 chars), content (5-5000), priority (including 'urgent'), image and attachments (both limited to /uploads/ or https URLs by safeUrl and announcementRules). The HOD can also send PATCH /api/announcements/:id/pin (the route allows hod; togglePin allows the author) to pin it at the top of every user's feed. announcementVisibility returns any audience.scope 'all' announcement to every authenticated user. The result is an arbitrary, pinned announcement under the HOD's name that reaches the whole college, which the announcement module would otherwise refuse. Limits: the attacker is an already-trusted staff role (HOD). They must post an achievement that tags at least one real student from their own department. Editing an announcement sends no mass notification, so users see the content in the feed and not as a push. The achievement description being published campus-wide by itself may be the intended feed behavior; the boundary violation is the free, unchecked edit and pin rights that follow.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:575` — `POST /achievements`: Behind protect and the global guards. authorize(...ACHIEVEMENT_POST_ROLES) = principal and hod, then achievementRules and createAchievement.
1. *propagation* `server/src/controllers/achievementController.js:190` — `createAchievement`: After loadStudents and assertScope (an HOD may tag only active students of their own department), calls createFeedEntry and stores the announcement id on the achievement (line 194).
1. *propagation* `server/src/controllers/achievementController.js:80` — `createFeedEntry`: Announcement.create({title:'Achievement: ...', content: a.description, author: a.postedBy, audience:{scope:'all'}, priority:'normal'}) without calling checkAudience.
1. *propagation* `server/src/routes/index.js:524` — `PUT /announcements/:id`: No role authorize. idParam plus announcementRules(true), which only validate field shapes.
1. *propagation* `server/src/controllers/announcementController.js:141` — `updateAnnouncement`: canEdit (line 25-26) passes because ann.author is the HOD. Title, content, priority, attachments, deadline and image are assigned. checkAudience runs only if req.body.audience is present and differs (line 147).
1. *sink* `server/src/controllers/announcementController.js:150` — `updateAnnouncement save`: HOD-written content is saved on an announcement with audience 'all', which announcementVisibility (utils/visibility.js:25) returns to every user. togglePin (line 165-174, route index.js:526 allows hod) lets the author pin it campus-wide.

**Evidence**

- `server/src/constants.js:170`: MAIN_ANNOUNCEMENT_ROLES = ['principal'] is the intended policy for campus-wide announcements.
- `server/src/constants.js:326`: ACHIEVEMENT_POST_ROLES = ['principal', 'hod'], so an HOD can trigger createFeedEntry.
- `server/src/controllers/announcementController.js:54`: In checkAudience, scope 'all' requires MAIN_ANNOUNCEMENT_ROLES and otherwise returns 403.
- `server/src/controllers/achievementController.js:84`: The feed entry hard-codes audience {scope:'all'}, with author a.postedBy at line 83.
- `server/src/controllers/announcementController.js:25`: canEdit returns true for admin or the author, with no audience or role re-check.
- `server/src/controllers/announcementController.js:145`: The comment and the code at line 147 re-check the audience only when it changes, so an 'all' audience authored by an HOD is never re-validated on text edits.
- `server/src/controllers/announcementController.js:169`: togglePin lets an author who is not admin or principal pin their own announcement. The route at routes/index.js:526 authorizes hod.
- `server/src/utils/visibility.js:25`: announcementVisibility includes {'audience.scope':'all'} for every user.

**Blockers**

- No OS-enforced sandbox is available on this Windows host (Docker daemon stopped, no Windows Sandbox), so the bounded local HTTP reproduction could not be run and target code was not executed.
- Product intent is undocumented: nothing says whether an HOD who edits or pins their own achievement feed entry is an accepted exception to the Principal-only campus-wide announcement policy. The only related note is the comment at announcementController.js:145 about legacy audiences.

**Resolution plan**

- *Local (sandboxed, dummy data):* In an isolated test DB using the server's existing test harness, create a HOD with department 'CSE', one active CSE student, and one active student in another department. As the HOD, POST /api/achievements with that student, a valid achievedOn and the required fields, then read achievement.announcement from the DB. As the same HOD, PUT /api/announcements/<id> with {title:'Test notice', content:'Arbitrary HOD text', priority:'urgent'}, then PATCH /api/announcements/<id>/pin. Vulnerable result: both return 200, and GET /api/announcements as the other-department student lists the edited, pinned item first. Control: POST /api/announcements as the same HOD with audience {scope:'all'} returns 403. Stop after observing this; do not create further announcements.
- *Owner-observed (no audit traffic):* Read-only, by the owner: query the production Announcement collection for documents with audience.scope='all' whose author has role 'hod'. Flag those whose title does not start with 'Achievement:', or whose updatedAt is later than createdAt, or whose isPinned is true. Confirm with product owners whether HODs may edit or pin achievement feed entries.

## 18. Approved achievement privacy-removal request (and resulting auto soft-delete) leaves the student's name in the campus-wide announcement

- **Fingerprint:** `achievement:resolveHideRequest:feed-entry-not-revoked`
- **Affected boundary / root cause (claimed):** The Achievement -> Announcement derived copy is revoked only in deleteAchievement (achievementController.js:254). resolveHideRequest (achievementController.js:315-337, approve branch 324-335) and updateAchievement (achievementController.js:224-231) change students/isDeleted without updating or deleting Achievement.announcement, whose title was built from nameList(students) at creation (line 81).

createAchievement always creates a derived Announcement (audience scope 'all', author = poster) titled 'Achievement: <comma-joined names of every tagged student> - <title>' and stores its id in Achievement.announcement. deleteAchievement deletes that Announcement, so withdrawing an achievement is meant to withdraw the feed copy too. The student-facing UI labels the hide request 'Request Privacy Removal' / 'have your name removed from this achievement post'. When the poster or Principal approves the request, resolveHideRequest only pulls the student from Achievement.students and, if none remain, soft-deletes the Achievement; it never edits or deletes the linked Announcement. The removed student therefore stays named in an announcement returned to every authenticated user by announcementVisibility, and a fully auto-deleted achievement remains published in the feed. updateAchievement has the same gap when the poster replaces the student list. There is no attacker-controlled step: the impact is a failed revocation of the student's name from a campus-wide copy after the authorized decision to remove it. The poster can still delete the announcement manually through the announcements module, which is the only mitigation.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:583` — `POST /api/achievements/:id/hide-request (authorize STUDENT_ROLES)`: Tagged student asks to have their name removed from the achievement post (requestHide, achievementController.js:296-313).
1. *propagation* `server/src/routes/index.js:592` — `PATCH /api/achievements/:id/hide-request/:reqId (authorize ACHIEVEMENT_POST_ROLES)`: Poster/Principal approves the request with {action:'approve'}; canManage enforced in the controller.
1. *propagation* `server/src/controllers/achievementController.js:81` — `createFeedEntry`: At creation the Announcement title embeds every tagged student's name; audience scope 'all'.
1. *propagation* `server/src/controllers/achievementController.js:325` — `resolveHideRequest approve branch`: Student is filtered out of a.students; if none remain, a.isDeleted = true (lines 326-330).
1. *sink* `server/src/controllers/achievementController.js:337` — `resolveHideRequest save`: Only the Achievement is saved; a.announcement is never updated or deleted, so the announcement naming the student stays visible campus-wide.

**Evidence**

- `server/src/controllers/achievementController.js:254`: deleteAchievement deletes the linked Announcement: the intended revocation of the derived copy, absent from resolveHideRequest and updateAchievement.
- `server/src/controllers/achievementController.js:190`: createAchievement creates the feed entry and stores its id in Achievement.announcement (line 194).
- `client/src/pages/achievements/AchievementDetail.jsx:387`: Modal titled 'Request Privacy Removal' promises 'to have your name removed from this achievement post', establishing the user-facing removal contract.
- `server/src/utils/visibility.js:25`: announcementVisibility returns audience.scope 'all' announcements to every user (read-all roles see everything).
- `server/src/models/Achievement.js:29`: announcement ref field; no model hook propagates student/isDeleted changes to the Announcement.

**Blockers**

- No OS-enforced sandbox available to execute a bounded local check (Docker daemon stopped, no Windows Sandbox); no target code was run.
- Product owners have not stated whether an approved privacy-removal request must also withdraw the student's name from the already-published campus feed announcement (the UI wording implies it should; the server contract only covers the Achievement record).

**Resolution plan**

- *Local (sandboxed, dummy data):* In a sandboxed test DB: as Principal create an achievement tagging dummy students S1 only; record Achievement.announcement. As S1 POST /api/achievements/<id>/hide-request; as Principal PATCH /api/achievements/<id>/hide-request/<reqId> {"action":"approve"}. Then as an unrelated dummy faculty GET /api/announcements. Vulnerable if the 'Achievement: S1 - ...' announcement is still returned while the Achievement has isDeleted=true. Repeat with two tagged students to confirm the removed student's name persists in the title. Stop at observing the record.
- *Owner-observed (no audit traffic):* Owner check only, non-destructive: confirm with product owners whether approved hide requests are a privacy withdrawal guarantee covering the announcement feed, and query production read-only for Achievements with approved hideRequests whose announcement document still exists.

## 19. Legacy Expo push tokens keep receiving notification content after the registering session is revoked

- **Fingerprint:** `expo-push-tokens-not-session-bound`
- **Affected boundary / root cause (claimed):** registerPushToken binds the Expo token only to the user and records no session id. Neither revokeSessions nor sendPushToUsers ties Expo delivery to a live Session, unlike DeviceToken/deliverPush/pushNow.

Legacy Expo app push tokens are stored on User.pushTokens with no link to the session that registered them. revokeSessions() is the shared revocation path for single-session revoke, sign out other devices, password change, admin/super-admin password reset or revoke, refresh-token reuse detection and token-version mismatch. It deletes only session-bound FCM DeviceToken rows and never touches User.pushTokens. deliverPush() sends every stored notification's title, message, type and link through sendPushToUsers(). That function selects every Expo token of an active user, with no check that any session is live, and POSTs them to Expo. A lost or stolen phone whose session was revoked remotely, or an attacker device that registered an Expo token before its stolen refresh token triggered reuse detection, keeps receiving the victim's notification titles and bodies (up to 120/240 characters) and links. Delivery stops only when the user is deactivated (isActive filter), Expo reports the token unregistered, a different user registers the same token, or the device itself, while still signed in, logs out with pushToken or calls DELETE /auth/push-token. The FCM path filters on live sessions for exactly this reason. Exposure is limited to notification text. The revoked device gets no API access back.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:354` — `POST /auth/push-token`: An authenticated device, mounted after protect, registers an Expo token (format validated only).
1. *propagation* `server/src/controllers/authController.js:582` — `registerPushToken`: Token stored as {token, addedAt} on User.pushTokens; the session id (req.sessionId) is not recorded.
1. *propagation* `server/src/controllers/authController.js:138` — `revokeSessions`: Only DeviceToken rows whose session is in the revoked ids are deleted; User.pushTokens is left untouched.
1. *propagation* `server/src/services/pushService.js:28` — `deliverPush`: Every stored notification is also sent through sendPushToUsers with its title, message, type and link.
1. *sink* `server/src/services/pushService.js:112` — `sendPushToUsers`: Messages carrying the title and body are built for every Expo token of each active user, with no session check, then POSTed to exp.host (line 124).

**Evidence**

- `server/src/services/pushService.js:32`: FCM path restricts delivery to devices whose session is unrevoked and unexpired (lines 30-37); the Expo path has no equivalent.
- `server/src/controllers/authController.js:459`: Expo token removal happens only on voluntary logout from the device that supplies pushToken (mobile/src/app/(app)/(tabs)/profile.js:63-67), or through the authenticated DELETE /auth/push-token (routes/index.js:359).
- `server/src/controllers/authController.js:550`: revokeOtherSessions relies on revokeSessions and leaves those devices' Expo tokens in place; the same applies to password_change (502), refresh_token_reuse (405) and the admin password reset (accountController.js:283).
- `server/src/services/pushService.js:109`: The only filters are isActive and the existence of a token; there is no Session lookup.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check (Docker daemon stopped on the Windows host), so no target code was run.
- Real-world exposure depends on whether the legacy Expo app (mobile/) is still distributed and has registered tokens in production.

**Resolution plan**

- *Local (sandboxed, dummy data):* In server/tests against the mongo:7 test DB with global fetch stubbed: sign in dummy student S as a mobile client (session A) and POST /api/auth/push-token {token:'ExponentPushToken[dummy]'} with session A's access token. Sign in S again (session B) and POST /api/auth/sessions/revoke-others with session B. Assert that session A has revokedAt set. Call deliverPush (or notifyUsers) for S with a test notification and assert that the stubbed fetch to https://exp.host/--/api/v2/push/send received a message with to:'ExponentPushToken[dummy]' and the notification title. Repeat with password change (session B) and with refresh-token reuse on session A.
- *Owner-observed (no audit traffic):* Owner-side read-only check: count active users with a non-empty pushTokens array and confirm whether the Expo app is still installed or distributed. Do not send any test pushes to real users.

## 20. Any signed-in user can grow the production MongoDB without limit through POST /api/uploads, because unattached StoredFile blobs are never deleted

- **Fingerprint:** `server/src/utils/storage.js:persistFile:unbounded-orphan-storedfile-growth`
- **Affected boundary / root cause (claimed):** persistFile (server/src/utils/storage.js:69-111) writes every validated upload into StoredFile when env.isProd is true and Cloudinary is not enabled (lines 102-105). It sets no owner and applies no per-user quota and no lifecycle. The StoredFile schema (server/src/models/StoredFile.js:10-17) has only filename, mimeType, data and timestamps: no owner, no TTL index and no reference tracking. No code path deletes StoredFile documents. The route (server/src/routes/index.js:375) is limited only by the IP-keyed uploadLimiter (server/src/middleware/rateLimit.js:69-75), which bounds the request rate but not the cumulative stored bytes.

When the server runs in production without Cloudinary, POST /api/uploads saves every accepted file as a StoredFile document in the shared application MongoDB. The document holds the full file bytes, up to MAX_UPLOAD_MB (5 MB by default). The upload is not linked to an owner or to any record. There is no per-user storage quota and no rule that the file must later be attached to anything. No code in server/src ever deletes StoredFile documents: the only references are create (storage.js:104) and findOne (storage.js:117). There is no orphan sweep, and the scheduled jobs in server.js sweep only Skill Wallet assets. The only per-route bound is uploadLimiter, which is keyed by IP and allows 30 requests per 10 minutes. That is about 150 MB per 10 minutes, or about 21.6 GB per day, per client IP, and the global apiLimiter (1000 requests per 15 minutes per IP) is looser. The limiter is not keyed per account, so a user with several source IPs multiplies the rate. Any authenticated role reaches the route, including student: it sits after protect, and confinedRoleGuard confines only COE, office and super_admin. The bytes persist in the same database as users, sessions, attendance and gate passes. If they exhaust the deployment's storage quota, writes could degrade or stop for the whole platform. Recovery is manual: StoredFile has no owner field, so an operator would have to cross-reference the activity log (logActivity 'file.upload') or scan every referencing collection to find the orphans. Two deployment facts decide whether this is exploitable: whether Cloudinary is configured, and the storage limit of the MongoDB plan. render.yaml declares CLOUDINARY_* as optional with sync:false, so source cannot show whether they are set. If Cloudinary is enabled, the bytes go to Cloudinary instead, and the impact becomes provider quota and spend rather than the shared database.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:375` — `router.post('/uploads', uploadLimiter, upload.single('file'), uploadFile)`: Authenticated route. It is mounted after router.use(protect) at line 313 and after platformGate, passwordChangeGate, staffGrantGuard, confinedRoleGuard and adminPolicyGuard (lines 315-324), none of which blocks student or other ordinary roles. The only route-specific bound is uploadLimiter.
1. *propagation* `server/src/utils/storage.js:38` — `upload (multer memoryStorage)`: Memory storage with limits fileSize = env.maxUploadMb * 1 MB (default 5, env.js:58), files: 1 and fields: 5. These are per-request caps, with no cumulative or per-user cap.
1. *propagation* `server/src/controllers/uploadController.js:8` — `uploadFile`: Calls persistFile(req.file, kind) with no owner, quota or attachment context. kind=document also accepts PDF, DOC, DOCX and plain text up to 2 MB.
1. *propagation* `server/src/utils/storage.js:72` — `persistFile`: The only gate is magic-byte type detection against an allowlist (lines 72-82). Any well-formed PNG, JPEG, WebP, GIF, PDF or DOCX of up to 5 MB passes.
1. *sink* `server/src/utils/storage.js:104` — `persistFile (env.isProd branch, Cloudinary disabled)`: StoredFile.create({ filename, mimeType, data: file.buffer }) writes the full bytes into the shared application MongoDB. No code in server/src deletes StoredFile documents.

**Evidence**

- `server/src/utils/storage.js:103`: The comment at line 102 and the branch at lines 103-105 show that, in production without Cloudinary, the uploaded bytes are stored in the database. The Cloudinary branch at lines 88-98 takes precedence when it is configured.
- `server/src/models/StoredFile.js:10`: The schema has only filename, mimeType, data and timestamps. It has no owner, no TTL index and no reference to the record that uses the file.
- `server/src/middleware/rateLimit.js:69`: uploadLimiter: windowMs 10 minutes, limit 30, default IP key (no per-user keyGenerator). Compare the Skill Wallet upload limiter at line 178, which is keyed per user.
- `server/src/config/env.js:58`: maxUploadMb defaults to 5 MB per file.
- `server/src/services/skillWallet/assets.js:127`: For comparison, the Skill Wallet store has sweepOrphanAssets, scheduled in server.js:75. The generic /uploads store has no equivalent. The only StoredFile operations in server/src are create (storage.js:104) and findOne (storage.js:117).
- `render.yaml:74`: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are optional with sync:false, so source cannot show whether the production deployment stores uploads in MongoDB or in Cloudinary.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check (the Docker daemon is stopped on this Windows host), so no target code was executed.
- Two deployment facts are decisive and not visible in source: whether CLOUDINARY_* are set on the Render service (if they are, the bytes go to Cloudinary and the impact becomes provider quota and spend), and the storage limit of the production MongoDB plan or cluster, together with any alerting or auto-scaling on it.

**Resolution plan**

- *Local (sandboxed, dummy data):* In a sandboxed run of the existing server test harness (the test MongoDB used by server/tests) with NODE_ENV=production and no CLOUDINARY_* variables, sign in as a dummy student. POST /api/uploads?kind=document three times with a small (for example 10 KB) valid plain-text fixture that is never attached to any record. Assert that StoredFile.countDocuments() increases by exactly 3 and that no quota error is returned. Then invoke each scheduled job registered in server.js once and assert that the three documents remain. Stop there; do not attempt volume or saturation testing.
- *Owner-observed (no audit traffic):* Owner checks, read-only: (1) on the Render dashboard, whether CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are set; (2) the MongoDB plan's storage limit and the current size of the storedfiles collection (db.storedfiles.stats()); (3) how many StoredFile filenames are not referenced as /uploads/<filename> in any collection, to gauge existing orphan growth. If Cloudinary is enabled, also check the Cloudinary plan's storage quota and billing.

## 21. Anonymous 429 responses on arbitrary /api paths create a new SOC ErrorEvent row per distinct path and use up the shared per-minute capture budget, so real server faults are dropped

- **Fingerprint:** `soc-capture-global-budget-and-rows-from-anonymous-429-paths`
- **Affected boundary / root cause (claimed):** SOC capture accounting is keyed on attacker-controlled path text. The fingerprint includes routeTemplate(req.originalUrl), and routeTemplate keeps arbitrary non-numeric segments (capture.js:147, sanitize.js:88). Capture also runs on the 429 response itself, from a middleware mounted before apiLimiter (app.js:165, error.js:74-77), so the per-IP limiter does not bound capture writes. The single process-wide GLOBAL_PER_MIN budget (capture.js:176-179) does not separate untrusted, anonymous-triggerable sources (rate_limit, authorization) from trusted server-fault sources (express, database, process, job). The route of rate-limited or unmatched requests is not collapsed to a constant or a matched route template.

captureRateLimited (server/src/middleware/error.js:74-79) is mounted on /api before apiLimiter (server/src/app.js:165-167). It records every 429 response with route=req.originalUrl, and no authentication is needed. captureError (server/src/services/soc/capture.js:123) turns the path into a template with routeTemplate (server/src/services/soc/sanitize.js:87-89), which only rewrites the query string, 24-hex ObjectIds, UUIDs and all-digit segments, and truncates to 160 chars. Any other text, such as /api/aXbY, stays distinct. The route is part of the fingerprint (capture.js:147). An anonymous client that has used up its 1000-requests-per-15-min apiLimiter quota (rateLimit.js:6-15) gets a cheap 429 for every later request. If each request uses a fresh path, each one gets a new fingerprint. The 5 s per-fingerprint coalescing (capture.js:151-171) never applies, and each request uses one slot of the single process-wide GLOBAL_PER_MIN=300 counter (capture.js:24, 172-180). That one counter also governs 'express' 5xx, 'database', 'job', 'socket', 'process' (critical) and client captures. About 5 requests per second from one client keeps the budget full. Every genuine capture after that is counted in stats.dropped and is never stored, which blinds the Super Admin SOC error view. Each accepted junk capture upserts a new ErrorEvent document (capture.js:229). These documents are kept for 90 days by the lastSeenAt TTL index (ErrorEvent.js:31, 82) and carry 7 secondary indexes (ErrorEvent.js:76-82) plus the unique fingerprint index. The ceiling is about 432,000 rows per day per Node process. There is a second, smaller anonymous variant: errorHandler also captures 403 responses with the raw route (error.js:38-39), for example ORIGIN_BLOCKED from csrfAndOriginGuard (security.js:104), but those requests count against apiLimiter. Impact is limited to SOC availability and integrity and to database storage. No data is disclosed. The dropped-capture counter is shown on the health page, so the effect can be detected.

**Source trace**

1. *entrypoint* `server/src/app.js:165` — `app.use('/api', correlationId, requestMetrics, captureRateLimited)`: Mounted for every /api request before apiLimiter (line 167), without authentication. It sees every 429 for any /api path, whether or not the path matches a route.
1. *propagation* `server/src/middleware/rateLimit.js:6` — `apiLimiter`: 1000 requests per 15 min per client IP (trust proxy is set at app.js:76). After that, every /api request (except /transport/tracker/) gets a cheap 429.
1. *propagation* `server/src/middleware/error.js:76` — `captureRateLimited res.on('finish')`: When statusCode is 429, it calls captureError({source:'rate_limit', req, httpStatus:429, route: req.originalUrl}).
1. *propagation* `server/src/services/soc/capture.js:147` — `captureError fingerprintOf`: The fingerprint includes the route from routeTemplate (line 130). Arbitrary alphabetic path segments stay distinct, so every new path is a new fingerprint and skips the per-fingerprint coalescing window (lines 151-171).
1. *propagation* `server/src/services/soc/capture.js:176` — `captureError GLOBAL_PER_MIN gate`: One process-wide counter of 300 writes per minute covers all sources. Once it is used up, any later non-coalesced capture, including source 'process' (critical) or 'database', increments stats.dropped and returns null without storing anything.
1. *sink* `server/src/services/soc/capture.js:229` — `ErrorEvent.findOneAndUpdate upsert`: Each new fingerprint inserts a new ErrorEvent document, kept for 90 days by the TTL index (ErrorEvent.js:82).

**Evidence**

- `server/src/services/soc/capture.js:24`: GLOBAL_PER_MIN = 300 and MAX_TRACKED = 2000 (line 25). The in-memory window map is FIFO-bounded (line 184), but database rows are not bounded beyond the per-minute rate.
- `server/src/services/soc/sanitize.js:88`: routeTemplate only strips the query string and rewrites ObjectIds, UUIDs and all-digit segments, then applies redactLine with a 160-char cap. Distinct alphabetic paths stay distinct.
- `server/src/models/ErrorEvent.js:31`: RETAIN_DAYS = 90. Secondary indexes are at lines 76-82, the TTL is on lastSeenAt (line 82), and fingerprint is unique (line 35).
- `server/src/middleware/error.js:38`: 403 responses are also captured with the raw route (source 'authorization'), for example ORIGIN_BLOCKED from csrfAndOriginGuard (middleware/security.js:104). This is a second anonymous variant, but it counts against apiLimiter.
- `server/src/app.js:167`: apiLimiter runs after captureRateLimited, so the limiter's own 429s are what drive capture writes.

**Blockers**

- No OS-enforced sandbox is available on this Windows host (Docker daemon stopped), so the bounded local unit check of dropped captures and distinct-row creation could not be run.
- Whether this matters for persistence depends on the deployed MongoDB storage quota and on any Render edge or proxy request-rate limits, neither of which is in the repository.
- The deployed Node instance count is not visible in source, and each process has its own GLOBAL_PER_MIN budget and its own row ceiling.

**Resolution plan**

- *Local (sandboxed, dummy data):* In a sandboxed Jest test against a local test MongoDB, call resetCaptureForTests(). Then, within one minute, call captureError({source:'rate_limit', httpStatus:429, message:'Rate limit exceeded', route:'/api/zz' + String.fromCharCode(97 + (i % 26)) + 'q' + i.toString(36).replace(/[0-9]/g, 'x')}) for 301 distinct alphabetic routes. Next call captureError({source:'process', err:new Error('boom'), route:'process:uncaughtException'}). Assert that captureStats().dropped >= 2, that no ErrorEvent has source 'process', and that, after the writes settle, ErrorEvent.countDocuments({source:'rate_limit'}) === 300. For an end-to-end check, use supertest with a test-only apiLimiter limit of 1, then request /api/a, /api/b, ... past the limit and count the distinct rate_limit rows. Use small counts and no external network.
- *Owner-observed (no audit traffic):* Owner check, read-only: in the production ErrorEvent collection, count source:'rate_limit' documents and their distinct routes. Check the SOC health page for the 'dropped' counter. Confirm the Atlas cluster storage quota, the Render instance count, and whether any edge rate limiting applies to /api.

## 22. Announcement authors who lose posting authority can still rewrite, delete and (if staff) pin announcements they posted to audiences they can no longer reach

- **Fingerprint:** `announcementController:updateAnnouncement:stale-author-audience-authority`
- **Affected boundary / root cause (claimed):** Authority to post to an announcement's audience is checked only at creation (createAnnouncement -> checkAudience, announcementController.js:118) and on edits that change the audience (:147-149). updateAnnouncement/deleteAnnouncement (canEdit, :25-27, :141, :159) and togglePin (:169) authorize later changes by stored authorship alone. They do not re-check that the author can still post to ann.audience under their current role, department or club-admin status.

updateAnnouncement only re-runs checkAudience when the request sends an audience that differs from the stored one. canEdit lets the original author edit or delete the announcement for as long as the author record exists. Three cases follow: a principal changed to another role (e.g. faculty), an HOD who is demoted or moved to another department, and a club admin removed from club.admins (by removeMember, setMemberRole demotion, or leaving the club). If the account is still active, that user can still change the title, content, priority (including 'urgent'), image, attachments and deadline of a campus-wide ('all'), department/year/section or club announcement they posted earlier. They do this by leaving out audience or resending the same one. They can also delete it. togglePin also allows pinning by authorship alone, but the route's authorize('admin','principal','faculty','hod') limits pinning to authors whose current role is one of those staff roles, so a removed student/club_admin club admin cannot pin. An update does not send new notifications. The impact is that the changed text appears in place to the original audience under the original authoritative post. Setting isActive=false (auth.js:40) fully revokes this ability. Only role, department or club-admin changes leave it in place.

**Source trace**

1. *entrypoint* `server/src/routes/index.js:524` — `router.put('/announcements/:id')`: Authenticated route behind protect. announcementRules(true) makes title, content and audience optional, so a body with only title/content/priority passes validation for any role.
1. *propagation* `server/src/controllers/announcementController.js:141` — `updateAnnouncement`: canEdit(req.user, ann) (:25-27) passes for the stored author through sameId, whatever their current role, department or club-admin membership.
1. *propagation* `server/src/controllers/announcementController.js:147` — `updateAnnouncement`: checkAudience is skipped when req.body.audience is missing or has the same audienceKey as the stored audience. The comment at :145-146 says this is deliberate.
1. *sink* `server/src/controllers/announcementController.js:150` — `updateAnnouncement`: ann.save() stores the caller-supplied EDITABLE fields (title/content/priority/attachments/deadline/image) on an announcement whose audience is unchanged (e.g. scope 'all').

**Evidence**

- `server/src/controllers/announcementController.js:26`: canEdit returns user.role === 'admin' || sameId(ann.author, user), which checks authorship only.
- `server/src/controllers/announcementController.js:54`: checkAudience requires MAIN_ANNOUNCEMENT_ROLES for scope 'all' (:54-58), CLASS_ANNOUNCEMENT_ROLES plus assertHodScope for department/year/section (:60-84), and canManageClub or moderator for club (:46-52). This is the intended posting policy, but it runs only at create (:118) or when the audience changes (:148).
- `server/src/controllers/announcementController.js:145`: The comment says the audience is rechecked only when it changes, so authors can fix announcements that predate the current posting rules. The code does not tell that case apart from the author losing authority.
- `server/src/controllers/announcementController.js:159`: deleteAnnouncement uses the same canEdit authorship check, so an author without authority can also remove the broadcast.
- `server/src/controllers/announcementController.js:169`: togglePin lets non-admin/principal callers pin their own visible announcement by authorship. The route at index.js:526 limits callers to admin/principal/faculty/hod, so a demoted principal or HOD now 'faculty' can pin, but a removed student club admin cannot.
- `server/src/controllers/adminController.js:440`: Admin role change sets user.role (department changes at :398-405) and does nothing about announcements written under the earlier role.
- `server/src/controllers/clubController.js:252`: removeMember removes the user from club.admins (setMemberRole demotion at :271 and leaveClub at :208 do the same) and does nothing about their club announcements.
- `server/src/constants.js:170`: MAIN_ANNOUNCEMENT_ROLES = ['principal']; CLASS_ANNOUNCEMENT_ROLES = ['principal','hod'] (:172).
- `server/src/middleware/auth.js:40`: protect rejects inactive accounts, so deactivation fully revokes the stale edit right. Only role, department or club-admin changes leave it in place.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check (Docker daemon is stopped on the Windows host), so no target code was run.
- Institutional policy is not stated in source: should a former principal, HOD or club admin keep edit/delete/pin rights over announcements they posted earlier, after a role downgrade, department move or removal as club admin? The code comment covers only posting-rule changes. Severity depends on this policy (likely low: the actor was once a legitimate author, edits are logged, and no new notifications are sent).

**Resolution plan**

- *Local (sandboxed, dummy data):* In a sandboxed test DB, extend server/tests/announcement-tampering.test.js with dummy users. (1) A principal POSTs /announcements with audience {scope:'all'}. An admin PATCHes the user to role 'faculty' through the admin user-update endpoint, or the test sets the role directly. Log in again as that user. PUT /announcements/:id with {title:'Changed by demoted user', content:'xxxxx', priority:'urgent'} and no audience: expect 200 today (finding) and 403 after the fix. Then PATCH /announcements/:id/pin as the same user: expect 200 today. (2) An HOD posts a department-scope announcement, admin changes the HOD's department or role, and the same PUT returns 200. (3) A club admin posts a club-scope announcement and another club admin removes them through removeMember. The PUT returns 200, but PATCH /pin returns 403 (route authorize) if the user is a student/club_admin. Stop at the status code and the stored title.
- *Owner-observed (no audit traffic):* Owner check: confirm with the college whether announcements written by a principal, HOD or club admin should become read-only, or admin-only, for that person once their role, department or club-admin status changes. Review read-only Activity log 'announcement.update' entries where the actor's current role is not allowed to post to the announcement's audience scope.

## 23. Alumni or faculty organizer can rewrite an approved event without re-approval

- **Fingerprint:** `alumni-event-post-approval-edit-bypasses-review`
- **Affected boundary / root cause (claimed):** updateEvent (server/src/controllers/alumni/alumniEventsController.js:206-245) checks only that the caller is the organizer or an admin (line 215). It then runs Object.assign(event, pick(req.body, allowed)) and event.save() (lines 229-230) without checking event.status or env.alumni.eventsRequireApproval. By contrast, createEvent sets pending_approval for non-admin/HOD callers (line 154), and approveEvent only accepts pending_approval (line 253), so an edited event never gets reviewed again.

ALUMNI_EVENTS_REQUIRE_APPROVAL is on by default. While it is on, events proposed by alumni, and by faculty (createEvent only treats admin and hod as staff), start as pending_approval and need admin/HOD approval. Once approved (status scheduled), the organizer can call PATCH /alumni/events/:id and change title, description, type, mode, venue, meetingLink, dates, registrationDeadline, capacity, audience, cover and organizerName. updateEvent does not reset the status to pending_approval, does not notify reviewers, and does not re-check whether the alumnus profile is still verified. The new title, description, venue and cover are shown to every authenticated user in the upcoming-events listing and detail view, so content no one reviewed gets the approved event's standing. The meetingLink is shown only to going attendees, the organizer and staff (lines 110-115, 197-200). Going attendees are notified only when startsAt or venue changes, so a meetingLink swap reaches RSVP'd users with no notice. The impact is limited to integrity and social engineering. The changed link must still pass assertHttpUrl, and no access or data boundary beyond the review gate is crossed.

**Source trace**

1. *entrypoint* `server/src/routes/alumniRoutes.js:338` — `PATCH /alumni/events/:id`: Only idParam validation; no authorize() and no body validators. The router is mounted after protect (routes/index.js:2131), so any authenticated user reaches updateEvent.
1. *propagation* `server/src/controllers/alumni/alumniEventsController.js:215` — `updateEvent`: Allows the organizer or an admin; does not check status, the approval setting, or current alumni verification.
1. *propagation* `server/src/controllers/alumni/alumniEventsController.js:222` — `updateEvent`: pick() allows title/description/type/mode/venue/meetingLink/startsAt/endsAt/registrationDeadline/capacity/audience/cover/organizerName; meetingLink only has to pass assertHttpUrl (line 223).
1. *sink* `server/src/controllers/alumni/alumniEventsController.js:230` — `updateEvent`: event.save() saves the new content and status stays 'scheduled'; listEvents (lines 54-62) and getEventById then serve it to all authenticated users.

**Evidence**

- `server/src/config/env.js:214`: eventsRequireApproval is true unless ALUMNI_EVENTS_REQUIRE_APPROVAL === 'false'.
- `server/src/controllers/alumni/alumniEventsController.js:154`: Proposals from callers other than admin/HOD (alumni, faculty) start as pending_approval; this is the intended review gate.
- `server/src/controllers/alumni/alumniEventsController.js:253`: approveEvent moves only pending_approval to scheduled; no path exists for reviewing an edit later.
- `server/src/controllers/alumni/alumniEventsController.js:229`: Object.assign of the patch onto the event runs whatever the event's current status.
- `server/src/controllers/alumni/alumniEventsController.js:225`: The attendee notification fires only when startsAt or venue changes; meetingLink, title and description changes are silent.
- `server/src/controllers/alumni/alumniEventsController.js:113`: meetingLink is removed from list output unless the viewer is going, the organizer or staff, so a swapped link reaches only going attendees.

**Blockers**

- No OS-enforced sandbox is available to run a bounded local check (Docker daemon stopped on the Windows host), so the edit-after-approval behaviour has not been observed.
- Source does not document whether institutional policy requires edits to approved alumni events to be reviewed again; if post-approval edits by organizers are intended, this is a hardening gap rather than a bypass.

**Resolution plan**

- *Local (sandboxed, dummy data):* In a sandbox, with server/tests helpers, an isolated test MongoDB and dummy users: (1) a verified alumnus POSTs /api/alumni/events with a valid future event; expect status pending_approval. (2) A dummy admin POSTs /api/alumni/events/:id/approve; expect status scheduled. (3) A dummy student POSTs /api/alumni/events/:id/rsvp. (4) The alumnus PATCHes /api/alumni/events/:id with {title:'changed title', description:'unreviewed replacement text for the event', meetingLink:'https://example.test/x'}. (5) The student GETs /api/alumni/events and /api/alumni/events/:id. Observe the changed title/description with status 'scheduled' and the new meetingLink visible to the going student. Confirm that no Notification rows were created for admin/HOD or for the student. Stop there.
- *Owner-observed (no audit traffic):* The owner confirms ALUMNI_EVENTS_REQUIRE_APPROVAL is not set to 'false' in the Render environment, and states whether organizer edits to approved events are meant to need re-approval.

## 24. Alumni job owner can change an approved job's content without re-review when job approval is enabled

- **Fingerprint:** `alumni-job-post-approval-edit-bypasses-review`
- **Affected boundary / root cause (claimed):** updateJob (server/src/controllers/alumni/alumniJobsController.js:206-228) applies content fields supplied by the owner (pick + Object.assign at line 223) to a job in any status except 'removed' (line 216), including an approved 'open' job. It saves at line 224 and never sets status back to 'pending_review' when env.alumni.jobsRequireApproval is true and the editor is not admin or hod. The approval gate exists only when the job is created (lines 140-142).

When ALUMNI_JOBS_REQUIRE_APPROVAL=true, createJob saves posts from alumni and faculty (any role except admin and hod) as 'pending_review'. Only an admin can move a pending_review job to 'open', through PATCH /alumni/jobs/:id/reopen. Once a job is approved and open, the poster can call PATCH /alumni/jobs/:id and replace title, company, type, workMode, location, description, skills, experience, stipendOrSalary, applyMode, externalUrl, deadline, eligibleDepartments and eligibleYears. updateJob saves these changes and leaves the status at 'open', so content no moderator has seen goes straight into the student job listing (listJobs) and the detail view (getJobById). The PATCH route has no body validators, and updateJob does not repeat createJob's http(s) check on externalUrl for external_link jobs, so the edited content gets no input validation either; only the schema maxlength limits apply. The source shows no notification, audit hook or model pre-save hook that would trigger a new review. Job approval is off by default (env.js:213 requires the literal string 'true'), and render.yaml does not set ALUMNI_JOBS_REQUIRE_APPROVAL, so the bypass only matters in deployments that turn approval on. The verifier also noticed a separate issue that is not part of this fingerprint: closeJob (alumniJobsController.js:231-244) has no status precondition. A poster may therefore be able to close a job that is still pending_review and then reopen it (reopenJob allows posters to reopen 'closed' jobs), which would skip approval entirely. That deserves its own candidate. updateEvent in alumniEventsController.js has the same no-reset pattern, but it is separate code with a separate flag.

**Source trace**

1. *entrypoint* `server/src/routes/alumniRoutes.js:276` — `alumniRouter.patch('/jobs/:id')`: Authenticated route (behind protect, mounted under /api/alumni) with only idParam validation. There are no body validators and no route-level authorize; the controller does the authorization.
1. *propagation* `server/src/controllers/alumni/alumniJobsController.js:212` — `updateJob`: Allows the poster (isPoster) or an admin. Line 216 rejects only status 'removed', so an approved job with status 'open' passes.
1. *propagation* `server/src/controllers/alumni/alumniJobsController.js:223` — `updateJob`: Object.assign(job, pick(req.body, allowed)) overwrites title, company, description, applyMode, externalUrl, deadline, eligibleDepartments, eligibleYears and other content fields. Status is left unchanged.
1. *sink* `server/src/controllers/alumni/alumniJobsController.js:224` — `updateJob`: job.save() stores the unreviewed content on an 'open' job. listJobs serves that job to students (status 'open' filter at line 32) and so does getJobById.

**Evidence**

- `server/src/controllers/alumni/alumniJobsController.js:140`: Moderation policy: when env.alumni.jobsRequireApproval is true, posts from anyone other than admin or hod start as 'pending_review' (lines 140-142).
- `server/src/controllers/alumni/alumniJobsController.js:257`: reopenJob lets non-admins reopen only 'closed' or 'expired' jobs, so moving pending_review to open is an admin action. This is the approval step the edit path skips.
- `server/src/controllers/alumni/alumniJobsController.js:32`: listJobs shows students only jobs with status 'open' (other non-staff roles get the same filter at line 46), so content on an open job is visible to students.
- `server/src/controllers/alumni/alumniJobsController.js:134`: createJob requires an http(s) externalUrl for external_link jobs. updateJob does not repeat this check, so edited content is not validated either.
- `server/src/config/env.js:213`: jobsRequireApproval is true only when ALUMNI_JOBS_REQUIRE_APPROVAL === 'true'. It is off by default, and render.yaml does not set it.
- `server/src/constants.js:301`: JOB_STATUSES includes 'pending_review'. The only place that sets it is createJob (line 141), so no edit path brings a job back into review.
- `server/src/controllers/alumni/alumniEventsController.js:229`: The sibling updateEvent has the same pattern (Object.assign with no status reset) but is a separate handler with a separate flag. It is tracked under a separate fingerprint.

**Blockers**

- No OS-enforced sandbox is available on this Windows host (Docker daemon stopped, no Windows Sandbox), so the bounded local reproduction was not executed.
- The impact requires ALUMNI_JOBS_REQUIRE_APPROVAL=true. render.yaml does not set it, and source cannot show whether the production Render environment sets it outside render.yaml.

**Resolution plan**

- *Local (sandboxed, dummy data):* In a sandboxed server test using the existing alumni test harness and a disposable mongo test DB, set process.env.ALUMNI_JOBS_REQUIRE_APPROVAL='true' before importing env. Steps: (1) Create a dummy alumni user and POST /api/alumni/jobs with a benign title, a description of at least 20 characters, applyMode 'referral', valid type and workMode, and a future deadline. Expect status 'pending_review'. (2) As a dummy admin, PATCH /api/alumni/jobs/:id/reopen. Expect status 'open'. (3) As the alumni user, PATCH /api/alumni/jobs/:id with {"title":"Changed after approval","description":"unreviewed text of at least twenty chars"}. Today this should return 200 with status still 'open'. (4) As a dummy student, GET /api/alumni/jobs and check whether the changed title appears. Stop at that observation. Expected fixed behavior: step 3 returns the job to 'pending_review' (or returns 403), and the student listing in step 4 no longer shows the job.
- *Owner-observed (no audit traffic):* The owner checks the Render service environment variables in the dashboard (not render.yaml) for ALUMNI_JOBS_REQUIRE_APPROVAL. If the value is exactly 'true', the bypass applies in production. If it is unset or any other value, jobs never enter review and this finding has no effect there.

## 25. Alumni job eligibility (departments/years) is enforced only in the student listing, not on apply

- **Fingerprint:** `alumni-job-apply-eligibility-not-enforced`
- **Affected boundary / root cause (claimed):** The eligibility rule is implemented only as a listing query filter for students (alumniJobsController.js:34-44) instead of as a server-side precondition of the state-changing applyToJob operation; eligibleYears is stored (AlumniJob.js:27) but never compared to the student's User.year (User.js:41) anywhere.

Job posters can restrict an opportunity with eligibleDepartments and eligibleYears (accepted by createJob/updateJob, alumniJobsController.js:130 and 221). For students, listJobs hides jobs whose non-empty eligibleDepartments excludes the student's department (34-44, only when user.department is set); eligibleYears is never used in any filter or check. applyToJob (301-358) checks only that the job exists, is not self-posted, is 'open' and not past deadline, then creates or reactivates a JobApplication and notifies the poster. getJobById (179) returns the job to any authenticated user, and no other middleware on the alumni router checks eligibility. An authenticated student outside the eligible departments or years who knows the job id (shared link, notification, or browser history) can therefore apply and request a referral, bypassing the poster's restriction and generating a notification and socket event to the poster. Impact is limited to a business-rule bypass: the poster still sees the applicant and can reject; no data of other users is exposed.

**Source trace**

1. *entrypoint* `server/src/routes/alumniRoutes.js:288` — `POST /api/alumni/jobs/:id/apply`: Authenticated route with idParam, authorize('student') (line 290), writeLimiter and body validation of note/resumeUrl/referralRequested only; no eligibility guard.
1. *propagation* `server/src/controllers/alumni/alumniJobsController.js:306` — `applyToJob`: Job loaded with AlumniJob.findById(id) with no eligibleDepartments/eligibleYears condition.
1. *propagation* `server/src/controllers/alumni/alumniJobsController.js:313` — `applyToJob`: Only status 'open' (313) and deadline (314-316) are checked after the self-post check (309-311).
1. *sink* `server/src/controllers/alumni/alumniJobsController.js:333` — `applyToJob`: JobApplication created (or a withdrawn one reactivated at 321-329), applicationCount incremented, and the poster notified (350) and emitted to (357) for an ineligible student.

**Evidence**

- `server/src/controllers/alumni/alumniJobsController.js:34`: Student listing filter restricts by eligibleDepartments when user.department is set, showing the intended rule.
- `server/src/models/AlumniJob.js:26`: eligibleDepartments and eligibleYears (line 27) are stored per job.
- `server/src/models/User.js:41`: User.year (1-6) exists and is the natural comparand for eligibleYears, yet no code compares them.
- `server/src/controllers/alumni/alumniJobsController.js:179`: getJobById performs no eligibility check (only hides 'removed' jobs from non-poster non-staff), so the job is reachable by id.
- `server/src/controllers/alumni/alumniJobsController.js:130`: createJob picks eligibleDepartments and eligibleYears from the request, so posters can set restrictions that are never enforced on apply.

**Blockers**

- No OS-enforced sandbox is available on this Windows host (Docker daemon stopped), so the bounded local reproduction could not be executed; source review only.

**Resolution plan**

- *Local (sandboxed, dummy data):* With a local mongo and dummy users only: as a dummy faculty/alumni poster, POST /api/alumni/jobs with eligibleDepartments ['CSE'] and eligibleYears [4] and a future deadline. As a dummy student with department 'ECE' and year 2, GET /api/alumni/jobs and confirm the job is absent; then POST /api/alumni/jobs/<id>/apply with {"referralRequested":true}. Expected today: 201 and a Notification row for the poster. Fix: in applyToJob, before creating/reactivating, throw ApiError(403) when job.eligibleDepartments is non-empty and does not include student.department, or job.eligibleYears is non-empty and does not include student.year; regression test asserts 403 and no JobApplication/notification is created.

## 26. Stale faculty score shown on unreviewed college-published project content and on the faculty leaderboard

- **Fingerprint:** `skill-wallet:facultyScore-not-cleared-on-material-revision`
- **Affected boundary / root cause (claimed):** updateProject (server/src/controllers/skillWallet/projectController.js:172-177) increments revision and resets review.status from 'approved' to 'draft' on a material change but does not clear InnovationProject.facultyScore or review.approvedRevision. setPublication with audience 'college' (publicationController.js:96-105) calls publishSnapshot, which copies the current unreviewed revision into published with no approval check (by design for college). galleryView (services/skillWallet/projects.js:255), the gallery 'rating' sort (galleryController.js:63,85) and leaderboard (galleryController.js:306-319) use the project-level facultyScore without requiring published.revision === review.approvedRevision.

A student project owner whose revision R was approved by faculty (which sets review.approvedRevision=R and project-level facultyScore) can materially rewrite the project (revision becomes R+1, review.status 'approved' -> 'draft') and then republish it to the college gallery, which needs no review by design. facultyScore and approvedRevision are left unchanged by the material edit, and the gallery card, gallery 'rating' sort, college portfolio view and the 'Faculty evaluation' leaderboard read the project-level facultyScore without checking that published.revision equals review.approvedRevision. College users therefore see the old faculty score presented as the evaluation of new, never-reviewed content, contrary to LEADERBOARD_CRITERIA.faculty ('reviews that approved the published revision'). Public publication is not affected directly: public republish requires approvedRevision === revision, but a public project can be narrowed to college and then republished there. Impact is limited to misrepresentation of an academic evaluation (integrity of displayed faculty endorsement) to authenticated college users; no data disclosure or privilege gain.

**Source trace**

1. *entrypoint* `server/src/controllers/skillWallet/projectController.js:172` — `updateProject (PUT /api/skill-wallet/projects/:id, student owner/member)`: Material edit after approval of revision R: revision becomes R+1 and review.status 'approved' -> 'draft' (line 177); facultyScore and review.approvedRevision are left unchanged
1. *propagation* `server/src/controllers/skillWallet/reviewController.js:186` — `submitReview (prior faculty approval of revision R)`: Earlier approval set review.approvedRevision=R (line 185) and facultyScore=mean approved totalScore of revision R
1. *propagation* `server/src/controllers/skillWallet/publicationController.js:103` — `setPublication audience=college (PUT /api/skill-wallet/projects/:id/publication, owner)`: From private or college (or after narrowing public -> college), publishSnapshot (line 36-39) copies unreviewed revision R+1 into published with no approval check
1. *propagation* `server/src/services/skillWallet/projects.js:255` — `galleryView`: Gallery card returns the project-level facultyScore from revision R next to published R+1 content
1. *sink* `server/src/controllers/skillWallet/galleryController.js:319` — `leaderboard (GET /api/skill-wallet/leaderboard?board=faculty)`: Faculty board filters only on facultyScore != null (line 306), ranks by and displays the stale score under criteria text (line 37) claiming it scores the approved published revision

**Evidence**

- `server/src/controllers/skillWallet/projectController.js:177`: Only review.status is reset on a material change; facultyScore and approvedRevision are not touched
- `server/src/controllers/skillWallet/reviewController.js:191`: facultyScore is cleared only when a later reject/request_changes hits the same approved revision, showing the score is intended to track the approved revision
- `server/src/controllers/skillWallet/publicationController.js:109`: Only the public branch requires approvedRevision === revision; the college branch (lines 96-105) has no such check
- `server/src/controllers/skillWallet/galleryController.js:37`: Published criteria: 'mean weighted rubric score (0-100) of the faculty reviews that approved the published revision'
- `server/src/controllers/skillWallet/galleryController.js:306`: Faculty board filter is only facultyScore != null; no published.revision vs review.approvedRevision check (same for rating sort at lines 63 and 85)
- `server/src/services/skillWallet/projects.js:153`: snapshotOf records published.revision, so the mismatch is detectable but unused by gallery/leaderboard
- `server/src/models/InnovationProject.js:86`: Schema comment: facultyScore is the mean of the approving reviews of approvedRevision

**Blockers**

- No OS-enforced sandbox is available on this Windows host (Docker daemon stopped, no Windows Sandbox), so the bounded local test could not be executed; the result is source-only.

**Resolution plan**

- *Local (sandboxed, dummy data):* Inside an approved sandbox with a local mongo and dummy fixtures (server/tests/skill-wallet-fixtures.js), extend the existing flow in server/tests/skill-wallet-projects.test.js that approves a solo project (facultyScore 80): as the owner, PUT /api/skill-wallet/projects/:id with a changed title and description (material keys); then PUT /api/skill-wallet/projects/:id/publication {audience:'college'}; as another dummy college student, GET /api/skill-wallet/gallery/:id and GET /api/skill-wallet/leaderboard?board=faculty. Bug is observed if the response shows the new title with facultyScore 80 and the project ranked on the faculty board while the owner's project view reports review.status 'draft' and published.revision != approvedRevision. Stop at that observation.
- *Owner-observed (no audit traffic):* Owner-observed only, non-destructive: in a staging instance, compare for college-visible projects whether published.revision differs from review.approvedRevision while facultyScore is non-null (read-only Mongo query on innovationprojects: {facultyScore:{$ne:null}, published:{$ne:null}, $expr:{$ne:['$published.revision','$review.approvedRevision']}}).

