# Campus SOS / Emergency Module — Complete Build Specification (A to Z)

> Extracted **as-is** from Vexon / CampusConnect (MERN + Redux Toolkit/RTK Query + Socket.io + Expo mobile).
> Purpose: rebuild this exact module inside another project of the same stack.
> **Scope rule: no new features.** This file documents what exists today, nothing more. Where the source has defects, §14 lists the minimal corrections; apply only those marked **REQUIRED**.

---

## 0. Instructions to the implementing agent

1. **Add the module; do not modify anything else.** The only edits allowed in existing host files are the one-line *registration points* in §3.3. Do not refactor, restyle or change any other feature, route, model, screen or test.
2. Build exactly what is described: one model, one controller (4 handlers), 4 routes, 2 socket events, 1 notification type, 3 web components + 1 page, 1 mobile screen. Do not add rate limits, geofencing, escalation, SMS/call integration, audit exports, dashboards, history screens, or any other behaviour that is not listed here.
3. Reuse host infrastructure (auth, notifications, sockets, push, activity log). Do not re-implement it.
4. Generate complete files. Keep every user-visible string exactly as written in this spec.
5. Run the host's full existing test suite before and after; it must stay green.

---

## 1. What the module does (complete feature list)

| # | Feature | Where |
|---|---|---|
| 1 | Any signed-in user can raise an emergency alert: choose a **type** (medical, security, fire, ragging, other), optional **note** (≤300 chars), optional **GPS location** (web only) | Web modal + mobile sheet |
| 2 | On creation the alert is stored as `active`; **every active user of every role (except the sender)** receives a persisted notification + Expo push; **every connected client of every role** receives a real-time `sos:new` socket event | Server |
| 3 | Web shows a high-visibility broadcast: **fire** = full-screen red evacuation overlay; other types = 9-second toast banner | Web only |
| 4 | **Responders** (security, admin, hod, principal, chairman) get a live feed page with filters (status, type), 10-second polling, pagination, and can **Acknowledge** and **Resolve** (outcome `resolved` or `false_alarm` + mandatory resolution note) | Web page + mobile screen |
| 5 | The sender is notified when their alert is acknowledged and when it is resolved/closed as a false alarm | Server |
| 6 | Entry points: sidebar "Emergency SOS" button + topbar red icon button (web, visible to all roles), sidebar nav link to the feed (hidden for student/club_admin), Campus-tab card and home quick action (mobile) | UI |
| 7 | Every create/ack/resolve is written to the host's activity log | Server |

Out of scope (do **not** build): alert history for non-responders via API, rate limiting, map embeds beyond a Google Maps link, mobile GPS capture, mobile broadcast popup, department scoping for HODs, reopening alerts.

---

## 2. Roles & permissions (as shipped)

Role constants (from the host `ROLES`): `student, club_admin, faculty, hod, principal, admin, security, alumni, dean, ao, chairman, warden`.

| Capability | Everyone signed in | Responders only |
|---|---|---|
| `POST /sos` — trigger alert | ✔ (any role) | ✔ |
| `GET /sos` — list/feed | ✗ (403) | ✔ |
| `PATCH /sos/:id/ack` | ✗ | ✔ |
| `PATCH /sos/:id/resolve` | ✗ | ✔ |
| Receive `sos:new` socket event + notification/push | ✔ (all roles, except the sender) | ✔ |
| Receive `sos:updated` socket event | ✗ | ✔ |

- `SOS_RESPONDER_ROLES = ['security','admin','hod','principal','chairman']`
- `SOS_BROADCAST_ROLES = ROLES` (all roles)
- HODs are **not** department-scoped in this module (they see all alerts). Keep it that way.

---

## 3. Integration contract with the host project

