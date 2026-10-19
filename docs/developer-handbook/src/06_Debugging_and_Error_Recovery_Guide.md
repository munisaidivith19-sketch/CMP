---
title: Debugging and Error Recovery Guide
subtitle: Find where a VEXON problem starts, prove the cause, fix it safely, and stop it coming back, without depending on AI
number: 06
audience: A student maintaining VEXON alone who needs a repeatable way to investigate errors
---

# The debugging mindset

Debugging is **collecting evidence until only one explanation is left**. It is not guessing. Every investigation in VEXON follows the same loop:

```flow
1. Reproduce: make the bug happen on purpose, and write down the exact steps, role and data
-> 2. Locate
Find which layer fails: browser, network, API middleware, controller, database, configuration, mobile
-> 3. Explain
State one hypothesis that explains ALL the evidence ("the CSRF cookie is stale because ...")
-> 4. Prove
Change one thing, or add one log line, that would confirm or kill the hypothesis
-> 5. Fix
Smallest change that removes the cause (not the symptom)
-> 6. Protect
Add a test that fails without the fix; run the full suites; write a short incident note
```

> [!KEY] The most valuable sentence in any bug report is the **exact error message** together with **where you saw it** (browser console, Network tab response, server terminal, Android logcat). Copy it exactly. Do not paraphrase.

# Where evidence lives

| Source | How to open it | What it tells you |
|---|---|---|
| Browser Console | F12, then Console | JavaScript exceptions with file and line; React warnings |
| Browser Network tab | F12, then Network; filter `Fetch/XHR` | Every API call: method, URL, status, request headers, response body |
| Browser Application tab | F12, then Application, then Cookies | `cc_refresh` (httpOnly) and `cc_csrf` cookies in development; `__Secure-cc_refresh` and `__Host-cc_csrf` in production |
| React DevTools / Redux DevTools | Browser extensions | Component props and state; the RTK Query cache and `auth` state |
| Server terminal (`npm run dev`) | The window running the API | `morgan` request lines; `[error]` stack traces; `[db]`, `[env]`, `[socket]` messages |
| MongoDB | mongosh or Compass, on **dev** data | Whether the document really exists or changed |
| Admin, then Security & Logs | Web, admin only | Sign-in failures, session revocations, scope refusals, OTP events |
| Android logcat | Android Studio Logcat, or `adb logcat` | Kotlin exceptions, OkHttp failures, crashes |
| GitHub Actions | The repository's Actions tab | CI test and build failures |
| Render dashboard | Service, then Logs | Production server logs |

# Browser developer tools in practice

## Console errors

A red error such as `TypeError: Cannot read properties of undefined (reading 'map') at Notifications (Notifications.jsx:50)` tells you three things: **what** happened (reading `.map` of `undefined`), **where** (the file and line), and **what to suspect** (data not loaded yet, or the API returned another shape). In VEXON the usual fix is optional chaining (`data?.items?.length`) plus a loading state. Check `Notifications.jsx` to see how the real code avoids this.

## The Network tab

For a failing action:

1. Click the red request.
2. **Headers**: check the request URL and method, and that `Authorization: Bearer ...` and `x-csrf-token` are present.
3. **Response**: read the JSON `message`. VEXON always sends one.
4. **Status**: use the table below.
5. **Timing**: a very long wait followed by failure suggests the server is asleep (Render free plan, about 30 s to wake) or there is a network problem.

| Status | First suspicion in VEXON | Where to look |
|---|---|---|
| (failed) / `FETCH_ERROR` | Server not running, wrong port, CORS, or offline | Server terminal; `client/vite.config.js` proxy |
| 401 | Access token expired and the refresh failed; session revoked; idle timeout (`reason: 'idle'`) | `server/src/middleware/auth.js`, `server/src/utils/sessionIdle.js`, `client/src/services/api.js` |
| 403 "Invalid or expired CSRF token" | Missing or stale CSRF cookie or header | `server/src/middleware/security.js`, `client/src/services/csrfCookie.js` |
| 403 "Cross-origin request blocked by security policy" | The page's origin is not in `CLIENT_URL` / `APP_URL` | `server/.env` `CLIENT_URL`; `security.js` `getAllowedOrigins` |
| 403 "You do not have permission ..." | `authorize(...)` refused the role | The route in `server/src/routes/index.js` |
| 403 "The ... can only use ..." | `confinedRoleGuard` (coe, office, transport) | `server/src/middleware/coeGuard.js` |
| 404 "Route not found: ..." | Wrong URL or method, or a route that is not registered | `routes/index.js`; RTK endpoint URL in `api.js` |
| 409 | Duplicate unique value, or a business conflict (e.g. an exam blocks attendance) | `middleware/error.js`; the controller |
| 422 | Validation: read `errors[].field` | The `body(...)` rules for the route; Mongoose schema |
| 423 | Account locked after failed sign-ins | `authController.login`; wait, or have an admin reset the password |
| 429 | Rate limiter hit; the message names which one | `server/src/middleware/rateLimit.js` |
| 500 | A bug or an unexpected exception | Server terminal `[error]` stack trace |

