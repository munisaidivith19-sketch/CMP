# Alumni Network Module — Complete Build Specification (A to Z)

> Extracted from **Vexon / CampusConnect** (MERN + Redux Toolkit/RTK Query + Socket.io + Expo mobile) and extended with the features chosen for the new project.
> Target stack: **same as source** — Express 4/5 + Mongoose, React (Vite) + Tailwind, Expo Router mobile, Socket.io, JWT auth.

---

## 0. How to use this file (instructions to the implementing agent)

1. **Additive only.** Do not modify, rename or change behavior of any existing feature of the host project. Allowed host edits are limited to the *registration points* in §3.3 (one-line additions: register routes, register models in seed, add a constant, add a nav item, add socket-event→tag map entries).
2. Build in the phases of §17. Each phase must leave the host app fully working (tests green, lint clean).
3. Where this spec says "host provides X" (§3), map to the host's equivalent. Do not re-implement host infrastructure (auth, upload, mailer, notifications, sockets).
4. Do **not** copy the known defects in §16; implement the corrected behavior given here.
5. Generate complete files, not fragments. Every endpoint needs validation, authorization, tests.

---

## 1. Scope

### 1.1 Baseline (exists in source project today — port as-is, with §16 fixes)
| Area | What exists |
|---|---|
| Alumni profile | One profile per alumni user: gradYear, company, designation, location, linkedin, mentorship availability, max active mentees, active mentee count, domains, mentorship note |
| Verification | Profiles are hidden until an admin/HOD verifies them; editing `gradYear` or `company` resets verification |
| Directory | Paginated list of verified alumni; filters: domain, company (regex), gradYear, "available for mentorship" (capacity-aware); staff can list unverified queue; live-aggregated avg rating |
| Mentorship | Student → alumni request (domain + message ≤500) → alumni accepts/declines (with note) → alumni completes → student rates 1–5 + review; capacity caps; one pending request per student↔alumni pair |
| Realtime/Notify | Socket events `alumni:request`, `alumni:request_updated`; persisted + push notifications |
| Admin | Admin creates alumni accounts via admin user-creation (fields: department, phone) |
| Seed/Tests | 3 seeded alumni, 1 request; test for capacity cap, atomic counts, rating |

### 1.2 New in this build (selected features)
1. **Jobs & referrals board**
2. **Alumni events & reunions** (RSVP, waitlist, reminders, check-in)
3. **Mentorship sessions & scheduling** (slots, booking, reschedule, notes, goals, message-mentor link)
4. **Batch / department chapters** (groups with wall, announcements, comments)
5. **Alumni analytics dashboard**
6. **Bulk import & invite** (CSV → invites → claim account)
7. **Granular privacy controls** (field-level visibility)
8. Quality additions: directory text search, facets, student cancel, request expiry, profile detail page, completeness meter.

### 1.3 Out of scope
Payments/donations, resume parsing, video calling (only a meeting-link field), email marketing.

---

## 2. Roles & permission matrix

Roles used (must exist in host `ROLES`): `alumni`, `student` (and `club_admin` treated as student), `faculty`, `hod`, `principal`, `admin`, plus other staff roles (`dean`, `ao`, `chairman`) = read-only viewers.

Definitions: **STAFF_ALUMNI = ['admin','hod']** (verify, moderate, import, full analytics, HOD limited to own department). **VIEW_ANALYTICS = ['admin','hod','principal','chairman','dean']**. HOD scope is enforced server-side from `req.user.department` — never trust a client-supplied department.

| Capability | alumni | student/club_admin | faculty | hod | admin | other staff |
|---|---|---|---|---|---|---|
| View directory (verified only) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| View unverified queue / verify / reject | ✗ | ✗ | ✗ | ✔ own dept | ✔ | ✗ |
| Edit own alumni profile & privacy | ✔ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Request mentorship | ✗ | ✔ | ✗ | ✗ | ✗ | ✗ |
| Respond/complete/end mentorship, publish slots, notes | ✔ (own) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Cancel own request, book slot, rate | ✗ | ✔ (own) | ✗ | ✗ | ✗ | ✗ |
| Post a job | ✔ (verified) | ✗ | ✔ | ✔ | ✔ | ✗ |
| Apply / request referral | ✗ | ✔ | ✗ | ✗ | ✗ | ✗ |
| Manage applications of a job | poster | ✗ | poster | staff | ✔ | ✗ |
| Create event | proposes (needs approval) | ✗ | proposes | ✔ | ✔ | ✗ |
| Approve/reject event | ✗ | ✗ | ✗ | own dept | ✔ | ✗ |
| RSVP event (if audience matches) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Create chapter | ✗ | ✗ | ✗ | ✔ own dept | ✔ | ✗ |
| Join chapter / post / comment | ✔ | read only (public chapters) | read | ✔ | ✔ | read |
| Moderate chapter (pin/delete) | chapter moderator | ✗ | ✗ | ✔ | ✔ | ✗ |
| Bulk import / invites | ✗ | ✗ | ✗ | ✔ own dept | ✔ | ✗ |
| Analytics | ✗ | ✗ | ✗ | ✔ own dept | ✔ | ✔ read |

---

## 3. Integration contract with the host project

### 3.1 Host must provide (names from the source project — map to equivalents)
| Need | Source implementation | Used for |
|---|---|---|
| `User` model | `models/User.js` — fields used: `name, email, role, department, year, avatar, phone, isActive`; `PUBLIC_USER_FIELDS` | populate, role checks |
| Auth middleware | `middleware/auth.js` → `authenticate` (sets `req.user`), `authorize(...roles)` (403 otherwise) | all routes |
| Validation | `express-validator` + `middleware/validate.js`, `idParam('id')` helper | all routes |
| HTTP utils | `utils/http.js` → `ApiError(status,msg)`, `asyncHandler`, `paginate(req,default,max)`, `pageMeta(total,page,limit)`, `pick(obj,keys)`, `escapeRegex` | controllers |
| `sameId(a,b)` | `utils/permissions.js` | ownership checks |
| Notifications | `utils/notify.js` → `notifyUsers(userIds,{type,title,message,link},{exclude,push})`, `notifyRoles(roles,payload)`; persists, emits `notification` over socket, sends Expo push | all alerts |
| Realtime | `config/socket.js` → `emitToUsers(ids,event,payload)`, `emitTo(room,…)`, `emitToRoles`; rooms `user:<id>`, `role:<role>` | live updates |
| Activity log | `utils/activity.js` → `logActivity(req, action, {entityType, entityId, summary})` | audit |
| Upload | `controllers/uploadController.js` + `utils/storage.js` (local or Cloudinary) | resume, cover images, CSV |
| Mailer | `utils/mailer.js` (SMTP optional; must degrade gracefully when unset) | invites |
| Rate limiting | `middleware/rateLimit.js` | claim endpoint, applications |
| Chat module (optional) | `Conversation`/`Message` + `POST /chat/conversations` | "Message mentor" |
| Client | RTK Query `createApi` with tag types; `socket.io-client` singleton; UI primitives (`Card, Badge, Button, Modal, Tabs, Pagination, EmptyState, ErrorState, Skeleton, Avatar`) | UI |
| Mobile | Expo Router, `components/ui.js` (Screen, Header, Card, Badge, Button, Input, Segmented, T, Loading, ErrorState), `theme.js` | UI |