### 3.1 Host must already provide (names from the source project)
| Need | Source implementation |
|---|---|
| `User` model with `name, role, department, section, avatar, rollNo, phone, isActive, pushTokens` | `models/User.js` |
| Auth middleware | `protect` (sets `req.user`) and `authorize(...roles)` (403 "You do not have permission to perform this action") in `middleware/auth.js`; router-wide `router.use(protect)` |
| Validation | `express-validator` `body/query`, `validate`, `idParam('id')` in `middleware/validate.js` |
| HTTP utils | `ApiError(status,msg)`, `asyncHandler`, `paginate(req, defaultLimit)`, `pageMeta(total,page,limit)` → `{total,page,limit,pages}`, `pick(obj,keys)` in `utils/http.js` |
| Notifications | `notifyUsers(ids,{type,title,message,link},{exclude,push})`, `notifyRoles(roles,payload,opts)` in `utils/notify.js` — persists `Notification` rows, emits `notification` over the user's socket room, sends Expo push |
| Realtime | `emitToRoles(roles, event, payload)` in `config/socket.js`; sockets auto-join rooms `user:<id>`, `role:<role>` on connect (token-authenticated) |
| Push | `services/pushService.js` (Expo) used by `notifyUsers` |
| Activity log | `logActivity(req, action, {entityType, entityId, summary})` |
| Web | React 18, Redux Toolkit/RTK Query (`createApi` with tag types), `react-hot-toast`, `lucide-react`, UI primitives (`Modal`, `Button`, `Card`, `Badge`, `Avatar`, `PageHeader`, `Pagination`, `Skeleton`, `EmptyState`, `ErrorState`, `Select`, `Textarea`, `StatusBadge`), `useSocketEvent(event, handler)` hook |
| Mobile | Expo Router, RTK Query, `components/ui.js` (`Screen, Header, Card, Button, Input, Segmented, SectionTitle, StatusBadge, EmptyState, ErrorState, Loading, Avatar, T`), `theme.js` (`radius`, colors), `lucide-react-native` |

### 3.2 No new environment variables, dependencies or scheduled jobs are needed.