# Reading a stack trace

> [!STATUS] The trace below is a **hypothetical example**, written to teach the method. It is not a recorded VEXON error.

```text
[error] TypeError: Cannot read properties of null (reading 'department')
    at createComplaint (file:///.../server/src/controllers/complaintController.js:126:34)
    at file:///.../server/src/utils/http.js:13:19
    at Layer.handle [as handle_request] (.../node_modules/express/lib/router/layer.js:95:5)
    at next (.../node_modules/express/lib/router/route.js:149:13)
```

- **Line 1**: the error type and message. Here, something expected to be an object was `null`.
- **Read downward and stop at the first line inside VEXON's own code**, not `node_modules`. Here it is `complaintController.js:126`, column 34.
- `http.js:13` is `asyncHandler`. It appears in almost every trace and is rarely the cause.
- Open line 126, find which variable could be `null`, and ask *why*. A missing populate? A user without a department? Then reproduce it with that data.

# Common errors and their usual causes

| Error text (where) | Usual cause | Fix direction |
|---|---|---|
| `Cannot read properties of undefined` (console or terminal) | Data not loaded, a missing field, or a wrong shape | Optional chaining plus a loading or empty state; fix the data source |
| `X is not a function` | Wrong import (default vs named), or a typo | Check the `export` in the source file |
| `Objects are not valid as a React child` | Rendering an object in JSX | Render a field: `{user.name}` |
| `Each child in a list should have a unique "key"` | `.map()` without `key` | `key={item._id}` |
| `Too many re-renders` | Calling a state setter during render | Move it into an event handler or effect |
| `Cannot find module '../x'` / `ERR_MODULE_NOT_FOUND` (server) | Missing `.js` extension in a server import, or a wrong path | Server ES-module imports need `.js` |
| `EADDRINUSE :::5000` | Another process is using port 5000 | Stop the other process, or set `PORT` (README section 7) |
| `[db] Could not connect to MongoDB (local)` | MongoDB service stopped; wrong `MONGO_URI` | Start the service (`net start MongoDB`, as admin, on Windows) |
| `DB_TARGET=atlas but MONGO_URI_ATLAS is not set in .env` | Switched to Atlas without a URI | Set it, or use `DB_TARGET=local` |
| `Missing required environment variable: JWT_ACCESS_SECRET` (production) | Secret not configured on the host | Set it in the host's environment (Render dashboard) |
| `[env] ... using an insecure development default` | No secret in a dev `.env` | Fine for local only; never in production |
| `Refusing to run tests against a non-test database` | `TEST_MONGO_URI` does not end in `_test` | Use `.../cmp_test` |
| `MongoServerError: E11000 duplicate key` (409 to the client) | A unique index was violated | Show a friendly message; check whether duplicates are legitimate |

# Database connection and validation errors

1. Is MongoDB running? On Windows, open `services.msc` and find "MongoDB Server"; or run `mongosh` and see whether it connects.
2. Which database is the server using? The start-up line `[db] MongoDB connected (local) -> host:port/name` tells you. A surprising name means a surprising `.env`.
3. Validation errors (422) list `field` and `message`. Compare them with the schema in `server/src/models/<Model>.js` and the route's `body(...)` rules.
4. Unique index failures at start-up (from `syncIndexes`) mean existing data breaks a new rule. Find the duplicates with an aggregation (Guide 04).

# Authentication and permission failures

```flow
Request fails with 401 or 403
-> 401?
Session: is the access token sent? Did the refresh succeed? Is the Session revoked or idle? (auth.js, sessionIdle.js)
-> 403?
Read the message: CSRF -> security.js;  "permission" -> authorize() on the route;  "can only use" -> coeGuard.js
-> still 403 inside the controller?
Scope check: wrong department, class or ownership (academicScope.js, peopleScope.js, controller assert* helpers)
-> verify with
A test user of that exact role and department (server/tests/helpers.js createUser + login) or the seed accounts
```

