# VEXON for iOS (native Swift / SwiftUI)

A separate native iPhone client for the existing VEXON backend. It sits beside
the web app (`client/`), the Kotlin Android app (`mobile-kotlin/`) and the
Node/Express + MongoDB backend (`server/`). It changes none of them: it calls
the same `/api` endpoints and Socket.IO events the Android app uses, and every
permission is still enforced by the server.

> **Status: first phases. Not production-ready.** Nothing here has been
> compiled yet. It was written on Windows, where there is no Xcode or Swift
> toolchain. Building, simulator tests, signing and device testing must be done
> on the college Mac (see [Verification status](#verification-status)).

## Requirements

| | |
|---|---|
| Mac | macOS 14.5+ with **Xcode 16 or newer** (Swift 6 toolchain, Swift Testing) |
| Deployment target | **iOS 17.0** — needed for the Observation framework (`@Observable`), `ContentUnavailableView` and the current SwiftUI APIs used. That covers almost every iPhone still in use (iPhone XS / XR and newer). |
| Tools | [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) to generate the Xcode project |
| Swift packages (fetched by Xcode) | MapLibre Native iOS `maplibre-gl-native-distribution` ≥ 6.8.0 (BSD-2) · Socket.IO Swift client `socket.io-client-swift` ≥ 16.1.1 (MIT) |

## Open and run in Xcode (college Mac)

```bash
cd mobile-ios
cp Config/Local.xcconfig.example Config/Local.xcconfig   # then edit: team id, server
bash Scripts/generate-project.sh                          # runs `xcodegen generate`
open VEXON.xcodeproj
```

1. In Xcode, choose the **VEXON** scheme and an iPhone simulator, then press Run.
2. On first open, Xcode resolves the MapLibre and Socket.IO packages (needs internet).
3. For a real iPhone: set `VEXON_DEVELOPMENT_TEAM` in `Config/Local.xcconfig`
   (or pick a team under *Signing & Capabilities*). If `com.vexon.campus` is
   already taken in your team, change `VEXON_BUNDLE_ID` to something unique.
4. Start the backend (`cd server && npm run dev`). A Debug build in the
   simulator uses `http://localhost:5000`. On a physical phone, tap
   **Server** on the sign-in screen and enter the Mac's LAN address
   (e.g. `http://192.168.1.20:5000`), or a deployed `https://` URL.

## Configuration

All values are public build settings. **The app contains no secrets**: no
server credentials, signing keys or Firebase/APNs keys.

| Setting (xcconfig) | Debug example | Release | Meaning |
|---|---|---|---|
| `VEXON_API_BASE_URL` | `http:$(SLASH)$(SLASH)localhost:5000` | `https:$(SLASH)$(SLASH)vexon.example.edu` (**placeholder — replace**) | Server root, without `/api`. `$(SLASH)` is needed because xcconfig treats `//` as a comment. |
| `VEXON_ENVIRONMENT` | `development` | `production` | Shown in diagnostics |
| `VEXON_ALLOW_INSECURE_HTTP` | `YES` | `NO` | Release builds refuse `http://` servers |
| `VEXON_BUNDLE_ID` | `com.vexon.campus` | same | Bundle identifier |
| `VEXON_DEVELOPMENT_TEAM` | *(empty)* | your team | Apple developer team id |

Users can also save a server address on the device (sign-in → **Server**), just
like on Android. It is stored in the Keychain, and changing it signs the user out.

**Map style:** the app does not hard-code a map provider. It uses whatever
`GET /transport/config` returns, which comes from the server's `MAP_STYLE_URL`.
By default that is OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`,
no key needed, attribution shown on the map). To use a provider that needs a
key, put only its **public client** key in the server's `MAP_STYLE_URL`. The
downloaded `.osm.pbf` file is **not** used. It is raw OpenStreetMap data, not
a ready-to-render online map, and it contains no bus positions.

## Architecture

```
mobile-ios/
├── project.yml                 XcodeGen spec (source of truth for VEXON.xcodeproj)
├── Config/                     Base / Debug / Release xcconfig, Local.xcconfig.example
├── Packages/VEXONKit/          Platform-independent core (Foundation only)
│   ├── Sources/VEXONKit/
│   │   ├── Configuration/      ServerConfiguration (base URL, override, URL building)
│   │   ├── Networking/         APIClient (actor), Endpoint, API catalogue, transport, JSON
│   │   ├── Authentication/     SecureStore protocol, FeatureAccess (role → modules)
│   │   ├── Errors/             APIError + server error body mapping
│   │   ├── Logging/            Redactor (tokens, emails, phones), LogSink
│   │   ├── Models/             User/Role, Academics, Community (complaints, chat, notifications), Transport
│   │   └── BusTracking/        BusMath (shared with web/Android), TripFixBuffer
│   └── Tests/VEXONKitTests/    Swift Testing suites
├── VEXON/                      The iOS app (SwiftUI)
│   ├── App/                    VEXONApp, AppModel (session), RootView + tabs
│   ├── Core/                   Keychain, Socket.IO client, design system, location, push, os.Logger
│   ├── Features/               Auth, Dashboard, Attendance, Timetable (+ Exams), Complaints,
│   │                           Chat, Notifications, Profile, BusTracking
│   └── Resources/              Info.plist, PrivacyInfo.xcprivacy, Assets.xcassets
├── VEXONTests/                 App unit tests (bus model, sign-in form, chat merge)
├── VEXONUITests/               UI smoke tests (no server, no real accounts)
└── Scripts/                    generate-project.sh, test-kit.sh, test-app.sh
```

**Why a local Swift package?** Everything that does not need UIKit (networking,
session refresh, decoding, error mapping, bus maths, the faculty fix buffer)
lives in `VEXONKit`. It builds and tests with plain `swift test`, which keeps
the security-sensitive logic testable without a simulator.

Key decisions (each mirrors the Android app):

- **Session:** requests carry `x-client-platform: mobile`, so the server returns
  the refresh token in the response body and creates a mobile session (7-day
  idle rule, not the web's 2-minute rule). The access token is kept only in
  memory. The refresh token is kept only in the Keychain
  (`AfterFirstUnlockThisDeviceOnly`, not synced). On a 401 the client refreshes
  once, shared by all callers (the server rotates the token and revokes the
  session if an old token is replayed), then replays the request. A rejected
  refresh signs the user out with an explanation. If the server is unreachable
  at launch, the user gets a "Can't reach VEXON" screen, not a sign-out.
- **Retries:** GET requests are retried at most twice, with exponential
  backoff, after a network failure or a 502/503/504. Write requests are never
  retried automatically, so a slow "Submit" cannot be applied twice. Submit
  buttons are also disabled while a request is in flight.
- **Errors:** `APIError` covers notConfigured, network, timeout, cancelled,
  401, 403, 404, 409, 422 (with per-field messages), 423 (locked), 429, 5xx and
  decoding. Messages written by the server are shown as-is.
- **Logging:** only method, path, status and duration are logged, through
  `os.Logger` with `.private`. Query values, bodies, tokens, emails and phone
  numbers are redacted, and debug lines are compiled out of Release builds.
- **Role-based presentation:** `FeatureAccess` mirrors
  `server/src/constants.js` and `middleware/coeGuard.js`. This only decides
  what to show — the server is the authority. A 403 is shown with the server's
  message.
- **Real-time:** one Socket.IO connection (protocol v4, WebSocket) per signed-in
  session, authenticated with the access token in the handshake. An
  `unauthorized` connect error triggers a refresh and reconnect. Features join
  rooms (`chat:join`, `transport:subscribe`) only through server-checked acks,
  re-join after every reconnect, and leave when their screen closes. The app
  reconnects when it returns to the foreground.
- **Isolation between accounts:** signing in or out rebuilds the whole view
  tree, disconnects the socket, and stops any active trip sharing.

## Features in this phase

| Module | What works on iOS | Backend |
|---|---|---|
| Sign-in | Email/password, validation, lockout + remaining-attempts messages, revoked-session notice, offline launch, server address | `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` |
| Dashboard | Role-aware modules, today's current/next class, student overall attendance; each card fails independently | `/timetable/current`, `/attendance/my` |
| Attendance (students) | Semester dropdown (current semester by default; week / month / whole semester within it), subject-wise %, can-miss / must-attend, paged records, live refresh | `/attendance/my?semester=`, `/attendance/records?semester=`, socket `attendance:updated` |
| Study materials | Every readable material by default; semester, subject and category dropdowns; opens the file | `/study-materials`, `/study-materials/filters` |
| Timetable + exams | Week by day, current period, exam timetable | `/timetable`, `/exams`, sockets `timetable:updated`, `exam:updated` |
| Grievances (students) | Paged list, file new (server rules mirrored, duplicate-submit guard), cancel | `/complaints`, `/complaints/:id/cancel` |
| Chat | Conversations (search, unread, presence), thread with paging, send, live messages, mark read | `/chat/conversations…`, sockets `chat:*` |
| Notifications | In-app list (paged, live), mark read / all, category & reminder preferences, push permission, **mandatory permission gate** (below); new notifications and chat messages pop up as an in-app banner while the app is open | `/notifications…`, sockets `notification`, `chat:message` |
| Profile | Own account details (staff: role, employee ID, mobile number; HOD: department; faculty: assigned classes), sign-out | `/auth/me`, `/study-materials/my-assignments` |
| **Bus tracking** | See below | `/transport/*`, sockets `transport:subscribe`, `bus:location`, `bus:trip` |

### Bus tracking

- MapLibre Native map using the server-configured style, with attribution visible.
- **Bus-shaped markers only.** The icon is drawn from the same 40×40 top-down
  bus geometry as `BusIcon.kt` and the web `busMarker.js`. Its colour shows
  the state: live = red, stale = amber, offline = grey. The bus number and route
  name are shown **above** the icon, and the icon's centre is anchored on the
  bus's coordinate.
- Each bus has a single marker. When a new fix arrives, the marker glides to
  it with easing. Jumps over 2 km, or when Reduce Motion is on, snap instead.
  The icon rotates only when the heading is reliable (moving ≥ 2 m/s). When
  zoomed out, labels show only the bus number so nearby buses stay readable.
  The selected bus is drawn on top.
- Tapping a bus opens a detail panel with route, tracking state, last update
  (ticks live), speed, GPS accuracy, next stop, ETA and the stop list with
  passed stops. The selected stop (defaulting to the student's assigned stop)
  drives the ETA.
- The ETA comes **only from the server** (`computeEta`). When it is
  unavailable, the server's reason is shown. Low confidence is labelled
  "approximate", and the basis is listed (recent speed / timetable,
  approximate route distance, no live traffic data).
- Search covers bus numbers, route names and stop names. Controls: centre on
  bus, centre on me, fit me + bus, show all buses, refresh, and an "All buses"
  list.
- Honest states: loading, server error / 403, no buses, no positions yet,
  stale / offline per bus (re-evaluated every 5 s on the device), live updates
  paused, map style failed to load, location denied / restricted /
  approximate.
- **The student's location** is a separate blue dot. It is taken **once per
  tap** on "My location" (`requestLocation`) and is never sent to the server.
  Opening the map does not ask for permission or track anyone.
- **Staff trip sharing** (fallback when a bus has no tracker) is offered only
  when `/transport/config` returns `canShare`, for buses listed by
  `/transport/me`:
  - It starts with `POST /transport/trips`, which the server authorises.
  - It sends filtered batches of up to 20 fixes every 5 s, matching the
    server's accuracy, interval and age limits.
  - It keeps running with the screen locked, with iOS's blue indicator showing.
  - It stops on End trip, sign-out, session expiry or permission loss, or when
    the server answers `trip_not_active` / 403 / 404.
  - A trip already active for this user can be resumed after an app restart.

### Mandatory notification permission

Notifications are required once signed in. `RootView` shows
`NotificationRequiredView` instead of the tabs until `UNUserNotificationCenter`
reports full authorization (`NotificationGate` in VEXONKit decides; tested by
`NotificationGateTests`). Sign-in and the offline launch screen are never gated,
and the screen offers Sign out.

| Authorization | Result |
|---|---|
| `authorized`, `ephemeral` | App opens |
| `notDetermined` | Gate; **Enable Notifications** shows the iOS prompt (only on tap) |
| `provisional` | Gate — quiet delivery is not treated as full authorization; Enable asks for full authorization |
| `denied`, unknown | Gate; Enable and **Open Settings** open the app's notification settings (`openNotificationSettingsURLString`) |

The status is re-read at launch and every time the scene becomes active, so
allowing notifications in Settings continues automatically and revoking them
later shows the gate again. Allowing it registers with APNs as before; the token
is still not uploaded (see gap 1 below).

## Backend API dependencies and gaps

The app uses only endpoints that already exist (listed per module above). Gaps
found while inspecting the backend — **not simulated in the app**:

1. **Push notifications on iPhone — missing backend support.**
   `server/src/models/DeviceToken.js` allows only `provider: 'fcm'`,
   `platform: 'android'`. `services/fcm.js` sends **data-only** FCM messages,
   which iOS does not display, and there is no APNs sender. The app asks for
   permission from the mandatory notification screen, registers with APNs, and
   **does not upload its token** (`PushManager.backendSupportsAPNs = false`).
   In-app and live socket notifications work fully. To enable push, the server
   needs one of these:
   - an APNs provider (token-based `.p8` key, kept on the server) plus
     `platform: 'ios'` on `/devices`; or
   - FCM for iOS: the Firebase iOS SDK in the app, an APNs key uploaded to
     Firebase, and **notification** (not data-only) payloads for iOS tokens,
     with lock-screen-safe text.

   Then add the Push Notifications capability (`aps-environment`) and flip
   `backendSupportsAPNs`.
2. **Live GPS source.** The vehicle tracker integration is only an interface:
   the server's signed webhook `POST /api/transport/tracker/locations`
   (`TRACKER_WEBHOOK_SECRET`, HMAC-SHA256) has no real tracker connected. Until
   the college's tracker vendor is connected (server-side, see the root README
   / `server/.env.example`), live positions exist only when staff share a trip
   from a phone. **Live tracking is therefore not complete end-to-end.**
3. **Not yet on iOS** (they exist on web / Android): staff attendance marking
   and reports, gate pass, OD/leave, correction requests, transport
   administration, complaint authority actions and attachments, creating
   chats / groups, chat attachments, profile editing, password change, session
   management, deep links from notification `link`s.

## Testing

```bash
# Core package — no simulator needed (macOS with Xcode 16+, or Linux/Windows with Swift 6)
bash Scripts/test-kit.sh

# App unit + UI tests on a simulator (Mac only)
bash Scripts/test-app.sh "iPhone 16"
```

| Suite | Covers |
|---|---|
| `VEXONKitTests/APIClientTests` | Mobile headers; refresh token kept only in the secure store; refresh-and-replay; **single-flight refresh** under concurrent 401s; expired session clears the token and emits `.expired`; offline restore keeps the token; GET retry with bound; writes never retried; 403 without refresh; decoding failure; missing configuration; logout; server change signs out; query encoding (`&` in values) |
| `VEXONKitTests/DecodingTests` | Payloads copied from the controllers: session, unknown roles, attendance summary, timetable (populated and bare refs), buses (route as id or object, null location), unavailable ETA, `[lng, lat]` geometry, socket `bus:location`, notifications, chat, validation errors |
| `VEXONKitTests/LogicTests` | Bus maths (turns, reliable heading, freshness, labels, route split, bounds, ETA text, out-of-order fixes), trip fix buffer (accuracy, interval, batch cap, stale drop, bounded queue), role presentation (confined roles), server address rules, grievance and chat validation, log redaction |
| `VEXONTests` | Bus model: snapshot, live fixes (newer / older / invalid / unknown bus), stale → offline without reload, detail + unavailable ETA + assigned stop, revoked bus (404), 403 message, many buses × many updates; sign-in form (validation, lockout, attempts); chat merge de-duplication |
| `VEXONUITests` | Launch to sign-in, offline validation, server address rejection |

All test data is synthetic (ids like `bus1`, `TEST-01`, `example.test`
domains, made-up coordinates).

## Verification status

| Step | Status |
|---|---|
| Source written; contracts checked against `server/src` and `mobile-kotlin` | Done |
| `swift build` / `swift test` of VEXONKit | **Passed on Windows** (Swift 6.4.1, 2026-10-16): builds clean; **47 tests in 6 suites passed**. Needs the MSVC environment (`vcvars64.bat`) and `SDKROOT` set — see below. Not yet run on macOS. |
| `xcodegen generate`, Xcode build, simulator run | **Not run** — needs the Mac |
| App unit tests / UI tests | **Not run** — needs the Mac |
| Real-device test (location, background trip sharing, socket reconnect) | **Not run** |
| Signing, provisioning, App Store validation | **Not run** |

Expect some compile fixes on the first Xcode build, especially in the MapLibre
and Socket.IO delegate signatures and in Swift 6 concurrency diagnostics.
(The app target uses UIKit, SwiftUI, MapLibre and Core Location, so it cannot
be built on Windows. Only VEXONKit can.)

**Running the VEXONKit tests on Windows** (Swift toolchain from
`winget install Swift.Toolchain`, plus Visual Studio Build Tools with the C++
workload), from any PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File mobile-ios\Scripts\test-kit.ps1
```

The script finds the toolchain, loads the Visual Studio C++ environment (for
`link.exe`), sets `SDKROOT` and runs `swift test`. A plain `swift test` only
works in a terminal opened after the install, inside a *x64 Native Tools*
prompt, with `SDKROOT` set.

The toolchain prints many `wchar_t ... broken by a context change` warnings
from its own Windows SDK module maps. They are harmless and do not come from
this code.

## Privacy and approvals the institution must confirm

- **Background location (staff only).** `UIBackgroundModes: location` exists
  only so a staff-started bus trip keeps reporting while the phone is locked.
  It is never used for students. App Review will ask for this justification,
  and the college should approve the policy (who may share, retention of
  `BusLocation` history on the server).
- **Student location** is one-shot, on demand, and kept on the device.
- `PrivacyInfo.xcprivacy` declares precise location (staff trips), email and
  user content (chat / grievances) for app functionality, with no tracking.
  Review it before submission.
- Bus data shown is transport-only. No passenger lists or phone numbers are
  requested or displayed.

## Next phase

1. On the Mac: generate, build, fix compile issues, run all three test suites,
   and record the results.
2. Device test of bus tracking with the server's labelled synthetic simulator
   (`server/scripts/simulate-bus.mjs`) and with real staff trip sharing.
3. Backend: iOS push support (see gap 1), then enable push in the app.
4. Port the remaining staff workflows (attendance marking, gate pass, OD/leave)
   and notification deep links.
5. App icon (1024×1024, no transparency — the slot is empty), launch branding,
   localisation, and an accessibility pass with VoiceOver and the largest
   Dynamic Type sizes.
