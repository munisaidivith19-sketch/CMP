---
title: VEXON Developer Handbook - Master Reference
subtitle: Open this first. The short map of the whole system, the commands, the checklists, and where every detailed guide lives
number: 10
audience: Anyone who needs to understand, run, debug or maintain VEXON quickly
---

# How to use the handbook

| # | Guide (PDF in `docs/developer-handbook/`) | Open it when you need to... |
|---|---|---|
| 10 | `10_VEXON_Developer_Handbook.pdf` (this) | Find anything fast |
| 01 | `01_VEXON_Project_Overview.pdf` | Understand the architecture, security model and apps |
| 02 | `02_JavaScript_TypeScript_React_Guide.pdf` | Read or change the web dashboard |
| 03 | `03_Node_Express_Backend_Guide.pdf` | Read, debug or extend the API |
| 04 | `04_Database_MongoDB_PostgreSQL_Guide.pdf` | Work with data, backups, or plan PostgreSQL |
| 05 | `05_VEXON_Feature_By_Feature_Guide.pdf` | Debug one module (files, routes, models, tests) |
| 06 | `06_Debugging_and_Error_Recovery_Guide.pdf` | Something is broken |
| 07 | `07_Testing_Git_and_Safe_Code_Changes.pdf` | Change code safely, run tests, commit |
| 08 | `08_Deployment_and_Production_Maintenance.pdf` | Deploy, configure production, plan the VPS |
| 09 | `09_VEXON_30_Day_Learning_Workbook.pdf` | Learn the codebase step by step |
| 11 | `11_Error_Messages_Troubleshooting_Guide.pdf` | A user reports an error message: what it means and what to do (every server message is listed) |

Every PDF is generated from an editable Markdown file in `docs/developer-handbook/src/`. Rebuild them all with `python docs/developer-handbook/build_handbook.py`. Validate them with `python docs/developer-handbook/validate_handbook.py`. `INDEX.md` and `PROJECT_STATUS.md` sit next to the PDFs.

# Architecture summary

```layers
Web;;client/ React 18 + Vite + RTK Query | Android;;mobile-kotlin/ Kotlin + Compose | Android (legacy);;mobile/ Expo | iOS (unverified);;mobile-ios/ SwiftUI
-> REST /api + Socket.IO /socket.io (same contract for every client)
server/;;Node + Express 4 + Socket.IO 4; routes -> middleware -> controllers -> services -> models
-> Mongoose 8
MongoDB;;local (campusconnect) in dev, Atlas in production; PostgreSQL NOT used
```

- **The server is the only authority.** Roles (15, in `server/src/constants.js`), scope and validation are enforced there. Client guards are cosmetic.
- **Auth:** a 15-minute access JWT bound to a `Session` row, plus a rotating 7-day refresh token (an httpOnly cookie on web, the JSON body on mobile). CSRF double-submit for browsers. A 2-minute idle rule for non-exempt web roles.
- **Real-time:** sockets announce "something changed", and clients re-read over REST. Chat and bus positions are the exceptions.

# Folder navigation map

| I am looking for... | Go to |
|---|---|
| Server start-up and timers | `server/src/server.js` |
| Middleware order, CSP, CORS, static hosting | `server/src/app.js` |
| Environment variables and defaults | `server/src/config/env.js`, `server/.env.example` |
| Every API route and its validation | `server/src/routes/index.js`, `server/src/routes/alumniRoutes.js` |
| Who is allowed (role lists) | `server/src/constants.js` (server), `client/src/utils/constants.js` (UI mirror) |
| Sign-in, sessions, tokens | `server/src/controllers/authController.js`, `server/src/utils/tokens.js`, `server/src/middleware/auth.js` |
| CSRF and origin checks | `server/src/middleware/security.js` |
| Error responses | `server/src/middleware/error.js`, `server/src/utils/http.js` |
| Notifications and push | `server/src/utils/notify.js`, `server/src/services/pushService.js` |
| Socket rooms and events | `server/src/config/socket.js`, `client/src/services/socket.js`, `client/src/components/layout/AppLayout.jsx` |
| Data models | `server/src/models/` (59 files) |
| Web routes and guards | `client/src/App.jsx` |
| Web API calls (all of them) | `client/src/services/api.js` |
| A web page | `client/src/pages/<module>/` |
| Android networking and session | `mobile-kotlin/app/src/main/java/com/vexon/campus/core/Http.kt`, `SecureStore.kt` |
| Android screens and routes | `mobile-kotlin/app/src/main/java/com/vexon/campus/screens/` (`Routes.kt`) |
| Deployment | `render.yaml`, `.github/workflows/` |
| Tests | `server/tests/`, `client/tests/`, `mobile/tests/`, `mobile-kotlin/app/src/test/` |