> [!MISTAKE] "Fixing" a 403 by adding a role to `authorize(...)` without asking whether that role *should* have access. A 403 is often the system working correctly. Check `server/src/constants.js` and the module's rules in Guide 05 first.

# Environment and configuration problems

| Symptom | Configuration to check |
|---|---|
| Web works, but writes fail with a 403 origin error after deploying | `CLIENT_URL` and `APP_URL` must equal the real public URL (`render.yaml` explains why) |
| Socket "Reconnecting..." forever in production | Same `CLIENT_URL` (Socket.IO CORS), plus a proxy that supports WebSockets |
| Every user locked out at once in production | `TRUST_PROXY` wrong, so all visitors share the proxy IP (`trustProxySetting` in `server/src/app.js`) |
| Uploaded images vanish after a Render deploy | Cloudinary not configured; files went to local disk or the database |
| Bus map is blank | `MAP_STYLE_URL` unreachable, or its origin missing from the CSP (`MAP_CSP_ORIGINS`) |
| Parent OTP never arrives | `OTP_SMS_ENABLED` and the `SMS_*` variables; with SMS off, admins read OTPs in Security & Logs, then OTP |
| Study Assistant says it is unavailable | `GROQ_API_KEY` is unset |
| Android app cannot reach the server | The server URL set on the login screen; `10.0.2.2` only works in the emulator; plain HTTP needs an `http://` build setting |

Never print secret values while debugging. Print `Boolean(process.env.GROQ_API_KEY)`, not the key itself.

# Socket.IO troubleshooting

1. Network tab, filter **WS**: is there a `socket.io` connection with status 101?
2. Console: `connect_error` with `unauthorized` means the access token was rejected at the handshake. `client/src/services/socket.js` then refreshes and retries.
3. Rooms are joined **after a database check**. If a chat updates for one user but not another, check membership (`canUseConversation` in `server/src/config/socket.js`).
4. After a reconnect, rooms are re-joined by `connectHooks` (web) or the Kotlin `Realtime` equivalent. A missing re-join means stale data until reload.
5. A server-side live check: `node server/scripts/realtime-smoke.mjs` (needs a running server and the seed accounts).

# Android build and runtime errors

| Problem | Evidence | Usual fix |
|---|---|---|
| Gradle sync or build fails: "Unsupported class file major version" / toolchain | Build output | The project uses `jvmToolchain(17)`. Install JDK 17, or let Gradle provision it |
| `SDK location not found` | Build output | Create `mobile-kotlin/local.properties` with `sdk.dir=...` (never commit it) |
| App shows "Cannot reach the JNN server" | The app's `errMsg` (`core/Http.kt`) | Wrong server URL; server down or asleep; phone not on the same network |
| `CLEARTEXT communication not permitted` | Logcat | Release build pointed at `http://`; build with an `http://` `vexon.apiUrl` or use HTTPS |
| Crash on a screen | Logcat `FATAL EXCEPTION` with a `com.vexon.campus...` frame | Open that file and line; often a JSON field is missing (see `core/Json.kt` helpers) |
| Push never arrives | Server logs; `DeviceToken` collection | `google-services.json` missing at build time (push disabled); `FCM_SERVICE_ACCOUNT` unset on the server |
| Debug app shows production data | `gradle.properties` `vexon.apiUrl` | Build with `-Pvexon.apiUrl=http://10.0.2.2:5000` for a local server |

Useful commands, run from `mobile-kotlin/`: `gradlew.bat assembleDebug`, `gradlew.bat testDebugUnitTest`, and `adb logcat | findstr vexon` (Windows).

# Identifying the layer: frontend, backend, database, network or configuration

```flow
Does the Network tab show a request at all?
-> no request
FRONTEND: the handler did not run (console error, disabled button, form validation stopped it)
-> request sent; status (failed) or no response
NETWORK / CONFIG: server down, wrong URL or port, proxy, CORS, offline
-> status 4xx
BACKEND RULES: read the message -> auth, permission, validation, rate limit (usually correct behaviour)
-> status 5xx
BACKEND BUG or DATABASE: read the [error] stack trace in the terminal
-> status 200 but the screen is wrong
FRONTEND STATE or DATA: compare the response body with what is rendered; check cache tags
-> response data itself is wrong
DATABASE / QUERY: inspect the document in mongosh; check the controller's filter and scope
```

# Reproducing and minimising a bug