### 3.2 Environment variables (add to `.env.example`)
```
ALUMNI_JOBS_REQUIRE_APPROVAL=false       # true => jobs start as pending_review
ALUMNI_EVENTS_REQUIRE_APPROVAL=true      # alumni/faculty-proposed events need admin/HOD approval
ALUMNI_AUTO_VERIFY_IMPORTED=true         # profiles created from an admin CSV import are pre-verified
ALUMNI_CHAPTER_AUTOJOIN=true             # auto-join batch/department chapters when verified
ALUMNI_INVITE_EXPIRES_DAYS=14
MENTORSHIP_REQUEST_EXPIRY_DAYS=14
MENTORSHIP_MAX_PENDING_PER_STUDENT=3
ALUMNI_IMPORT_MAX_ROWS=2000
ALUMNI_JOBS_PER_ALUMNI_PER_DAY=5
```

### 3.3 The ONLY host files that may be touched (one-line registrations)
1. `constants.js` — add the constants of §4 and **append `'alumni'` to `NOTIFICATION_TYPES`** (required — see §16 defect #1).
2. `routes/index.js` — mount the new router (or paste the route block) **before** any generic `/alumni/:id` matcher.
3. `seed/seed.js` — call `seedAlumniNetwork()` and add models to the wipe list.
4. Client `services/api.js` / mobile `services/api.js` — add `tagTypes` and spread new endpoints.
5. `AppLayout.jsx` / mobile `_layout.js` — add the socket-event → tag-invalidation map entries of §8.3.
6. `Sidebar.jsx` / mobile Campus tab — one nav entry "Alumni Network" (already present in source).
7. `server.js` — start the schedulers of §9 (guarded so a failure never crashes the API).

---

## 4. Constants (server `constants.js`; mirror in client `utils/constants.js` and mobile `theme.js`)

```js
export const MENTORSHIP_DOMAINS = [
  'software_engineering','cybersecurity','data_science','core_engineering',
  'higher_studies','government_exams','entrepreneurship','other',
];
// Legacy four kept; three added. 'accepted' counts toward capacity.
export const MENTORSHIP_STATUSES = ['pending','accepted','declined','completed','cancelled','expired'];

export const PRIVACY_LEVELS = ['public','mentees','staff','hidden'];
// public  = any signed-in user | mentees = staff + students with an accepted/completed mentorship with this alumni
// staff   = admin/HOD(own dept)/principal/dean/chairman/ao | hidden = owner (+admin for verification only)
export const PRIVACY_FIELDS = ['email','phone','linkedin','company','designation','location'];

export const JOB_TYPES = ['full_time','internship','part_time','contract'];
export const JOB_WORK_MODES = ['onsite','remote','hybrid'];
export const JOB_STATUSES = ['pending_review','open','closed','expired','removed'];
export const JOB_APPLY_MODES = ['referral','external_link'];
export const JOB_APPLICATION_STATUSES = ['applied','referred','shortlisted','rejected','withdrawn'];

export const ALUMNI_EVENT_TYPES = ['reunion','webinar','guest_talk','networking','workshop','other'];
export const ALUMNI_EVENT_MODES = ['in_person','online','hybrid'];
export const ALUMNI_EVENT_STATUSES = ['pending_approval','scheduled','cancelled','completed','rejected'];
export const RSVP_STATUSES = ['going','waitlisted','cancelled'];

export const SLOT_STATUSES = ['open','booked','cancelled'];
export const SESSION_MODES = ['video','phone','in_person','chat'];
export const SESSION_STATUSES = ['confirmed','completed','cancelled','no_show'];

export const CHAPTER_TYPES = ['batch','department','interest','city'];
export const CHAPTER_ROLES = ['member','moderator'];
export const CHAPTER_POST_KINDS = ['post','announcement'];

export const INVITE_STATUSES = ['pending','claimed','expired','revoked'];
export const IMPORT_STATUSES = ['validated','processing','done','failed'];
```

---

## 5. Data models (Mongoose, ES modules)

> Pattern: `export default mongoose.models.X || mongoose.model('X', schema)`. All schemas `{ timestamps: true, toJSON: { versionKey: false } }`.

### 5.1 `AlumniProfile` (extend source model — all new fields optional, backward compatible)
```js
const privacyField = { type: String, enum: PRIVACY_LEVELS };
const alumniProfileSchema = new Schema({
  user: { type: ObjectId, ref: 'User', required: true, unique: true, index: true },

  // — existing —
  gradYear: { type: Number, required: true, min: 1980, max: 2100 },   // FIX: align validator (§16 #7)
  company: { type: String, trim: true, maxlength: 120 },
  designation: { type: String, trim: true, maxlength: 120 },
  location: { type: String, trim: true, maxlength: 120 },
  linkedin: { type: String, trim: true, maxlength: 200 },
  mentorshipAvailable: { type: Boolean, default: false, index: true },
  maxActiveMentees: { type: Number, default: 3, min: 0, max: 20 },
  activeMenteeCount: { type: Number, default: 0, min: 0 },
  domains: { type: [{ type: String, enum: MENTORSHIP_DOMAINS }], default: [] },
  mentorshipNote: { type: String, trim: true, maxlength: 500 },
  isVerified: { type: Boolean, default: false, index: true },
  verifiedBy: { type: ObjectId, ref: 'User' }, verifiedAt: Date,

  // — new —
  headline: { type: String, trim: true, maxlength: 140 },
  about: { type: String, trim: true, maxlength: 1000 },
  skills: { type: [{ type: String, trim: true, maxlength: 40 }], default: [], validate: v => v.length <= 15 },
  program: { type: String, trim: true, maxlength: 80 },               // e.g. "B.E. CSE (Cyber Security)"
  rejectionReason: { type: String, maxlength: 300 },                  // set on reject, cleared on resubmit
  openToReferrals: { type: Boolean, default: false },                 // willing to refer students for jobs
  showInDirectory: { type: Boolean, default: true },                  // hide completely from directory (still verified)
  privacy: {                                                          // per-field visibility
    email: { ...privacyField, default: 'mentees' },
    phone: { ...privacyField, default: 'hidden' },
    linkedin: { ...privacyField, default: 'public' },
    company: { ...privacyField, default: 'public' },
    designation: { ...privacyField, default: 'public' },
    location: { ...privacyField, default: 'public' },
  },
  source: { type: String, enum: ['self','import','admin'], default: 'self' },
}, opts);
alumniProfileSchema.index({ isVerified: 1, showInDirectory: 1, mentorshipAvailable: 1, domains: 1 });
alumniProfileSchema.index({ gradYear: 1 });
alumniProfileSchema.index({ company: 'text', designation: 'text', skills: 'text', headline: 'text' });
```
Search by **name** requires joining `User.name`: implement `search` via aggregation `$lookup` (§6.2) or by pre-resolving matching user ids with `User.find({role:'alumni', $text/regex})` then `AlumniProfile.find({user:{$in:ids}})`.

### 5.2 `MentorshipRequest` (extend)
Add fields (all optional): 
```js
goals: [{ text: { type: String, maxlength: 200 }, done: { type: Boolean, default: false } }],  // ≤5, student & alumni editable
cancelledAt: Date, cancelReason: { type: String, maxlength: 300 },
expiresAt: Date,           // createdAt + MENTORSHIP_REQUEST_EXPIRY_DAYS (only while pending)
completedAt: Date,
```
Keep indexes, including the partial unique `{student, alumni}` where `status:'pending'`. Add `{ status:1, expiresAt:1 }` for the expiry sweeper.

### 5.3 `MentorshipSlot` (new)
```js
{ alumni: ObjectId(User, index), startsAt: Date (index), durationMin: Number (15|30|45|60, default 30),
  mode: enum SESSION_MODES, meetingLink: String(≤300, https only), note: String(≤200),
  status: enum SLOT_STATUSES default 'open', bookedBy: ObjectId(User), session: ObjectId(MentorshipSession) }
index: { alumni:1, status:1, startsAt:1 };  startsAt must be in the future; no overlap with the alumni's other open/booked slots.
```

### 5.4 `MentorshipSession` (new)
```js
{ request: ObjectId(MentorshipRequest, required, index), alumni: ObjectId(User, index), student: ObjectId(User, index),
  slot: ObjectId(MentorshipSlot), agenda: String(≤300), scheduledAt: Date (index), durationMin: Number,
  mode: enum, meetingLink: String,
  status: enum SESSION_STATUSES default 'confirmed',
  sharedNotes: String(≤2000),          // visible to both
  alumniPrivateNotes: String(≤2000),   // visible ONLY to the alumni (never serialize to student)
  actionItems: [{ text: String(≤200), done: Boolean, dueDate: Date }],
  cancelledBy: ObjectId(User), cancelReason: String(≤300), completedAt: Date,
  reminder24hSentAt: Date, reminder1hSentAt: Date }
index: { alumni:1, scheduledAt:1 }, { student:1, scheduledAt:1 }
```

### 5.5 `AlumniJob` (new)
```js
{ postedBy: ObjectId(User, index), title: String(req,≤120), company: String(req,≤120),
  type: enum JOB_TYPES, workMode: enum JOB_WORK_MODES, location: String(≤120),
  description: String(req,≤4000), skills: [String ≤30 each, max 15],
  experienceMin: Number(0-30), experienceMax: Number(0-30), stipendOrSalary: String(≤60, optional free text),
  applyMode: enum JOB_APPLY_MODES (default 'referral'), externalUrl: String(https, required if external_link),
  deadline: Date, eligibleDepartments: [String] (empty = all), eligibleYears: [Number] (student year 1-4, empty = all),
  status: enum JOB_STATUSES default 'open' (or 'pending_review' if ALUMNI_JOBS_REQUIRE_APPROVAL),
  removedBy: ObjectId, removeReason: String(≤300), applicationCount: Number default 0, viewCount: Number default 0 }
indexes: { status:1, deadline:1 }, { postedBy:1, createdAt:-1 }, text on title/company/skills/description
```

### 5.6 `JobApplication` (new)
```js
{ job: ObjectId(AlumniJob, index), student: ObjectId(User, index), poster: ObjectId(User, index),   // denormalised for fast inbox
  note: String(≤500), resumeUrl: String (uploaded via host upload; same-origin path or Cloudinary URL only),
  referralRequested: Boolean,
  status: enum JOB_APPLICATION_STATUSES default 'applied', posterNote: String(≤500), statusChangedAt: Date }
unique index { job:1, student:1 } (re-apply after withdrawal => reactivate same doc)
```

### 5.7 `AlumniEvent` (new — separate from host's generic Event model on purpose, to avoid touching it)
```js
{ title: String(req,≤140), description: String(≤4000), type: enum ALUMNI_EVENT_TYPES, mode: enum ALUMNI_EVENT_MODES,
  venue: String(≤200), meetingLink: String(https; returned ONLY to going RSVPs, organizer, staff),
  startsAt: Date(req,index), endsAt: Date(req), registrationDeadline: Date, capacity: Number(0 = unlimited),
  audience: { gradYears: [Number], departments: [String], roles: [enum] } (empty arrays = everyone),
  cover: String, createdBy: ObjectId(User), organizerName: String,
  status: enum ALUMNI_EVENT_STATUSES, reviewedBy: ObjectId, rejectReason: String(≤300), cancelReason: String(≤300),
  goingCount: Number default 0, waitlistCount: Number default 0,
  reminder24hSentAt: Date, reminder1hSentAt: Date }
indexes: { status:1, startsAt:1 }, text on title/description
```
### 5.8 `AlumniEventRsvp` (new)
```js
{ event: ObjectId(index), user: ObjectId(index), status: enum RSVP_STATUSES, checkedInAt: Date, checkedInBy: ObjectId }
unique { event:1, user:1 }
```

### 5.9 Chapters (new)
```js
Chapter: { name: String(req,≤80), slug: String(unique, lowercase), type: enum CHAPTER_TYPES,
  gradYear: Number, department: String, city: String, description: String(≤600), cover: String,
  isPrivate: Boolean default false (private = join by approval/invite; posts visible to members only),
  createdBy: ObjectId, memberCount: Number default 0, postCount: Number default 0, archived: Boolean default false }
  indexes: slug unique, { type:1, gradYear:1, department:1 }
ChapterMember: { chapter: ObjectId, user: ObjectId, role: enum CHAPTER_ROLES default 'member', status: enum ['active','pending'] default 'active' }
  unique { chapter:1, user:1 }
ChapterPost: { chapter: ObjectId(index), author: ObjectId, kind: enum CHAPTER_POST_KINDS (announcement => moderators only),
  body: String(req,≤2000), images: [String] (≤4), pinned: Boolean, likes: [ObjectId] (cap 5000; use likeCount denormalised),
  likeCount: Number, commentCount: Number, deletedAt: Date, deletedBy: ObjectId }
  index { chapter:1, pinned:-1, createdAt:-1 }
ChapterComment: { post: ObjectId(index), author: ObjectId, body: String(req,≤600), deletedAt: Date }
```

### 5.10 Invites & imports (new)
```js
AlumniImportBatch: { uploadedBy: ObjectId, filename: String, department: String (scope for HOD),
  totals: { rows, valid, invalid, duplicates, alreadyExist },
  rows: [{ line: Number, name, email, department, gradYear, company, designation, location, phone,
           state: enum ['valid','invalid','duplicate','exists'], errors: [String] }],   // cap ALUMNI_IMPORT_MAX_ROWS
  status: enum IMPORT_STATUSES, committedAt: Date, invitesCreated: Number, emailsSent: Number }
AlumniInvite: { email: String(lowercase, index), name, department, gradYear: Number, company, designation, location, phone,
  tokenHash: String (sha256 of raw token; raw token NEVER stored), expiresAt: Date,
  status: enum INVITE_STATUSES default 'pending', batch: ObjectId, invitedBy: ObjectId, user: ObjectId (set on claim),
  claimedAt: Date, lastSentAt: Date, sendCount: Number }
  unique partial { email:1 } where status:'pending'
```

---

## 6. Backend API contract

Base `/api`, JSON, all routes require `authenticate` except the claim endpoints. Errors: `{ message, errors? }` via `ApiError`. Lists: `{ items, total, page, limit, pages }`. Register **static paths before parameter paths** (`/alumni/me`, `/alumni/jobs`, `/alumni/events`, `/alumni/chapters`, `/alumni/analytics`, `/alumni/import`, `/alumni/invites`, `/alumni/filters` before `/alumni/:userId`).

### 6.1 Profile
| Method & path | Auth | Body / query | Rules & response |
|---|---|---|---|
| `GET /alumni/me` | any (alumni meaningful) | — | Own profile (populated user) or a default template (not persisted) + `avgRating`, `ratingCount`, `completeness` (0-100) |
| `PUT /alumni/me` | alumni | whitelisted via `pick`: gradYear, company, designation, location, linkedin, headline, about, skills, program, domains, mentorshipAvailable, maxActiveMentees, mentorshipNote, openToReferrals, showInDirectory, privacy | validate: gradYear int 1980–currentYear+1; maxActiveMentees int 0–20 **and ≥ current activeMenteeCount** (else 409); linkedin must be `https://(www.)?linkedin.com/…`; skills ≤15; privacy values ∈ PRIVACY_LEVELS and keys ∈ PRIVACY_FIELDS. Changing `gradYear`/`company` ⇒ `isVerified=false` (+notify staff queue). Clears `rejectionReason`. Returns profile. |
| `GET /alumni/:userId` | any | — | Profile detail with **privacy projection** (§7.4), ratings summary, last 5 reviews (anonymised to first name), open jobs count, upcoming events count. 404 if unverified unless viewer is owner/staff. |
| `GET /alumni/filters` | any | — | Facets for filter UI: `departments[]`, `gradYears[]`, `topCompanies[{name,count}]`, `locations[]`, `domains[{key,count}]` (verified+visible only) |

### 6.2 Directory
`GET /alumni` — query: `search` (name/company/designation/skill, escaped), `department`, `domain`, `company` (escaped regex), `gradYear`, `location`, `skill`, `mentorshipAvailable=true`, `openToReferrals=true`, `sort=recent|rating|name|gradYear`, `unverified=true` (staff only; HOD forced to own department), `page`, `limit` (default 12, max 50).
Rules: default filter `isVerified:true, showInDirectory:true`. `mentorshipAvailable` ⇒ `$expr:{$lt:['$activeMenteeCount','$maxActiveMentees']}`. `department` filters on joined `User.department`. Apply privacy projection to every item. Enrich with live ratings via one `$group` over `MentorshipRequest` (as source) — or maintain `ratingAvg/ratingCount` on the profile (recommended optimisation; update inside `rateMentorship`).

### 6.3 Verification
| `PATCH /alumni/:id/verify` | admin, hod (HOD: alumni.department must equal own) | sets isVerified, verifiedBy/At, clears rejectionReason; notifies alumni (`type:'alumni'`, link `/alumni`); if `ALUMNI_CHAPTER_AUTOJOIN` auto-join batch+department chapters |
| `POST /alumni/:id/reject` | admin, hod | `{ reason(5–300) }` → isVerified false, `rejectionReason`; notify alumni with reason |

### 6.4 Mentorship requests (paths kept for backward compatibility)
| Method & path | Auth | Rules |
|---|---|---|
| `POST /mentorship-requests` | student | `{ alumni, domain∈DOMAINS, message 5–500 }`. Profile must exist, verified, `mentorshipAvailable`, capacity not full (409), no existing pending to same alumni (409), student's pending count < `MENTORSHIP_MAX_PENDING_PER_STUDENT` (429-style 409). Sets `expiresAt`. Notify alumni + socket `alumni:request`. |
| `GET /mentorship-requests` | any | `status`, `page`. Alumni ⇒ requests where `alumni=me`; student ⇒ `student=me`; **admin/hod/principal ⇒ read-only list scoped (HOD by student department)** (FIX §16 #9). |
| `GET /mentorship-requests/:id` | participant or staff | populated + sessions + goals |
| `PATCH /mentorship-requests/:id` (alias `/respond`) | alumni (owner) | `{ status: accepted|declined, response ≤500 }`. **Only from `pending`** (409 otherwise). Accept uses atomic capacity pattern (§7.2). |
| `PATCH /mentorship-requests/:id/cancel` | student (owner) | allowed from `pending` (no capacity change) or `accepted` (decrement capacity atomically). `{ reason? }`. Notify alumni. |
| `PATCH /mentorship-requests/:id/complete` | alumni (owner) | only from `accepted`; decrement capacity (guarded ≥0); set completedAt; notify student to rate |
| `PATCH /mentorship-requests/:id/rate` | student (owner) | only `completed`, once; `rating` int 1–5, `review ≤500` (accept legacy `feedback` alias); update cached profile rating; notify alumni |
| `PATCH /mentorship-requests/:id/goals` | participant | `{ goals:[{text,done}] }` max 5 (only while `accepted`) |

### 6.5 Slots & sessions
| `GET /mentorship/slots?alumni=:id&from=&to=` | any (student sees only `open` future slots of mentors available) | |
| `POST /mentorship/slots` | alumni | `{ slots:[{startsAt,durationMin,mode,meetingLink?,note?}] }` ≤20 per call; future only; no overlap; meetingLink https |
| `DELETE /mentorship/slots/:id` | alumni owner | only `open` slots |
| `POST /mentorship/sessions` | student | `{ request, slot, agenda≤300 }`. Request must be `accepted` and belong to student; slot `open` and belongs to request.alumni. **Atomic booking:** `MentorshipSlot.findOneAndUpdate({_id,status:'open'},{status:'booked',bookedBy})`; null ⇒ 409 "slot just taken". Creates session `confirmed`, links slot. Max 1 upcoming session per request. Notify alumni; socket `alumni:session`. |
| `GET /mentorship/sessions?scope=upcoming|past` | participant | alumni private notes stripped for students |
| `PATCH /mentorship/sessions/:id/reschedule` | participant | `{ slot }` (a different open slot of same alumni) — frees old slot atomically, books new; ≥2h before start |
| `PATCH /mentorship/sessions/:id/cancel` | participant | `{ reason }`; frees slot (if still future); notify other party |
| `PATCH /mentorship/sessions/:id/complete` | alumni | only after `scheduledAt`; or `no_show` via `{ outcome:'no_show' }` |
| `PATCH /mentorship/sessions/:id/notes` | participant | alumni: `sharedNotes`, `alumniPrivateNotes`, `actionItems`; student: may only toggle own action items done & add `sharedNotes` comment? (keep: student can toggle `actionItems[].done` only) |
| `POST /mentorship/requests/:id/message` | participant (accepted) | Integration shortcut: find-or-create direct host chat conversation between the two users and return its id (skip if host has no chat; hide the button). |

### 6.6 Jobs
| `GET /alumni/jobs` | any | `search, type, workMode, location, department, skill, mine=true, status` ; students see only `open` & not-expired & eligible-by-department/year (eligibility = soft filter + badge); poster sees own incl. closed; staff sees all |
| `POST /alumni/jobs` | verified alumni, faculty, hod, admin | validate per model; `applyMode=external_link` ⇒ https `externalUrl` required; deadline future; rate limit `ALUMNI_JOBS_PER_ALUMNI_PER_DAY`; status per env flag; notify students of matching department(s) (batched, `push:false` if >200 recipients) |
| `GET /alumni/jobs/:id` | any | increments `viewCount` (once per user/day not required); includes `myApplication` for students |
| `PATCH /alumni/jobs/:id` | poster, admin | editable fields; cannot edit after `removed` |
| `PATCH /alumni/jobs/:id/close` / `reopen` | poster, admin | |
| `DELETE /alumni/jobs/:id` | poster, admin/hod | soft: `status:'removed'`, `removeReason` (staff must give reason; notify poster) |
| `POST /alumni/jobs/:id/apply` | student | `{ note≤500, resumeUrl?, referralRequested? }`; job `open`, before deadline, not own; unique per student; if `applyMode=external_link` ⇒ record intent only. Increments `applicationCount`. Notify poster + socket `alumni:job_application`. |
| `GET /alumni/jobs/:id/applications` | poster, staff | pagination, status filter; includes student summary (name, dept, year, rollNo, resume) |
| `GET /alumni/job-applications/mine` | student | |
| `PATCH /alumni/job-applications/:id` | poster | `{ status: referred|shortlisted|rejected, posterNote }`; notify student |
| `PATCH /alumni/job-applications/:id/withdraw` | student | |

### 6.7 Events
| `GET /alumni/events?when=upcoming|past|mine|pending` | any | `pending` = approval queue (admin/hod). Non-staff see only `scheduled/completed` + their own proposals. Filters: type, mode, search. Each item has `myRsvp`, `goingCount`, `spotsLeft`, `audienceMatch` |
| `POST /alumni/events` | alumni(verified), faculty, hod, admin | validate (`endsAt>startsAt>now`, capacity ≥0, https link). Status = `scheduled` for admin/HOD, else `pending_approval` when `ALUMNI_EVENTS_REQUIRE_APPROVAL` |
| `GET /alumni/events/:id` | any | `meetingLink` only for going RSVP / organizer / staff |
| `PATCH /alumni/events/:id` | organizer, admin | editing date/venue after RSVPs ⇒ notify attendees |
| `POST /alumni/events/:id/approve` · `/reject {reason}` | admin, hod(own dept audience) | notify organizer |
| `POST /alumni/events/:id/cancel {reason}` | organizer, admin | status `cancelled`; notify all going+waitlisted |
| `POST /alumni/events/:id/rsvp` | any | must match `audience` (else 403), before `registrationDeadline`, event `scheduled`. **Atomic capacity:** if `capacity>0` and full ⇒ `waitlisted`. |
| `DELETE /alumni/events/:id/rsvp` | self | cancel; **promote first waitlisted** atomically, notify them |
| `GET /alumni/events/:id/attendees` | organizer, staff | counts + list (+CSV via `?format=csv`) |
| `POST /alumni/events/:id/checkin {userId}` | organizer, staff | sets `checkedInAt` (only within event window ±2h) |

### 6.8 Chapters
| `GET /alumni/chapters?type=&mine=true` | any | public chapters + own private ones; includes `isMember`, `memberCount` |
| `POST /alumni/chapters` | admin, hod(own dept) | auto-generate unique `slug`; optional `autoJoin` backfill for batch/department chapters |
| `GET /alumni/chapters/:slug` | any (private ⇒ members/staff) | |
| `PATCH /alumni/chapters/:slug` · `DELETE` (archive) | admin, chapter moderator (edit only) | |
| `POST /alumni/chapters/:slug/join` · `DELETE …/join` | alumni, faculty, hod, admin (students: read-only, cannot join) | private ⇒ `status:'pending'` until a moderator approves (`PATCH …/members/:userId {status}`) |
| `GET /alumni/chapters/:slug/members` | members | roles; moderators can promote/demote/remove |
| `GET /alumni/chapters/:slug/posts` | member / public chapter viewer | cursor pagination, pinned first |
| `POST /alumni/chapters/:slug/posts` | active member | `kind:'announcement'` only moderators/admin; body ≤2000; ≤4 images; rate limit 10/min |
| `DELETE /alumni/chapters/posts/:id` | author, moderator, admin | soft delete |
| `PATCH /alumni/chapters/posts/:id/pin` | moderator, admin | |
| `POST /alumni/chapters/posts/:id/like` | member | toggle; atomic `$addToSet/$pull` + `likeCount` via `$inc` |
| `GET/POST /alumni/chapters/posts/:id/comments`, `DELETE /alumni/chapters/comments/:id` | member | |

### 6.9 Bulk import & invites
CSV columns (header row required, case-insensitive): `name, email, department, gradYear, company, designation, location, phone` — only `name,email,department,gradYear` mandatory. Max `ALUMNI_IMPORT_MAX_ROWS`, 2 MB, UTF-8.
| `POST /alumni/import/preview` | admin, hod | multipart `file`. Parse (csv-parse), validate each row (email format, gradYear range, department ∈ host departments, HOD ⇒ rows limited to own department), classify `valid|invalid|duplicate (within file)|exists (email already a User)`. **Writes nothing but the batch doc (status `validated`).** Returns batch with per-row errors. |
| `POST /alumni/import/:batchId/commit` | uploader/admin | `{ sendEmails: boolean }`. Creates one `AlumniInvite` per `valid` row (token = 32 random bytes hex; store sha256; expires `ALUMNI_INVITE_EXPIRES_DAYS`). Emails the claim link `${APP_URL}/alumni/claim?token=…` via mailer (skip if SMTP unset; response includes `emailsSent` and, **only to the importer in that response**, a downloadable CSV of links when no SMTP). Idempotent: re-commit ⇒ 409. |
| `GET /alumni/import` · `GET /alumni/import/:id` | admin, hod | history |
| `GET /alumni/invites?status=&search=` | admin, hod(own dept) | |
| `POST /alumni/invites/:id/resend` | admin, hod | rotates token, extends expiry, max 5 sends |
| `PATCH /alumni/invites/:id/revoke` | admin, hod | |
| `GET /auth/alumni-claim/:token` | **public**, rate-limited | returns prefilled `{name,email,department,gradYear,company,designation}` if pending & not expired; generic 404 otherwise (no enumeration) |
| `POST /auth/alumni-claim/:token` | **public**, rate-limited | `{ password (8+, letter+digit), accept: true }` → creates `User{role:'alumni', isActive:true}` + `AlumniProfile{source:'import', isVerified: ALUMNI_AUTO_VERIFY_IMPORTED}` from invite data in a transaction-like sequence (create user → profile → mark invite claimed; compensate on failure), issues the host's normal session response. |

### 6.10 Analytics
`GET /alumni/analytics?range=12w` (admin; hod ⇒ forced own department; principal/dean/chairman read-only) and `GET /alumni/analytics/export` (CSV of directory for admin/hod). Response shape in §10.

---

## 7. Business rules & algorithms

### 7.1 Mentorship state machine
```
pending ──accept──▶ accepted ──complete──▶ completed ──rate──▶ (rated)
   │  │                │ └──student cancel / alumni end──▶ cancelled (capacity--)
   │  └─decline──▶ declined
   ├─student cancel──▶ cancelled
   └─expiresAt passed (sweeper)──▶ expired
```
Illegal transitions ⇒ `409`. Only `accepted` counts toward `activeMenteeCount`.

### 7.2 Atomic capacity (fixes the source's check-then-increment race)
```js
// accept
const req = await MentorshipRequest.findOneAndUpdate(
  { _id, alumni: me, status: 'pending' }, { $set: { status: 'accepted', respondedAt: now, response } }, { new: true });
if (!req) throw new ApiError(409, 'Request is no longer pending');
const prof = await AlumniProfile.findOneAndUpdate(
  { user: me, $expr: { $lt: ['$activeMenteeCount', '$maxActiveMentees'] } }, { $inc: { activeMenteeCount: 1 } });
if (!prof) { await MentorshipRequest.updateOne({ _id }, { status: 'pending', $unset: { respondedAt: 1 } });
             throw new ApiError(409, 'You have reached your maximum active mentee capacity'); }
```
Decrement on complete/cancel-from-accepted: `findOneAndUpdate({user, activeMenteeCount:{$gt:0}},{$inc:{activeMenteeCount:-1}})`. Nightly reconcile job sets `activeMenteeCount = count(status:'accepted')` per alumni.

### 7.3 Verification rules
- New profile ⇒ unverified. Editing `gradYear` or `company` ⇒ unverified again (profile disappears from directory until re-verified; show banner to owner).
- HOD verifies only alumni whose `User.department` equals HOD's. Admin: all.
- Rejected ⇒ owner sees `rejectionReason` and can edit/resubmit.

### 7.4 Privacy projection (single function used by every endpoint that returns a profile)
```js
export function applyPrivacy(profile, viewer, { isMentee = false } = {}) {
  const owner = sameId(profile.user, viewer);
  const staff = ['admin','hod','principal','dean','chairman','ao'].includes(viewer.role);
  const hodOk = viewer.role !== 'hod' || profile.user?.department === viewer.department;
  const can = (level) => owner || level === 'public' ||
    (level === 'mentees' && (isMentee || (staff && hodOk))) ||
    (level === 'staff' && staff && hodOk);
  const out = { ...profile };
  for (const f of PRIVACY_FIELDS) {
    const level = profile.privacy?.[f] || DEFAULT_PRIVACY[f];
    const value = f === 'email' || f === 'phone' ? profile.user?.[f] : profile[f];
    if (!can(level)) { if (f === 'email' || f === 'phone') delete out.user?.[f]; else out[f] = undefined; }
    else if (f === 'email' || f === 'phone') out.user = { ...out.user, [f]: value };
  }
  out.privacyApplied = true; return out;
}
```
`isMentee` = exists `MentorshipRequest{student:viewer, alumni:profile.user, status ∈ [accepted, completed]}`; compute with ONE query for a whole page (`$in` over alumni ids) to avoid N+1. Never include `privacy` object, `alumniPrivateNotes`, `tokenHash` in responses to non-owners.

### 7.5 Jobs
- Poster must be a **verified** alumni (faculty/HOD/admin exempt).
- Auto-expire at `deadline` (sweeper sets `expired`).
- `applicationCount` maintained with `$inc` on apply/withdraw.
- A student cannot see applications of others; poster cannot see `withdrawn` unless filter requests it.
- Referral flow: student applies with `referralRequested:true` ⇒ poster marks `referred` (they submitted a referral internally) ⇒ later `shortlisted/rejected`. Students get a notification per transition.

### 7.6 Events
- Capacity/waitlist promotion on cancel is atomic (`findOneAndUpdate` on oldest `waitlisted` + `$inc` counters).
- Audience filter: user matches if each non-empty audience array contains the user's value (alumni → `gradYear`, others → department/role).
- Edit of `startsAt/venue/meetingLink` after publish ⇒ notify going + waitlisted, reset reminder flags.
- Completion: sweeper sets `completed` when `endsAt` passed.

### 7.7 Sessions
- Student can book only for an `accepted` request. One upcoming `confirmed` session per request.
- Reschedule/cancel allowed until 2 h before start; after that only alumni may cancel.
- `completed` requires `now ≥ scheduledAt`.

### 7.8 Chapters
- Batch chapter name pattern `Batch of <gradYear>`; department chapter `<Dept> Alumni`.
- Auto-join happens on verification (alumni) and on chapter creation backfill (verified alumni matching `gradYear`/`department`).
- Students: read public chapters only (no posting) — keeps the space alumni-led.

### 7.9 Request expiry & housekeeping
Sweeper (daily): pending requests with `expiresAt < now` ⇒ `expired` + notify student; expire jobs; expire invites; reconcile counts.

---

## 8. Notifications & realtime

### 8.1 Notification payloads (`type: 'alumni'`, `link` = web path; mobile maps 1:1)
| Trigger | Recipient | Title / message | link |
|---|---|---|---|
| Profile verified / rejected | alumni | "Alumni profile verified" / "…needs changes: <reason>" | `/alumni?tab=my_profile` |
| New unverified profile or re-verification needed | admin + HOD(dept) | "Alumni profile awaiting verification" | `/alumni?tab=verification` |
| Mentorship request created / responded / completed / cancelled / expired / rated | counterpart | as source + new states | `/alumni?tab=requests` |
| Session booked / rescheduled / cancelled / 24h & 1h reminders | both | "Mentoring session <date>" | `/alumni?tab=sessions` |
| Job posted | students of eligible departments | "New opportunity: <title> at <company>" | `/alumni/jobs/:id` |
| Application received / status changed | poster / student | | `/alumni/jobs/:id` |
| Event approved / rejected / cancelled / changed / reminders / waitlist promotion | organizer / attendees | | `/alumni/events/:id` |
| Chapter announcement | members (`push:false` if >200) | | `/alumni/chapters/:slug` |
| Invite claimed | importer | "<name> joined" (aggregate daily) | `/alumni?tab=admin` |

### 8.2 Socket events (server → client)
`alumni:request`, `alumni:request_updated` (existing, payload = populated request), plus new: `alumni:session`, `alumni:job`, `alumni:job_application`, `alumni:event`, `alumni:chapter_post` (to room `chapter:<id>`; clients emit `chapter:join` / `chapter:leave`, server verifies active membership before `socket.join`).

### 8.3 Client invalidation map (web `AppLayout.jsx` + mobile `_layout.js`)
```js
'alumni:request': ['MentorshipRequest'],
'alumni:request_updated': ['MentorshipRequest','AlumniProfile'],
'alumni:session': ['MentorshipSession','MentorshipSlot'],
'alumni:job': ['AlumniJob'],
'alumni:job_application': ['JobApplication','AlumniJob'],
'alumni:event': ['AlumniEvent'],
'alumni:chapter_post': ['ChapterPost'],
// and: if (notification.type === 'alumni') invalidate ['AlumniProfile','MentorshipRequest','AlumniJob','AlumniEvent','Chapter']
```

---

## 9. Schedulers (server-side, idempotent; single-instance safe via flags, multi-instance via a `findOneAndUpdate` claim)
| Job | Cadence | Action |
|---|---|---|
| `expireMentorshipRequests` | daily 02:00 | pending & `expiresAt<now` ⇒ `expired` |
| `reconcileMentorCounts` | daily 02:30 | recompute `activeMenteeCount` |
| `sessionReminders` | every 5 min | sessions in (24h±) / (1h±) without `reminder*SentAt` ⇒ notify both, set flag |
| `eventReminders` | every 5 min | same for going RSVPs |
| `expireJobs`, `completeEvents`, `expireInvites` | hourly | status updates |
Implement with `node-cron` (or `setInterval`) wrapped in try/catch; never throw into the process.

---

## 10. Analytics

Response of `GET /alumni/analytics`:
```json
{
  "generatedAt": "...",
  "totals": { "alumni": 0, "verified": 0, "unverified": 0, "verificationBacklogOldestDays": 0, "mentors": 0, "openToReferrals": 0 },
  "byGradYear": [{ "year": 2022, "count": 0 }],
  "byDepartment": [{ "department": "CSE", "count": 0 }],
  "topCompanies": [{ "company": "Google India", "count": 0 }],
  "topLocations": [{ "location": "Bengaluru", "count": 0 }],
  "mentorship": { "availableMentors": 0, "capacityUtilisation": 0.0, "requestsByStatus": {"pending":0,"accepted":0,"declined":0,"completed":0,"cancelled":0,"expired":0},
                  "acceptanceRate": 0.0, "medianResponseHours": 0, "avgRating": 0.0, "sessionsCompleted": 0, "topMentors": [{ "name":"", "avgRating":0, "completed":0 }] },
  "jobs": { "open": 0, "applications": 0, "referred": 0, "referralConversion": 0.0, "topSkills": [] },
  "events": { "upcoming": 0, "rsvps": 0, "attendanceRate": 0.0 },
  "chapters": { "count": 0, "members": 0, "postsLast7d": 0 },
  "engagement": { "weekly": [{ "week": "2026-W38", "requests": 0, "applications": 0, "rsvps": 0, "posts": 0 }] }
}
```
Implementation notes: use `$facet` for groupings on `AlumniProfile` ⋈ `User`; `capacityUtilisation = sum(activeMenteeCount)/sum(maxActiveMentees)` over `mentorshipAvailable` profiles; `medianResponseHours` from `respondedAt - createdAt` (sort + pick middle in app code); HOD scope applied as a `$match` on joined `User.department`. Cache for 60 s in memory. UI: stat tiles, bar charts (year/department/company), line chart (weekly engagement), ranked list (top mentors), "Verification backlog" card linking to the queue.

---

## 11. Web UI (React + Tailwind, host UI primitives)

Route `/alumni` (single page with `Tabs`, state in query string `?tab=`), sub-routes: `/alumni/:userId`, `/alumni/jobs/:id`, `/alumni/events/:id`, `/alumni/chapters/:slug`, public `/alumni/claim?token=`.

| Tab | Visible to | Contents |
|---|---|---|
| **Directory** | all | Search box + filters (department, grad year, domain, company, location, skill, "available for mentorship", "open to referrals"), sort; responsive card grid (avatar, verified shield, name, designation @ company, batch/dept, domain badges, ★ rating, capacity chip "2/3 mentees", "Request mentorship" button for students); pagination; empty/error/skeleton states; click ⇒ profile page |
| **Jobs** | all | Filters + list; "Post a job" modal (alumni/faculty/staff); detail page with Apply (note, resume upload, "request referral" toggle); "My applications" (student) / "My postings + applicants" (poster) with status select |
| **Events** | all | Upcoming/Past/My RSVPs/Pending (staff) segments; event card with date block, mode, spots left, RSVP/Cancel/Join-waitlist; detail page (agenda, venue, meeting link for going), organizer tools (edit, cancel, attendee list, check-in, CSV) |
| **Chapters** | all | Grid of chapters; chapter page: header, members, wall (composer for members, announcements pinned, like, comments), moderator menu |
| **Mentorship** | alumni, students | Student: "My requests" list with status chips, cancel, sessions (book/reschedule/cancel), goals checklist, rate modal, "Message mentor". Alumni: incoming requests (accept/decline modal with note), active mentees, slot manager (calendar/list, add recurring slots), session notes drawer |
| **My Profile** | alumni | Form (identity, work, mentorship settings, skills, headline/about) + **Privacy panel** (6 rows × 4-level select with live preview "As students see you"), completeness meter, verification banner (pending / rejected + reason) |
| **Verification** | admin, hod | Queue table (name, dept, batch, company, submitted date) with Verify / Reject (reason modal) |
| **Admin: Import & Invites** | admin, hod | 3-step wizard: Upload CSV (template download) → Preview table (valid/invalid/duplicate/exists counts, per-row errors, filter) → Confirm (send emails toggle) ; Invites table (status, sent count, resend, revoke, copy link) |
| **Analytics** | admin, hod, principal+ | Dashboard of §10 |
Shared: skeletons, optimistic toasts, accessible modals, role-gated tab list, URL-synced filters.

## 12. Mobile UI (Expo Router, host `ui.js` + `theme.js`)
Files under `mobile/src/app/(app)/alumni/`:
`index.js` (Segmented: Directory · Jobs · Events · Chapters · Mentorship · Profile; admin extras shown by role), `[id].js` (alumni profile), `jobs/[id].js`, `jobs/new.js`, `events/[id].js`, `events/new.js`, `chapters/[slug].js`, `sessions/index.js`, `sessions/book.js`, `admin/analytics.js`, `admin/verification.js`. 
- Lists use `FlatList` with pull-to-refresh and pagination; modals use RN `Modal` bottom sheets (as in source); date/time via `@react-native-community/datetimepicker`; resume/cover via `expo-image-picker`/`expo-document-picker` (install with `npx expo install`).
- **CSV import is web-only**; mobile shows invite status and verification queue read-only/actionable.
- Add an "Alumni Network" card on the Campus tab (exists) and make push `link` values (`/alumni/jobs/:id` …) resolve to these routes.
- Respect Expo Go limits (no remote push on Android Expo Go; socket updates still work).

## 13. Client state (RTK Query)
Tag types to add: `AlumniProfile, MentorshipRequest, MentorshipSlot, MentorshipSession, AlumniJob, JobApplication, AlumniEvent, Chapter, ChapterPost, AlumniInvite, AlumniImport, AlumniAnalytics`.
Endpoint names (hooks auto-generated): `getAlumni, getAlumniFilters, getAlumniProfile, getMyAlumniProfile, upsertAlumniProfile, verifyAlumniProfile, rejectAlumniProfile, getMentorshipRequests, createMentorshipRequest, respondMentorshipRequest, cancelMentorshipRequest, completeMentorship, rateMentorship, updateMentorshipGoals, getSlots, createSlots, deleteSlot, bookSession, getSessions, rescheduleSession, cancelSession, completeSession, updateSessionNotes, getAlumniJobs, getAlumniJob, createAlumniJob, updateAlumniJob, closeAlumniJob, removeAlumniJob, applyToJob, getJobApplications, getMyApplications, updateApplication, withdrawApplication, getAlumniEvents, getAlumniEvent, createAlumniEvent, updateAlumniEvent, approveAlumniEvent, rejectAlumniEvent, cancelAlumniEvent, rsvpEvent, cancelRsvp, getAttendees, checkInAttendee, getChapters, getChapter, createChapter, joinChapter, leaveChapter, getChapterPosts, createChapterPost, likePost, getComments, addComment, pinPost, deletePost, previewImport, commitImport, getImports, getInvites, resendInvite, revokeInvite, getAlumniAnalytics`.
Invalidation: each mutation invalidates its own tag plus related (`bookSession` ⇒ `MentorshipSlot, MentorshipSession, MentorshipRequest`; `applyToJob` ⇒ `AlumniJob, JobApplication`; `rsvpEvent` ⇒ `AlumniEvent`).

## 14. Seed data (`seedAlumniNetwork()`; never run in production)
- Keep the 3 source alumni (Karthik/Google, Pooja/Qualcomm, Aravind) + add 5 more across departments/years, 1 unverified, 1 with privacy `email:'hidden'`.
- 2 mentorship requests (pending, completed+rated), 6 open slots, 1 confirmed session.
- 4 jobs (full-time, internship, external link, expired), 3 applications in different states.
- 3 events (upcoming reunion, webinar with capacity 2 + waitlist, pending approval).
- Chapters: `Batch of 2022`, `CSE Alumni`, `Bengaluru Alumni` with 6 posts.
- 1 import batch + 3 invites (pending/claimed/expired).

## 15. Test plan (server `node:test`, same harness `startServer/createUser/loginWeb`)
1. Profile: only alumni can PUT; whitelist enforced; gradYear/company change ⇒ unverified; `maxActiveMentees < activeMenteeCount` ⇒ 409; privacy validation.
2. Directory: unverified hidden; filters; search by name; `mentorshipAvailable` excludes full mentors; HOD sees only own-department unverified; privacy projection hides email/phone for non-mentees and reveals to accepted mentee, staff, owner.
3. Verification: HOD cross-department ⇒ 403; reject requires reason; notification created (**asserts `Notification` actually persisted — guards defect #1**).
4. Mentorship: duplicate pending 409; pending cap; accept twice ⇒ 409 (no double increment); concurrent accepts at capacity 1 ⇒ exactly one succeeds; decline-after-accept ⇒ 409; cancel-from-accepted decrements; complete → rate once; rating bounds; expiry sweeper.
5. Slots/sessions: past slot rejected; overlap rejected; two students book same slot concurrently ⇒ one 409; reschedule frees old slot; private notes never leak to student; <2h cancel rule.
6. Jobs: non-verified alumni 403; external link validation; deadline; apply twice 409; withdraw/re-apply; poster-only application list; student eligibility; removal by staff requires reason.
7. Events: approval flow; audience mismatch 403; capacity ⇒ waitlist; cancel promotes first waitlisted; meeting link hidden before RSVP; check-in window.
8. Chapters: private join approval; student cannot post; announcement only moderators; like toggle idempotent; soft delete.
9. Import/invites: preview writes no users; invalid/duplicate/exists classification; HOD limited to own department; commit idempotent; token stored hashed; expired/used/revoked token ⇒ 404; claim creates user+profile verified (flag) and issues session; rate limit.
10. Analytics: HOD scoping; numbers match seed; non-privileged ⇒ 403.
11. Regression: run the host's full existing test suite — must remain green.
Client: component tests optional; manual QA checklist in §17.

## 16. Known defects in the source module — DO NOT replicate
1. **`'alumni'` is missing from `NOTIFICATION_TYPES`** (a comment says "append" but the array was never updated). `Notification.insertMany` fails enum validation and `notifyUsers` swallows the error ⇒ **no alumni notifications are ever stored or pushed**. Append `'alumni'` and assert it in tests.
2. `respondToRequest` never checks `status === 'pending'`: an already-accepted request can be accepted again (double increment) or declined after acceptance (capacity never released). Use §7.2.
3. Capacity check + increment are two separate operations (race). Use the single guarded `findOneAndUpdate`.
4. `activeMenteeCount` can drift; add reconcile job (§9).
5. Directory route declares validators for `department` and `search`, but the controller ignores both ⇒ filters silently do nothing. Implement them.
6. `company` filter builds `new RegExp(userInput)` without escaping (regex injection / ReDoS). Use `escapeRegex`.
7. Validator/model mismatches: route `gradYear` 1980–2030 vs model 1990–2100; route `maxActiveMentees` min 1 vs model/controller min 0. Make one source of truth.
8. Students cannot cancel a request; pending requests never expire.
9. `GET /mentorship-requests` treats every non-alumni role (including admin/HOD) as a student and filters by `student=self`, so staff see nothing. Add scoped staff view.
10. `rating`/`review` aggregation runs on every directory/profile fetch; cache `ratingAvg/ratingCount` on the profile.
11. Alumni cannot hide contact data or opt out of the directory (added in this spec).

## 17. Build order, acceptance checklist & rollout

**Phase 0 – Foundations:** constants (+`'alumni'` notification type), env vars, base models (`AlumniProfile`, `MentorshipRequest`), router skeleton, privacy projection util, tests scaffold.
**Phase 1 – Core (parity with source + fixes):** profile, directory (search/facets), verification/reject, mentorship lifecycle with atomic capacity, cancel/expiry, notifications/socket, web + mobile UI for these, seed, tests §15.1–4.
**Phase 2 – Privacy UI & profile detail page.**
**Phase 3 – Mentorship sessions:** slots, booking, reschedule, notes, goals, reminders, message-mentor link.
**Phase 4 – Jobs & referrals.**
**Phase 5 – Events & reunions.**
**Phase 6 – Chapters.**
**Phase 7 – Bulk import & invites** (CSV parser dep: `csv-parse`; multer already in host for uploads).
**Phase 8 – Analytics + exports.**
**Phase 9 – Hardening:** rate limits, indexes (`explain()` on directory/jobs), pagination caps, a11y pass, docs.

**Acceptance checklist**
- [ ] No existing host feature/route/test changed; full host test suite green.
- [ ] Every endpoint: validation, role + ownership checks, HOD department scoping, pagination caps.
- [ ] Notifications persisted (type `alumni`) and delivered over socket/push for every trigger in §8.1.
- [ ] Privacy projection applied on every response that includes alumni data; private notes/token hashes never leaked.
- [ ] All concurrency-sensitive writes (capacity, slot booking, RSVP) use guarded atomic updates.
- [ ] Schedulers idempotent; failures logged, never crash the server.
- [ ] Web and mobile screens implement every tab in §11/§12 with loading, empty, error states; works in Expo Go.
- [ ] Seed script produces a demo-ready dataset; demo accounts documented in README.
- [ ] `.env.example`, README section and API table updated.