### 3.3 The ONLY existing files you may touch (one-line registrations)
| File | Edit |
|---|---|
| `server/src/constants.js` | Add the SOS constants (§4) **and append `'sos'` to `NOTIFICATION_TYPES`** (REQUIRED — see §14 #1) |
| `server/src/routes/index.js` | Import `* as sos`, import the three SOS constants, add the 4 routes (§6) |
| `client/src/utils/constants.js`, `mobile/src/theme.js` | Mirror `SOS_TYPES`, `SOS_STATUSES`, `SOS_RESPONDER_ROLES` |
| `client/src/services/api.js`, `mobile/src/services/api.js` | Add tag type `SOSAlert`, 4 endpoints, 4 exported hooks |
| `client/src/App.jsx` | Lazy route `sos` → `SOSAlerts` |
| `client/src/components/layout/AppLayout.jsx` | Socket map entries, `n.type==='sos'` tag, mount `<SOSBroadcastPopup />` |
| `client/src/components/layout/Sidebar.jsx` / `Topbar.jsx` | Nav item, SOS button, `<SOSModal>` |
| `client/src/components/layout/NotificationBell.jsx` | Icon mapping for type `sos` |
| `mobile/src/app/_layout.js` | Socket map entries |
| `mobile/src/app/(app)/(tabs)/campus.js` and home `(tabs)/index.js` | Card + quick action |
| Test suite | add the SOS test (§13) |

---

## 4. Constants (server `constants.js`; mirror in client `utils/constants.js` and mobile `theme.js`)
```js
export const SOS_TYPES = ['medical', 'security', 'fire', 'ragging', 'other'];
export const SOS_STATUSES = ['active', 'acknowledged', 'resolved', 'false_alarm'];
// Everyone whose device should get the real-time alert feed + push.
export const SOS_RESPONDER_ROLES = ['security', 'admin', 'hod', 'principal', 'chairman'];
// Everyone whose device gets the real-time emergency broadcast popup.
export const SOS_BROADCAST_ROLES = ROLES;

export const NOTIFICATION_TYPES = [ /* existing values… */, 'sos' ];   // REQUIRED addition
```
Client/mobile mirror only `SOS_TYPES`, `SOS_STATUSES` (web), `SOS_RESPONDER_ROLES`.

---

## 5. Data model — `server/src/models/SOSAlert.js`
```js
import mongoose from 'mongoose';
import { SOS_TYPES, SOS_STATUSES } from '../constants.js';
const { Schema } = mongoose;

const sosAlertSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    department: { type: String, trim: true, maxlength: 80 },          // copied from sender at creation
    section: { type: String, trim: true, uppercase: true, maxlength: 10 },

    type: { type: String, enum: SOS_TYPES, required: true },
    note: { type: String, trim: true, maxlength: 300 },

    location: { lat: Number, lng: Number, accuracy: Number },

    status: { type: String, enum: SOS_STATUSES, default: 'active', index: true },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: Date,
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resolutionNote: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);
sosAlertSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.SOSAlert || mongoose.model('SOSAlert', sosAlertSchema);
```
Add `SOSAlert` to the host seed's wipe list **only if** the host seed enumerates models. The source seed creates no SOS data.

---

## 6. API contract (base `/api`, all behind `protect`)

### 6.1 Routes (add to `routes/index.js`)
```js
// ── Campus SOS ──────────────────────────────────────────────────────
router.post(
  '/sos',
  body('type').isIn(SOS_TYPES).withMessage('Valid SOS type is required'),
  body('note').optional().trim().isLength({ max: 300 }),
  body('location.lat').optional().isNumeric(),
  body('location.lng').optional().isNumeric(),
  body('location.accuracy').optional().isNumeric(),
  validate,
  sos.createAlert
);
router.get('/sos', authorize(...SOS_RESPONDER_ROLES), query('status').optional().isIn(SOS_STATUSES), validate, sos.listAlerts);
router.patch('/sos/:id/ack', idParam('id'), authorize(...SOS_RESPONDER_ROLES), sos.acknowledgeAlert);
router.patch(
  '/sos/:id/resolve',
  idParam('id'),
  authorize(...SOS_RESPONDER_ROLES),
  body('status').optional().isIn(['resolved', 'false_alarm']),
  body('resolutionNote').optional().trim().isLength({ max: 300 }),
  validate,
  sos.resolveAlert
);
```

### 6.2 Endpoint behaviour
| Endpoint | Request | Success response | Errors |
|---|---|---|---|
| `POST /sos` | `{ type, note?, location?: {lat,lng,accuracy} }` — body whitelisted with `pick(['type','note','location'])` | `201` the alert, populated `user` = `name avatar department section rollNo phone`, `status:'active'` | `400` validation |
| `GET /sos?status=&type=&page=&limit=` | `limit` default 15, max 50 (`paginate(req,15)`) | `{ items:[alert…], total, page, limit, pages }`; each item populates `user`, `acknowledgedBy` (`name role`), `resolvedBy` (`name role`) | `403` for non-responders |
| `PATCH /sos/:id/ack` | — | `200` populated alert, `status:'acknowledged'` (only if it was `active`) | `404 Alert not found` |
| `PATCH /sos/:id/resolve` | `{ resolutionNote (required, non-empty), status?: 'resolved' \| 'false_alarm' }` | `200` populated alert | `400 Resolution note is required`, `404 Alert not found` |

### 6.3 Controller — `server/src/controllers/sosController.js` (reference implementation)
```js
import SOSAlert from '../models/SOSAlert.js';
import { SOS_BROADCAST_ROLES, SOS_RESPONDER_ROLES } from '../constants.js';
import { ApiError, asyncHandler, pageMeta, paginate, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyRoles, notifyUsers } from '../utils/notify.js';
import { emitToRoles } from '../config/socket.js';

const USER_FIELDS = 'name avatar department section rollNo phone';

export const createAlert = asyncHandler(async (req, res) => {
  const data = pick(req.body, ['type', 'note', 'location']);
  data.user = req.user._id;
  data.department = req.user.department;
  data.section = req.user.section;
  data.status = 'active';

  const alert = await SOSAlert.create(data);
  logActivity(req, 'sos.create', { entityType: 'sos', entityId: alert._id, summary: data.type });

  const populated = await SOSAlert.findById(alert._id).populate('user', USER_FIELDS).lean();

  // Persisted notification + push to every campus role (sender excluded)
  notifyRoles(
    SOS_BROADCAST_ROLES,
    {
      type: 'sos',
      title: alert.type === 'fire' ? '🚨 FIRE EMERGENCY ALERT' : `Campus SOS: ${alert.type.toUpperCase()}`,
      message: `${req.user.name} (${alert.department || 'Campus'}${alert.section ? ' - ' + alert.section : ''}) triggered an emergency alert${alert.note ? ': "' + alert.note + '"' : ''}`,
      link: '/sos',
    },
    { exclude: req.user._id }
  );

  // Real-time broadcast to every connected client of every role
  emitToRoles(SOS_BROADCAST_ROLES, 'sos:new', {
    ...populated,
    alertId: populated._id,
    triggeredBy: { name: req.user.name, role: req.user.role, department: req.user.department },
  });

  res.status(201).json(populated);
});

export const listAlerts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 15);
  const filter = {};
  const { status, type } = req.query;

  // (Non-responders are already blocked by the route's authorize(); this branch is a safety net.)
  if (!SOS_RESPONDER_ROLES.includes(req.user.role)) filter.user = req.user._id;
  if (status) filter.status = status;
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    SOSAlert.find(filter)
      .populate('user', USER_FIELDS)
      .populate('acknowledgedBy', 'name role')
      .populate('resolvedBy', 'name role')
      .sort({ status: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SOSAlert.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

export const acknowledgeAlert = asyncHandler(async (req, res) => {
  const alert = await SOSAlert.findById(req.params.id);
  if (!alert) throw new ApiError(404, 'Alert not found');

  alert.acknowledgedBy = req.user._id;
  alert.acknowledgedAt = new Date();
  if (alert.status === 'active') alert.status = 'acknowledged';
  await alert.save();
  logActivity(req, 'sos.ack', { entityType: 'sos', entityId: alert._id });

  const populated = await SOSAlert.findById(alert._id)
    .populate('user', USER_FIELDS).populate('acknowledgedBy', 'name role').populate('resolvedBy', 'name role').lean();

  emitToRoles(SOS_RESPONDER_ROLES, 'sos:updated', populated);
  notifyUsers([alert.user], {
    type: 'sos',
    title: 'SOS alert acknowledged',
    message: 'Responders have acknowledged your emergency alert.',
    link: '/sos',
  });
  res.json(populated);
});

export const resolveAlert = asyncHandler(async (req, res) => {
  const alert = await SOSAlert.findById(req.params.id);
  if (!alert) throw new ApiError(404, 'Alert not found');

  const { resolutionNote, status } = req.body;
  if (!resolutionNote || !resolutionNote.trim()) throw new ApiError(400, 'Resolution note is required');

  alert.resolvedBy = req.user._id;
  alert.resolvedAt = new Date();
  alert.resolutionNote = resolutionNote.trim();
  alert.status = status === 'false_alarm' ? 'false_alarm' : 'resolved';
  await alert.save();
  logActivity(req, 'sos.resolve', { entityType: 'sos', entityId: alert._id, summary: alert.resolutionNote });

  const populated = await SOSAlert.findById(alert._id)
    .populate('user', USER_FIELDS).populate('acknowledgedBy', 'name role').populate('resolvedBy', 'name role').lean();

  emitToRoles(SOS_RESPONDER_ROLES, 'sos:updated', populated);
  notifyUsers([alert.user], {
    type: 'sos',
    title: `SOS alert ${alert.status === 'false_alarm' ? 'closed as false alarm' : 'resolved'}`,
    message: alert.resolutionNote,
    link: '/sos',
  });
  res.json(populated);
});
```

---

## 7. Flow & business rules (exact)

```
User triggers  ─▶ SOSAlert{status:'active', department/section copied from sender}
                 ├─ Notification rows + Expo push to all active users (all roles) except sender  [type 'sos', link '/sos']
                 └─ socket 'sos:new' to rooms role:<every role>
Responder Ack  ─▶ status 'acknowledged' (if it was 'active'); acknowledgedBy/At set
                 ├─ socket 'sos:updated' to responder roles
                 └─ notify sender: "SOS alert acknowledged"
Responder Resolve ▶ resolutionNote required; status 'resolved' | 'false_alarm'; resolvedBy/At set
                 ├─ socket 'sos:updated' to responder roles
                 └─ notify sender: "SOS alert resolved" | "SOS alert closed as false alarm" (message = resolution note)
```
Status values: `active → acknowledged → resolved | false_alarm` (the API also allows resolving directly from `active`).

Notification texts:
- Create (to everyone): title `🚨 FIRE EMERGENCY ALERT` for `fire`, else `Campus SOS: <TYPE UPPERCASE>`; message `<name> (<department or "Campus"><" - "+section if any>) triggered an emergency alert<": "note"" if any>`; link `/sos`.
- Ack (to sender): `SOS alert acknowledged` / `Responders have acknowledged your emergency alert.`
- Resolve (to sender): `SOS alert resolved` or `SOS alert closed as false alarm` / the resolution note.

Socket payloads:
- `sos:new` = populated alert + `alertId` + `triggeredBy:{name, role, department}`.
- `sos:updated` = populated alert (user, acknowledgedBy, resolvedBy).

Activity log actions: `sos.create`, `sos.ack`, `sos.resolve`.

---

## 8. Web client

### 8.1 API (`client/src/services/api.js`)
Add tag type `'SOSAlert'` and:
```js
// ── Campus SOS ──
getSOSAlerts:  b.query({ query: (params) => ({ url: '/sos', params }), providesTags: ['SOSAlert'] }),
createSOSAlert: b.mutation({ query: (body) => ({ url: '/sos', method: 'POST', body }), invalidatesTags: ['SOSAlert'] }),
ackSOSAlert:   b.mutation({ query: (id) => ({ url: `/sos/${id}/ack`, method: 'PATCH' }), invalidatesTags: ['SOSAlert'] }),
resolveSOSAlert: b.mutation({ query: ({ id, ...body }) => ({ url: `/sos/${id}/resolve`, method: 'PATCH', body }), invalidatesTags: ['SOSAlert'] }),
```
Export hooks: `useGetSOSAlertsQuery, useCreateSOSAlertMutation, useAckSOSAlertMutation, useResolveSOSAlertMutation`.

### 8.2 Wiring (`AppLayout.jsx`)
- Socket → tag map: `'sos:new': ['SOSAlert']`, `'sos:updated': ['SOSAlert']`.
- In the `notification` handler: `if (n.type === 'sos') tags.push('SOSAlert');`
- Render `<SOSBroadcastPopup />` once inside the layout.
- `NotificationBell.jsx` type map: `sos: { icon: AlertOctagon, cls: 'from-rose-500 to-red-600' }`.

### 8.3 Entry points
- **Topbar:** red icon button (`AlertOctagon`), `aria-label="Campus SOS emergency alert"`, `title="Campus SOS Alert"`, classes `btn-icon shrink-0 border border-rose-400/40 bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white dark:…`; opens `SOSModal`. Visible to every role.
- **Sidebar:** full-width button "Emergency SOS" above the profile block (same rose styling), opens `SOSModal`; **plus** nav item `{ to:'/sos', label:'Emergency SOS', icon: AlertOctagon, excludeRoles:['student','club_admin'] }` in the "Campus" group.
- **Route:** `<Route path="sos" element={<SOSAlerts />} />` (lazy), inside the authenticated layout.

### 8.4 `SOSModal.jsx` (trigger form)
- Props `{ open, onClose, onSubmitted }`. Uses `Modal size="md"`, title **"Campus SOS Emergency Alert"**, subtitle *"This instantly alerts Campus Security, HODs, and the Principal. Use for genuine emergencies only."*
- State: `type` (default `'medical'`), `note`, `location`.
- On open, if `navigator.geolocation` exists: `getCurrentPosition` with `{enableHighAccuracy:true, timeout:5000, maximumAge:10000}` → `location = {lat, lng, accuracy: Math.round(accuracy)}`; on error `location = null` (alert still sends).
- Type cards (2-column grid), icon + label + description:
  - medical — **Medical emergency** — "Injury, sudden illness, unconsciousness" (HeartPulse)
  - security — **Security threat** — "Intruders, violence, theft, physical danger" (ShieldAlert)
  - fire — **Fire hazard** — "Smoke, active fire, electrical spark" (Flame)
  - ragging — **Ragging / harassment** — "Hostel or campus harassment or intimidation" (Users)
  - other — **Other immediate help** — "Urgent situation requiring rapid response" (HelpCircle)
  Selected card: rose border/background; icon chip turns solid rose.
- `Textarea` label "Location or details (optional)", placeholder "e.g. 2nd floor library hallway, near lab 204", rows 3, maxLength 300.
- If location captured: green line "● GPS Location captured (approx. ±{accuracy}m)".
- Footer: ghost **Cancel**; red-gradient **Confirm & Send SOS** (icon `AlertOctagon`, loading while submitting).
- Submit: `createSOS({type, note: note.trim()||undefined, location: location||undefined})` → toast success **"Emergency alert sent to campus responders!"**, reset (`note=''`, `type='medical'`), close, call `onSubmitted(res)`; error → `toast.error(errMsg(e))`.

### 8.5 `SOSBroadcastPopup.jsx` (real-time broadcast)
- `useSocketEvent('sos:new', alert => …)`; `isResponder = SOS_RESPONDER_ROLES.includes(user.role)`.
- **fire** → full-screen overlay (`role="alertdialog"`, `aria-modal`), red gradient, border-4 red, title "FIRE EMERGENCY", badge "Urgent Evacuation Notice", rows: "Location / Department" (`department` or "Campus Area", plus ` · Sec <section>`), optional "Details", "Reported by: `triggeredBy.name` || `user.name` || 'Campus Member'", amber notice **"⚠️ Follow evacuation procedure immediately. Stay calm, leave belongings, and proceed to the nearest emergency assembly area."**; buttons: **I understand / Dismiss**; responders also get **Responder Console →** (`/sos`).
- **other types** → `toast.custom`, 9000 ms, id `sos-<alertId>`, width 380px, per-type config:
  - fire (unused here), medical → "Medical Emergency" (amber), security → "Security Alert" (orange), ragging → "Anti-Ragging Alert" (rose), other → "Campus Emergency" (primary).
  - Body: pulsing icon, uppercase title, `Alert in <department>` (or "Campus Emergency Alert") + ` · Sec <section>`, optional italic note (2-line clamp), "By <name>", and for responders a **View & respond →** link to `/sos`; dismiss (X) button.

### 8.6 `SOSAlerts.jsx` (page `/sos`)
- Header `PageHeader` icon AlertOctagon, title **"Campus SOS & Emergency"**, subtitle: responders — "Live emergency responder feed for campus security and leadership."; others — "Rapid emergency alert system connected to campus security and staff."; action button **Trigger SOS** (red gradient) opening `SOSModal`.
- Non-responders: hero card "Need Immediate Assistance?" with explanatory text and **Trigger Campus SOS** button.
- Responders: filter card with two `<select>`s — "All statuses" (`SOS_STATUSES`, underscores → spaces) and "All emergency types" (`SOS_TYPES`); changing resets `page=1`.
- Query: `useGetSOSAlertsQuery({page, status, type}, { pollingInterval: isResponder ? 10000 : undefined })`.
- Feed heading: "Live Emergency Dispatch" (responder) / "Your Past Emergency Alerts".
- States: `Skeleton` x2 while first load; `ErrorState` with retry; `EmptyState` — responder: "No active emergency alerts / All quiet on campus. Live alerts will appear here automatically."; other: "No alerts submitted / You have not triggered any SOS alerts."
- `ResponderAlertCard` per alert: type icon (pulsing solid rose when `active`), "`<TYPE> Alert`", `StatusBadge`, time-ago, sender avatar + name + department/section, phone ("Contact: …"), note box, coordinates `lat.toFixed(5), lng.toFixed(5) (±accuracy m)` with **View on Map ↗** (`https://www.google.com/maps?q=<lat>,<lng>`), green resolution box "Resolution (<resolvedBy.name or 'Staff'>): …". Active cards get rose border/tint.
  - Buttons: **Acknowledge** (only when `active`; toast "Acknowledged alert") and **Resolve** (when `active` or `acknowledged`).
- `ResolveAlertModal`: title "Resolve SOS Emergency Alert", subtitle "Alert for <name> (<type>)", `Select` "Resolution outcome" (`resolved` = "Incident handled & resolved", `false_alarm` = "Mark as false alarm"), `Textarea` "Resolution notes / actions taken" (placeholder "Describe how the situation was attended to and resolved", maxLength 500, required — toast "Please enter a resolution note"), **Submit resolution** → toast "Alert resolved and closed".
- Pagination: `<Pagination page={page} totalPages={data.pages} …/>` shown when `data.pages > 1` (**REQUIRED correction: source used `data.totalPages`, which the API does not return — see §14 #3**).

---

## 9. Mobile (Expo Router)

### 9.1 API + wiring
- `mobile/src/services/api.js`: tag type `'SOSAlert'`; endpoints `getSOSAlerts` (GET `/sos`), `createSOSAlert` (POST), `ackSOSAlert` (PATCH `/sos/:id/ack`), `resolveSOSAlert` (PATCH `/sos/:id/resolve`) — the three mutations invalidate `['SOSAlert','Dashboard']`; export the 4 hooks.
- `mobile/src/app/_layout.js` socket map: `'sos:new': ['SOSAlert','Dashboard']`, `'sos:updated': ['SOSAlert','Dashboard']`. (No in-app broadcast popup on mobile; the push notification is the broadcast.)
- Entry points: Campus tab card `{ href:'/sos', label:'Emergency SOS', hint:'Instant alert', icon: AlertTriangle, gradient: rose }`; home quick-action `IconButton icon={AlertTriangle} label="Emergency SOS" onPress={() => router.push('/sos')}` (two places in the home tab).
- Notification taps with `link:'/sos'` open this screen via the host's existing deep-link handling.

### 9.2 `mobile/src/app/(app)/sos.js`
- Header (back) "Campus SOS"; subtitle responders "Live emergency dispatch & responder feed", others "Rapid emergency alert system"; right: small danger **SOS** button.
- Red-tinted card "Need Immediate Emergency Help?" / "Press below to alert Security & Administration instantly." + **Trigger Emergency SOS** (danger).
- Responders: `Segmented` All / Active / Acked / Resolved (maps to `status` undefined / active / acknowledged / resolved); others: `SectionTitle "Alert History"`.
- Query `useGetSOSAlertsQuery({status}, { pollingInterval: isResponder ? 10000 : undefined })`; pull-to-refresh via `Screen`.
- **REQUIRED correction:** read the list from `data?.items` (source read `data?.alerts`, which never exists — §14 #2).
- Card per alert (type icon + label, `StatusBadge`, avatar/name, `department · Sec section · time-ago`, phone, note box, `Lat/Lng` with 4 decimals, green resolution box). Responders see **Acknowledge** (when active) and **Resolve** (active/acknowledged).
- `TriggerSOSModal` (bottom sheet): "Emergency SOS Alert" / "Alerts campus security & administration immediately", the 5 type cards (same labels as web but "Medical Emergency", "Security Threat", "Fire Hazard", "Ragging / Harassment", "Other Immediate Help"), multiline "Additional note (optional)" (maxLength 300), **Confirm & Broadcast SOS**. Success alert: *"Emergency Alert Sent — Campus security, wardens, and management have been notified immediately."* **No GPS is captured on mobile** (keep as-is).
- `ResolveModal` (bottom sheet): `Segmented` Resolved / False Alarm, multiline "Action taken / Resolution note" (maxLength 500, required — "Please enter a brief resolution note"), **Submit Resolution** → alert "Resolved — Emergency incident marked resolved."
- Ack success alert: "Acknowledged — Alert acknowledged. Student has been notified that help is dispatched."
- Uses the host theme (`useTheme()` colors if present, else the static `colors`).

---

## 10. Seed data
None. The source seed does not create SOS alerts. Do not add any.

## 11. Client state summary
Tag `SOSAlert` is provided by `getSOSAlerts`; invalidated by all three mutations, by socket events `sos:new`/`sos:updated`, and by any notification of type `sos`.

## 12. Order of delivery (single phase, no extras)
1. Constants (+ `'sos'` notification type) → model → controller → routes → server test.
2. Web: API → modal → broadcast popup → page → layout/sidebar/topbar/bell wiring.
3. Mobile: API → screen → socket map → entry points.
4. Full regression run.

## 13. Tests
Reuse the source test (in `server/tests/newmodules.test.js`):
```js
test('Campus SOS: student creates alert, responders see and acknowledge, then resolve', async () => {
  const forbidden = await student.get('/sos');               assert.equal(forbidden.status, 403);
  const created = await student.post('/sos', { type:'medical', note:'Injured ankle near sports ground',
                                               location:{ lat:12.9716, lng:77.5946, accuracy:5 } });
  assert.equal(created.status, 201); assert.equal(created.body.status, 'active');
  const id = created.body._id;
  const list = await security.get('/sos');                    assert.ok(list.body.items.some(i => i._id === id));
  const ack = await security.patch(`/sos/${id}/ack`);         assert.equal(ack.body.status, 'acknowledged');
  const res = await admin.patch(`/sos/${id}/resolve`, { status:'resolved', resolutionNote:'First aid team dispatched and student assisted.' });
  assert.equal(res.body.status, 'resolved');
});
```
Add assertions only for existing behaviour: invalid `type` → 400; resolve without note → 400; unknown id → 404; `false_alarm` outcome sets `status:'false_alarm'`; **a `Notification` row with `type:'sos'` exists for another user after creation and for the sender after ack/resolve** (guards §14 #1).

---

## 14. Known issues in the source (and what to do)

| # | Issue in source | Impact | Action |
|---|---|---|---|
| 1 | `'sos'` is **missing from `NOTIFICATION_TYPES`** (a comment says to append it but the array was never updated). `Notification.insertMany` fails enum validation inside `notifyUsers`, which swallows the error. | **No SOS notification row or push is ever created** (sockets still work). | **REQUIRED:** append `'sos'`. |
| 2 | Mobile screen reads `data?.alerts`; the API returns `items`. | Mobile feed always shows "No emergency alerts". | **REQUIRED:** use `data?.items`. |
| 3 | Web page uses `data.totalPages`; the API returns `pages`. | Pagination never appears. | **REQUIRED:** use `data.pages`. |
| 4 | `GET /sos` is limited to responders by the route, so the "Your Past Emergency Alerts" view for other roles (web) and "Alert History" (mobile) can only show a 403 error state; the controller's own-alerts branch is unreachable. The sidebar link is hidden for student/club_admin on web, but mobile shows the screen for everyone. | Non-responders can trigger but not view history. | **Keep as-is** (403 is the tested behaviour). Do not add a history endpoint. |
| 5 | `listAlerts` sorts by `{status:1, createdAt:-1}`; status sorts alphabetically (acknowledged, active, false_alarm, resolved). | Active alerts are not guaranteed first. | **OPTIONAL** minimal fix: sort by a status rank (active, acknowledged, then rest) then `createdAt:-1`. Skip if you want byte-for-byte parity. |
| 6 | Ack/resolve have no state guards (a resolved alert can be acknowledged again or resolved twice; later ack overwrites `acknowledgedBy`). | Data overwrite. | **OPTIONAL:** reject ack/resolve on `resolved`/`false_alarm` alerts with `409`. |
| 7 | Resolve validator allows `resolutionNote` ≤300 while the model allows 500 and the web/mobile inputs allow 500. | Notes of 301–500 chars are rejected by validation. | **OPTIONAL:** raise the route limit to 500. |
| 8 | No rate limit on `POST /sos`; every trigger pushes to all active users. | Abuse potential. | **Out of scope** — noted only; do not build. |

---

## 15. Acceptance checklist
- [ ] Only the files in §3.3 were edited in the host; no other feature changed; host tests green.
- [ ] `SOSAlert` model, 4 handlers and 4 routes match §5–§6 exactly (status codes, messages, populate fields, pagination default 15).
- [ ] `'sos'` is in `NOTIFICATION_TYPES`; a notification row + push exists for all active users except the sender on create, and for the sender on ack/resolve.
- [ ] `sos:new` reaches all roles; `sos:updated` reaches responder roles only; clients refetch the `SOSAlert` tag on both.
- [ ] Web: modal (with GPS), broadcast popup (fire overlay + toasts), responder page (filters, polling, ack, resolve, pagination, map link), sidebar + topbar buttons, bell icon.
- [ ] Mobile: screen (trigger sheet, resolve sheet, responder tabs, `data.items`), Campus card, home quick actions, socket map.
- [ ] Non-responder `GET /sos` returns 403; invalid type 400; resolve without note 400; unknown id 404.
- [ ] No extra features were added.