1. Write the steps as a numbered list: role, starting page, clicks, inputs, expected result, actual result.
2. Remove steps one by one while the bug still happens. That gives a **minimal reproduction**.
3. Turn the reproduction into **a request**, a `curl` command or a `ctx.request(...)` call in a test, so it runs without clicking.
4. If it depends on data, create that data in the test (`ctx.createUser({ role: 'hod', department: 'CSE' })`). **Do not depend on real records.**

# Evaluating an AI-generated fix

Before accepting any fix, from Claude or anyone else, answer these:

- [ ] Does the explanation match **all** the evidence, including the exact error message and the file and line?
- [ ] Does the change touch only the files needed? Read the whole `git diff`.
- [ ] Does it remove a **security check** (`authorize`, a scope assert, CSRF, validation, rate limit) or widen a role list? If so, why is that correct?
- [ ] Does it change an **API contract** (URL, request or response shape) used by web, Kotlin, Expo or iOS?
- [ ] Does it hide the error instead of fixing it (an empty `catch {}`, `|| []` everywhere, a deleted test)?
- [ ] Is there a new or updated **test** that fails without the fix?
- [ ] Do the full suites still pass (`npm test --prefix server`, `npm test --prefix client`, Kotlin `testDebugUnitTest`)?
- [ ] Did you run the real flow once, as the affected role?
- [ ] Does it introduce a dependency, secret, or hard-coded URL?

> [!WARNING] Never paste real student data, `.env` values, tokens or database URIs into an AI prompt. Replace them with fake values first.

# Testing a fix and preventing regressions

1. Write a test that reproduces the bug, and **watch it fail**.
2. Apply the fix and watch the test pass.
3. Run the whole suite. A fix in shared code (`utils/`, `middleware/`, `constants.js`) can break other modules.
4. Run the client build if you touched `client/`.
5. Note the bug and the test name in your commit message, so the history explains the "why".

Guide 07 shows how to write tests in VEXON's style.

# Troubleshooting table

> [!STATUS] Rows are **realistic scenarios derived from VEXON's architecture**. They are not records of incidents that occurred. File names are real.

| Symptom | Evidence to collect | Likely causes | Files or components to inspect | Safe next step | How to verify |
|---|---|---|---|---|---|
| Web user logged out after about 2 minutes | Response `reason: 'idle'`; role of the user | Web idle rule for non-exempt roles (by design); activity pings not sent | `server/src/utils/sessionIdle.js`, `client/src/components/layout/useIdleSession.js`, `client/src/services/idleTracker.js` | Confirm the role is meant to be non-exempt; check that `POST /api/auth/activity` is sent on interaction | `server/tests/idle-session.test.js`; manual test with that role |
| Every write fails with 403 CSRF | Response message; Application tab cookies | Stale legacy cookie; a cookie blocked; the header not sent | `server/src/middleware/security.js`, `client/src/services/csrfCookie.js`, `client/src/services/api.js` | Sign out and in again (issues a fresh pair); compare cookie and header | `csrf-legacy-cookie` and `csrf-self-heal` tests |
| Login always "Invalid email or password" for a real user | `SecurityLog` / `LoginHistory` reason | Wrong password; account inactive (that would be a 403); email case or typo | `authController.login`, `models/User.js` | Admin resets the password (`POST /api/users/:id/reset-password`) | User signs in; `LOGIN_SUCCESS` in Security & Logs |
| HOD cannot edit a timetable slot | 403 or 422 message text | Slot outside the HOD's department or years; first-year rule | `timetableController.js`, `constants.js` (`isFirstYearHod`) | Check the HOD's `department` and the class's year | `timetable-roles` test; retry as the correct HOD |
| Faculty cannot mark attendance today | 409 or 422 message | Holiday declared; published exam overlaps the period; not the faculty's scheduled class | `attendanceController.markAttendance`, `holidayController.js`, `examController.js` | Read the message; check Holidays and the Exam timetable | `attendance-timetable` and `exam-timetable` tests |
| Gate pass cannot be forwarded to the HOD | Message "Verify the parent's OTP before forwarding" | Parent OTP not verified yet | `gatePassController.js` (`facultyReview`), `services/otp/otpService.js` | Request and verify the OTP first; if SMS is off, an admin reads it in Security & Logs | `outpass-otp` test; pass reaches `pending_hod` |
| "Send OTP" fails with "not configured" | Response message; server log | `OTP_SMS_ENABLED=true` without the `SMS_*` variables | `server/src/config/env.js`, `services/otp/providers/collegeSmsProvider.js` | Set the variables on the host, or turn SMS off | `otp-send-error-message` test; a real send on staging |
| Bus not shown on the map | Bus `lastLocation`; trip status; server rejections | No accepted fix yet; a fix rejected (stale, inaccurate, jump); the viewer may not see that bus | `services/transport/ingest.js`, `access.js`, `client/src/pages/transport/Transport.jsx` | Run `simulate-bus.mjs` on **dev** with a test bus | `transport.test.js`; marker appears in dev |
| Notification arrives in the app but not as a phone push | `Notification.delivery` field; server log | FCM not configured; device token missing or expired | `server/src/services/pushService.js`, `fcm.js`, Kotlin `push/Push.kt` | Check `FCM_SERVICE_ACCOUNT` (presence only) and the `DeviceToken` rows | `notifications-push` test; a real device test |
| Chat messages appear only after a reload | WS frames; console `connect_error` | Socket not connected; room not joined; access token expired at handshake | `client/src/services/socket.js`, `server/src/config/socket.js` | Check the Live indicator and the WS tab; reconnect | `chat*` tests; `realtime-smoke.mjs` |
| Uploaded file rejected with 415 or 400 | Response message | Real type (magic bytes) not allowed; too big | `server/src/utils/storage.js`, `MAX_UPLOAD_MB` | Try a genuine PNG or PDF under 5 MB | `input-hardening` test; upload succeeds |
| Server will not start in production | Render logs | A missing secret throws; MongoDB unreachable | `server/src/config/env.js`, `config/db.js` | Compare the variables with `server/.env.example` (names only) | `/api/health` returns `{status: 'ok'}` |
| Study Assistant errors | Response status and message | Groq key missing; rate limit; provider outage | `server/src/services/ai/groqService.js`, `rateLimit.js` (AI limiters) | Check that the key exists; wait for the limit window | `study-assistant` test; one real question |
| Kotlin app stuck on "Can't reach server" | Login screen server value; logcat | Wrong URL; server asleep; cleartext blocked | `core/Config.kt`, `core/Http.kt`, `app/build.gradle.kts` | Use "Test & save" on the server address | App signs in |