# Common development commands

```bash
npm run install:all                      # install root + server + client
npm run dev                              # API :5000 + web :5173 (needs MongoDB running)
npm run seed                             # DEV ONLY - wipes and reloads campusconnect
npm run seed:academic                    # adds demo academic data without wiping
npm test --prefix server                 # server integration tests (uses cmp_test)
npm test --prefix client                 # client unit tests
npm run build                            # build client/dist
npm run verify:bundle                    # scan client/dist for secrets / source maps
npm start                                # production-style start (serves client/dist + API)
node server/scripts/realtime-smoke.mjs   # live web<->mobile chat check (server running)
node server/scripts/simulate-bus.mjs --device SIM-TEST-1 --route "<route>"   # synthetic GPS, dev only
npm run migrate:break-periods --prefix server            # dry run (add -- --apply to write)
cd mobile-kotlin && gradlew.bat assembleDebug            # Android debug APK
cd mobile-kotlin && gradlew.bat testDebugUnitTest        # Android unit tests
python docs/developer-handbook/build_handbook.py         # rebuild these PDFs
```

# Critical configuration locations

| Setting | Where it is set | Notes |
|---|---|---|
| Database choice | `DB_TARGET`, `MONGO_URI`, `MONGO_URI_ATLAS` in `server/.env` / the host | Local is the default |
| Secrets | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CHAT_ENCRYPTION_KEY` | Required in production; generated by Render |
| Public URL / origins | `CLIENT_URL`, `APP_URL` | Must match the real URL (CSRF/origin guard, Socket.IO) |
| Proxy hops | `TRUST_PROXY` | 1 on Render |
| SMS / OTP | `OTP_SMS_ENABLED`, `SMS_*` | SMS is ON in `render.yaml`, over plain HTTP by explicit opt-in |
| Map | `MAP_STYLE_URL`, `MAP_CSP_ORIGINS` | Default OpenFreeMap |
| Android backend URL | `mobile-kotlin/gradle.properties` `vexon.apiUrl` | Currently the deployed URL, for **both** debug and release |
| Dev proxy | `client/vite.config.js` (`VITE_API_PROXY`) | Defaults to `http://localhost:5000` |

# Important API and database entry points

| Need | API | Controller | Model(s) |
|---|---|---|---|
| Sign in / refresh | `POST /api/auth/login`, `/auth/refresh` | `authController.js` | `User`, `Session` |
| Current user | `GET /api/auth/me` | `authController.js` | `User` |
| Dashboard | `GET /api/dashboard` | `dashboardController.js` | many |
| Mark attendance | `POST /api/attendance/mark` | `attendanceController.js` | `AttendanceSession`, `AttendanceRecord` |
| Timetable | `GET /api/timetable` | `timetableController.js` | `TimetableSlot`, `Subject` |
| Gate pass | `POST /api/gate-pass`, `PATCH /api/gate-pass/:id/*-review` | `gatePassController.js` | `GatePass`, `OutpassOtp` |
| Complaint | `POST /api/complaints` | `complaintController.js` | `Complaint`, `ComplaintHistory` |
| Chat | `/api/chat/conversations/:id/messages` | `chatController.js` | `Conversation`, `Message` |
| Bus map | `GET /api/transport/buses`, socket `transport:subscribe` | `transportController.js` | `Bus`, `BusRoute`, `BusLocation` |
| SOS | `POST /api/sos` | `sosController.js` | `SOSAlert` |
| Health | `GET /api/health` | `app.js` | none |

# Troubleshooting decision tree

```flow
Problem reported -> copy the exact message; look it up in Guide 11 first; then reproduce it
-> Network tab: is there a request?
No request -> FRONTEND (console error, form validation, disabled button) -> Guide 02 / 06
-> request failed with no status
NETWORK / CONFIG: server down or asleep, wrong URL/port, CORS, offline -> Guide 06 / 08
-> 401 / 403 / 422 / 429
BACKEND RULES: read the message (session, CSRF, role, scope, validation, rate limit) -> Guide 03 / 06
-> 500
BACKEND BUG / DATABASE: read the [error] stack trace in the server logs -> Guide 03 / 04
-> 200 but wrong screen
FRONTEND STATE: compare response vs render; check cache tags -> Guide 02
-> wrong data in the response
QUERY / DATA: check the controller filter + inspect the dev DB -> Guide 04
```

