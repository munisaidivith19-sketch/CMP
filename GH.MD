PROJECT: Vexon (branded "CampusConnect" in some UI text) — a college community platform.
Repo: https://github.com/munisaidivith19-sketch/CMP (pushed, main branch)
Local path: D:\POJECTS\AI ATDDENCE\CMP
Stack: MERN (MongoDB "cmp" db, Express, React+Vite, Node) + a React Native/Expo Android app in mobile/

=== WHAT EXISTED BEFORE THIS WORK ===
Basic MERN portal: login/register, profiles, announcements, clubs, events, discussions,
notifications, search, moderation, admin analytics. Backend already had partial chat,
attendance, timetable, gate-pass and lost-found code, but no web UI for any of them.

=== WHAT WAS BUILT (backend + web) ===
- Chat: private/group chats, live delivery, typing, online/last-seen, read receipts,
  unread counts, reply, delete, search — via Socket.io + REST.
- Attendance: student view (overall = present÷conducted, subject trends, history,
  correction requests, low-attendance warning); faculty console (roster from timetable,
  mark/edit within 7 days, history, low-attendance list, correction review).
- Smart timetable: today/next class, week grid; new admin "Academics" page with
  section/faculty/room clash checking.
- Digital gate pass: request/cancel/approve/reject, owner-only QR (opaque random code,
  no personal data in it), verify → exit → return (single-use), auto-expiry, revoke.
- Lost & found: report with photo, filters, "possible match" suggestions (never an
  ownership claim — staff must confirm), owner close/withdraw.
- Advanced analytics: student/faculty/department/college/club/gate views, with
  day/week/month/semester/custom ranges, real MongoDB aggregations (no fake data).
- Account security: forgot/reset password (single-use, 15-min expiry, rate-limited,
  no account enumeration), change password, per-device session list, sign out one/all
  other devices, login history, new-device alerts.
- Backend hardening: new Session model (per-device sessions, refresh-token rotation,
  theft detection), Socket.io rooms authorized server-side, 43 passing integration
  tests (node:test), a background job expiring stale gate passes.

=== ANDROID APP (mobile/, Expo SDK 57 + expo-router) ===
30 screens: login, forgot password, home, chat (list + thread + new), timetable,
attendance, gate pass (list + request + detail, with QR), lost & found (list + detail
+ report w/ photo upload), events, clubs, announcements, discussions, search,
notifications, profile, account security. Uses the SAME backend/database/Socket.io
server as the web app — refresh token stored in encrypted SecureStore, sent via
X-Client-Platform: mobile header. Push notifications share the backend's one
notification pipeline (no duplicated logic). Staff-only actions (marking attendance,
reviewing gate passes) redirect to "do this on web" screens.

=== GIT ===
CMP was untracked by its parent repo, so it was init'd as its own git repo and pushed
to github.com/munisaidivith19-sketch/CMP (merged with a pre-existing placeholder
commit). No secrets committed — .env files and node_modules correctly gitignored.

=== THIS SESSION: getting the Android app actually running ===
Starting point: Android Studio had just been installed, but no SDK env vars, no AVD,
no working local build.
1. Set ANDROID_HOME/ANDROID_SDK_ROOT + PATH persistently (User env vars, not setx).
2. Installed Android cmdline-tools, accepted SDK licenses (via known license hash
   files — the interactive prompt flow wasn't reliably scriptable).
3. Installed an Android 34 system image + platform; created an AVD named "Vexon".
4. Booted the emulator (WHPX/GPU accel confirmed working).
5. Ran `npx expo run:android` — FIRST ATTEMPT FAILED: Android Studio's bundled JDK
   (25, bleeding-edge) broke the CMake/NDK native-module compile step
   (react-native-screens, react-native-worklets) due to its stricter native-access
   restrictions.
6. Fix: downloaded and installed Eclipse Temurin JDK 17 (the standard, well-supported
   version for RN/Gradle builds) to C:\Java, set JAVA_HOME to it persistently.
7. Re-ran the build — SUCCEEDED (6m17s). APK installed and launched on the emulator.
   Verified via `adb logcat`: app is the foreground activity, JS bundle loaded via
   Metro, "Running main" with no crash/red-box.

=== CURRENT STATE ===
- Backend (:5000) and MongoDB were already running throughout.
- Android emulator "Vexon" is up, app installed and running on it, connected live to
  the backend.
- mobile/.env has EXPO_PUBLIC_API_URL set to the dev machine's LAN IP.
- Environment is now correctly configured for future local Android builds (JDK 17 +
  Android SDK all set up permanently).

=== STILL OPEN ===
- Nobody has visually looked at the web UI or interacted with the Android app's
  screens yet — only build/lint/backend-test verification has happened.
- SMTP not configured, so password-reset emails aren't actually sent yet.
- No EAS project ID / Firebase credentials yet, so cloud APK builds and push
  notifications on a real device aren't set up.
- Faculty role currently covers "own subjects + own department" for attendance;
  no separate HOD/mentor role exists.