# Repeatable debugging checklist

- [ ] I can reproduce it, and I wrote the steps, role and data.
- [ ] I copied the exact error message and where it appeared.
- [ ] I know the request (method, URL, status, response `message`).
- [ ] I identified the layer (frontend, network, backend rules, backend bug, database, configuration, mobile).
- [ ] I found the exact file and line (stack trace or a message search).
- [ ] I have one hypothesis that explains all the evidence.
- [ ] I proved it with a single change or log.
- [ ] My fix is the smallest one that removes the cause.
- [ ] A test fails before the fix and passes after.
- [ ] Full server and client suites pass; the client build passes; Kotlin tests pass if I touched Android.
- [ ] I removed temporary logs and reviewed `git diff`.
- [ ] I wrote an incident note if users were affected.

# Incident report template

```text
INCIDENT REPORT - VEXON
Title:
Date/time detected:            Reported by:
Environment:  local / staging / production (Render)    Version (git commit):
Affected users / roles / modules:
Impact (what users could not do, for how long):

Timeline:
  - hh:mm  first report
  - hh:mm  investigation started
  - hh:mm  cause identified
  - hh:mm  fix deployed / workaround applied

Evidence (exact messages, status codes, log lines - NO secrets, NO personal data):

Root cause:
Fix (commit / files changed):
Verification (tests run + manual check, with results):
Prevention (new test, monitoring, documentation):
Follow-up actions and owners:
```

[[NOTES 8]]

# Source references

`server/src/middleware/auth.js` · `server/src/middleware/security.js` · `server/src/middleware/coeGuard.js` · `server/src/middleware/rateLimit.js` · `server/src/middleware/error.js` · `server/src/config/env.js` · `server/src/config/db.js` · `server/src/config/socket.js` · `server/src/app.js` · `server/src/utils/sessionIdle.js` · `server/src/utils/storage.js` · `server/src/controllers/authController.js` · `server/src/controllers/gatePassController.js` · `server/src/services/transport/ingest.js` · `server/src/services/pushService.js` · `server/scripts/realtime-smoke.mjs` · `server/scripts/simulate-bus.mjs` · `client/src/services/api.js` · `client/src/services/socket.js` · `client/src/services/csrfCookie.js` · `client/src/components/layout/useIdleSession.js` · `mobile-kotlin/app/src/main/java/com/vexon/campus/core/Http.kt` · `mobile-kotlin/app/src/main/java/com/vexon/campus/core/Config.kt` · `mobile-kotlin/app/build.gradle.kts` · `mobile-kotlin/gradle.properties`