# Testing checklist

- [ ] `npm test --prefix server`: all pass (MongoDB running).
- [ ] `npm test --prefix client`: all pass.
- [ ] `npm run build --prefix client` succeeds; `npm run verify:bundle` passes.
- [ ] Kotlin `testDebugUnitTest` passes (if Android changed).
- [ ] A new regression test exists for every bug fixed.
- [ ] Role checks re-tested for any route whose `authorize(...)` or scope changed.
- [ ] Manual smoke test of the affected workflow, as the affected roles.

# Git safety checklist

- [ ] `git status` before starting. Commit or stash the existing work first (more than 120 uncommitted changes existed at audit time).
- [ ] One branch per change (`git switch -c fix/...`).
- [ ] Read the whole `git diff` before staging; stage named files, not `git add .`.
- [ ] No `.env`, keys, dumps, generated personal-data PDFs or `local.properties` staged.
- [ ] Commit messages explain *why*.
- [ ] Never `git reset --hard` or `git push --force` without a backup or stash and a clear reason.

# Deployment and recovery checklist

- [ ] CI green on the exact commit.
- [ ] Production variables set (names in Guide 08); `CLIENT_URL` and `TRUST_PROXY` correct.
- [ ] Fresh database backup **and** a recently tested restore.
- [ ] Deploy, then check `/api/health`, sign-in, and one critical workflow per module touched.
- [ ] Watch the logs for `[error]` for the first hour.
- [ ] Rollback ready: the previous good commit id; how to redeploy it; data rollback only from backup.

# Known issues and unverified areas

| Item | Status | Detail |
|---|---|---|
| Server test suite | 718 of 721 passed (16 Oct 2026) | 2 date-dependent failures in `gate-exit-campus-day.test.js` (mixed clocks) and 1 intermittent file failure; details in Guide 07 |
| PostgreSQL | Planned, not implemented | Only MongoDB exists (Guide 04 has a migration plan) |
| TypeScript | Not used | All code is JavaScript or JSX |
| iOS app | Unable to verify | Never compiled (per its README); untracked in git; needs a Mac |
| Browser E2E tests | Missing | No Playwright or Cypress; UI flows are tested manually |
| Clubs, discussions | Untested | No direct API tests |
| Real SMS, real push, real GPS trackers | Not verified in the audit | Code paths exist; tests use test providers or synthetic data |
| `/api/health` | Limited | Does not check MongoDB |
| Error monitoring | Missing | No error-tracking service configured |
| Backups | Manual only | No backup automation in the repository |
| SMS over HTTP | Accepted risk | `SMS_ALLOW_INSECURE_HTTP=true` in `render.yaml` |
| Android release signing | Debug key | Not suitable for a store release |
| Kotlin debug build URL | Points to production by default | Override with `-Pvexon.apiUrl` for local work |
| README drift | Several mismatches | Lockout rule, idle exemptions, service name, Android client, uploads (Guide 01) |
| Large web chunk | Build warning | `BusMap` chunk is about 1.05 MB minified |
| Uncommitted work | Risk | More than 120 changed files and the untracked `mobile-ios/` at audit time |

# Glossary (short)

**API**: URLs a program calls. **Middleware**: a function run before a route handler. **Controller**: the route's main logic. **Model**: a Mongoose schema for one collection. **JWT**: a signed token. **Session**: a per-device sign-in record. **CSRF**: a cross-site forged request. **RBAC**: role-based access control. **Scope check**: "is this record yours / your department's?". **RTK Query**: the web app's data layer. **Cache tag**: a label that triggers a refetch. **Socket room**: a group of connections receiving the same events. **TTL index**: auto-deletes old documents. **CI**: automated checks on GitHub. **Seed**: demo data loader (it wipes the database).

[[NOTES 6]]

# Source references

`README.md` · `render.yaml` · `server/src/server.js` · `server/src/app.js` · `server/src/config/env.js` · `server/src/routes/index.js` · `server/src/constants.js` · `server/src/middleware/` · `server/src/models/` · `client/src/App.jsx` · `client/src/services/api.js` · `mobile-kotlin/gradle.properties` · `mobile-kotlin/README.md` · `mobile-ios/README.md` · `.github/workflows/ci.yml` · `docs/developer-handbook/src/` · `docs/developer-handbook/build_handbook.py`
