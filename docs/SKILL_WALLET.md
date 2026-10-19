# Skill Wallet

The Skill Wallet holds each student's project portfolio, NPTEL certificates and profile links. It also provides team invitations by roll number, a faculty review workspace, the Innovation Gallery, and Innovation Management for IIC coordinators.

It is part of the existing VEXON stack. It reuses VEXON's authentication, RBAC, CSRF/origin checks, notification service, audit log, transactions and HTTP helpers. It does **not** add a second auth or permission system.

---

## 1. Architecture and files

| Layer | Files |
|---|---|
| Routes | `server/src/routes/skillWalletRoutes.js`: main router `/api/skill-wallet/*` (after `protect`); public router for the published gallery and signed file downloads (before `protect`) |
| Controllers | `server/src/controllers/skillWallet/`: `projectController`, `teamController`, `publicationController`, `galleryController`, `certificationController`, `linkController`, `reviewController`, `managementController`, `fileController` |
| Services | `server/src/services/skillWallet/`: `access.js` (every authorization rule), `projects.js` (input parsing, views), `imagePipeline.js` (validation and conversion), `assets.js` (private assets, signed URLs, orphan sweep), `urls.js` (URL validation), `config.js` (domains, institutions, rubric), `notify.js` |
| Private storage | `server/src/utils/privateStorage.js`, `server/src/models/PrivateFile.js` |
| Models | `InnovationProject`, `ProjectRevision`, `TeamMembership`, `TeamInvitation`, `SkillWalletAsset`, `ProjectReview`, `ProjectPublicationEvent`, `InnovationRecommendation`, `ProjectMilestone`, `ProjectInteraction` (likes, comments, reports, contact requests), `NptelCertification` (and `HallTicketClaim`), `CertificationReview`, `ProfileLink`, `SkillWalletConfig`, `SkillWalletDesignation` |
| Web | `client/src/services/skillWallet.js` (RTK Query plus XHR uploads with progress), `client/src/utils/skillWallet.js` (form rules), `client/src/pages/skillwallet/*` |
| Android | `mobile-kotlin/.../screens/SkillWallet.kt` (projects: view and create; invitations: accept and decline), route table, Campus menu, push allow-list |
| Tests | `server/tests/skill-wallet-*.test.js`, `client/tests/skillWallet.test.mjs`, `mobile-kotlin/app/src/test/.../SkillWalletTest.kt` |

Existing infrastructure reused:
- `notifyUsers`: stored notification, Socket.io, FCM push.
- `logAudit`: the append-only AuditLog. Nine new `SKILL_WALLET_*` actions were added.
- `logActivity`, `withTransaction`, `utils/cipher.js` (hall-ticket encryption), and the `ApiError`/`asyncHandler`/`paginate` helpers.
- `express-rate-limit`.
- The existing guard chain: `protect` → platform gate → password-change gate → `confinedRoleGuard` → `adminPolicyGuard`.

## 2. Roles and permissions

| Who | Can do |
|---|---|
| Student / club admin | Own projects, certificates and links. Invite teammates and answer invitations. Choose the publication audience (owner). Give or withdraw public-publication consent (member). Like, comment, report and send contact requests. |
| Other college roles (faculty, HOD, principal, dean, AO, chairman, legacy admin) | View the college-only and public gallery; like, comment, report and send contact requests. |
| HOD | Review projects in their own department, and verify certificates in their own department. |
| Class In-Charge (faculty) | Verify certificates for their own class. |
| COE | Verify certificates campus-wide. The COE reaches only the certificate-verification routes; everything else stays deny-by-default in `coeGuard`. |
| `project_reviewer` designation | Review projects assigned to them, or every project in their scope. |
| `certificate_verifier` designation | Verify certificates in their scope. |
| `innovation_coordinator` designation | Assign reviewers, review, track recommendations, verify milestones, moderate (hide/unhide, resolve reports). A campus coordinator can also edit domains, institutions and the rubric. |
| Principal | Grant and revoke designations, but cannot grant any designation to themselves. The Principal role alone does **not** give review, verification, publication or moderation rights. |
| Super Admin, policy-managed admins, Security, Warden, Office, Transport, Alumni | No Skill Wallet access. Super Admin and policy-managed admins are refused by the existing guards, and none of these roles is added to them. |

**Nobody can publish a student's project except its owner.** Coordinators can only hide content temporarily. Approval never publishes.

## 3. Project lifecycle

1. **Create.** Required fields: title, domain, description, stage and start date. A project is always created `private` at revision 1.
   - `developing`: no end date. The API rejects an `endedAt` and stores `null`.
   - `implemented`: an end date is required. It cannot be before the start date or in the future.
   - Switching back to `developing` clears the end date. Every one of these checks runs on the server.
   - GitHub links must be `https://github.com/owner/repo`. Drive links must be on `drive.google.com` or `docs.google.com` over HTTPS. The server rejects `javascript:`, `data:`, `http:`, embedded credentials, IP addresses, localhost and look-alike hosts. Links are stored, never fetched.
2. **Edit.**
   - A change to a material field (everything except skills) creates a new revision and a `ProjectRevision` record.
   - It also cancels any pending public request, and an approved review drops back to `draft` for the new revision.
   - Edits use optimistic concurrency, so an edit based on stale data returns 409.
3. **Submit for review** (owner only). This queues the current revision.
4. **Review.** A reviewer scores the configurable rubric (0–10 per criterion, weighted), writes feedback and optional internal notes, and decides: approve, request changes or reject (reject needs a reason).
   - They may also recommend funding or IIC/incubation.
   - Each review is tied to the exact revision and rubric version.
   - Students see feedback and reasons, never internal notes.
   - A funding recommendation is only a note to coordinators.
   - If another reviewer rejects or requests changes to a revision that was already approved, the approval, its faculty score and any pending public request are withdrawn. A copy that was already published stays published (an open policy question; see the 2026-10 audit report).
5. **Publication** (section 6) is a separate, explicit step by the owner.

## 4. Team invitations

- The owner of a **team** project enters a roll number. The server looks it up among **active student** accounts only. Unknown, staff, alumni and inactive accounts all get the same 404, so the lookup can't be used to find out what kind of account a roll number belongs to.
- The response shows only the invitee's name, title, department and year.
- The invitation stores the project, inviter and invitee IDs, and expires after `SKILL_WALLET_INVITE_EXPIRY_DAYS` (14 by default).
- A unique partial index allows only one pending invitation per project and invitee. Self-invitations are refused.
- A pending invitation grants **no** access. Only an active `TeamMembership` does.
- Only the invitee can accept or decline. Other students get 404.
- Accept and decline are conditional updates on `status: 'pending'`, which makes them idempotent and safe under races:
  - A repeated accept answers 200 with `alreadyAccepted`.
  - If accept and decline race, exactly one wins.
- Acceptance claims a team seat with a conditional `$inc` on `memberCount` (team size is capped by `SKILL_WALLET_MAX_TEAM_SIZE` and counts pending invitations), then creates the membership inside `withTransaction`. On a standalone mongod there are no transactions, so the code rolls the claim back by hand.
- The inviter or owner can cancel a pending invitation. Expired invitations answer 410.
- Ownership rules:
  - The owner can remove members and transfer ownership to an active student member, which cancels pending invitations.
  - The owner cannot leave without transferring ownership first. Any member can leave.
- If a new member joins a **public** project, it drops to college-only until everyone confirms again, because the new member never consented to being listed publicly.
- Notifications go through `notifyUsers` with generic text: no project title, roll number or other private detail appears in push payloads.

## 5. NPTEL certificates

- Fields: hall ticket, course name, start and end dates, duration in weeks (1–24), credits (0–20 in steps of 0.5), and institution. The institution list is configurable and includes "Other / not listed" with a free-text name.
- The student ID always comes from the session, never from the request body.
- **Hall ticket privacy:**
  - Stored encrypted (AES-GCM via `utils/cipher.js`) together with a keyed HMAC used for duplicate detection.
  - Only the last 4 characters are kept in clear text, for the masked display.
  - The full number appears only to the student (detail view) and to an authorized verifier.
  - It never appears in the portfolio, gallery, notifications, logs or public responses.
- `HallTicketClaim` ties a hall ticket to one student. A second student using the same number gets 409. The same student cannot add the same course twice.
- **Verification is manual.** No official NPTEL verification API is configured, so none is invented. A verifier compares the certificate image with the hall ticket and the student's record and decides `verified`, `correction_requested` (with a reason) or `rejected` (with a reason).
  - Uploading never verifies anything.
  - Decisions are conditional updates on `pending`, so only one of two concurrent decisions is accepted.
  - Each decision must send the certificate `version` (from the verifier detail view). If the student edited the certificate after the verifier opened it, the decision answers 409, so a verifier can never approve an image they did not see.
  - Every decision is written to `CertificationReview` and to the audit log.
  - A student can edit a certificate only while it is `pending` or `correction_requested`; editing sends it back to `pending`.
- **Known limitation:** VEXON's student records have no hall-ticket field, so the server cannot check the number against the college record automatically. The manual verifier is the control. If the college later stores hall tickets, add the comparison in `createCertification` (`parseCertInput`).

## 6. Image validation and WebP conversion

The logic lives in `services/skillWallet/imagePipeline.js`.

**NPTEL certificates** (strict policy):
1. Multer reads the upload into memory, capped at `SKILL_WALLET_CERT_MAX_MB` (413 if larger).
2. The real file signature (magic bytes) is checked. Only PNG, JPEG and WebP pass. The file extension and the browser's MIME type are ignored.
3. sharp decodes the image with `limitInputPixels`, using `failOn: 'error'`. The decoded format must match the signature. Animated images, images above the pixel or dimension limits (decompression-bomb shapes), images below the minimum size, and truncated or corrupt data are all rejected.
4. **Every** accepted image is re-encoded to WebP, including uploads that are already WebP. EXIF orientation is applied and metadata and ICC profiles are stripped.
5. The output is checked again: it must have a RIFF/WEBP signature and sharp must decode it as `webp`.
6. It is stored under a server-generated key ending in `.webp`, with content type `image/webp`.
7. **On any failure:** the original is never stored, the hall-ticket claim is released, and the partial file is removed. The client gets a safe message with a code (`UNSUPPORTED_FORMAT`, `CORRUPT_IMAGE`, `IMAGE_TOO_LARGE`, and so on). Only sanitized diagnostics are logged.

**Project images:** the same validation runs, but the image is re-encoded in its own format (PNG, JPEG or WebP) with metadata stripped. Project images are **not** forced to WebP.

## 7. Publication and privacy

| State | Who sees it |
|---|---|
| Private (default) | Active team members and authorized reviewers/coordinators. Drafts that were never submitted are not visible even to coordinators. |
| College-only | Signed-in college roles (`SKILL_WALLET_COLLEGE_ROLES`). |
| Public | Anyone, through `/api/skill-wallet/public/*` and the `/gallery` web page. |

- The gallery shows a **published snapshot** (`project.published`), never the live record. Edits reach the gallery only when the owner publishes again.
- **College-only** is the owner's explicit choice.
- **Public** requires all of the following:
  1. Faculty approval of the *current* revision.
  2. The owner's explicit `confirmPublic: true`.
  3. Consent from every active member for that revision.
  4. The project is not hidden by a moderator.
- Approval never changes visibility.
- Unpublishing (to private or college-only) takes effect immediately. If any member withdraws consent, a public project drops to college-only.
- Moderators can hide a project or comment, with a reason. Hidden projects disappear from the gallery, search, leaderboards, interactions and file downloads, but the team still sees its project and the reason. Moderation actions are audited.
- Every gallery, leaderboard, portfolio and file endpoint applies the same visibility filter.
- Public responses never include user IDs, roll numbers, emails, hall tickets, invitations, reviewer notes or the live (unpublished) revision.
- **Leaderboards** use two separate, documented criteria:
  - Faculty evaluation: the mean weighted rubric score of approving reviews of the published revision.
  - Community popularity: `likes + 2 × comments`.
  - Popularity is labelled as engagement, not merit.
- Contact requests share the owner's college email only after the owner accepts.

## 8. File storage

- Skill Wallet files **never** go to the public `/uploads` directory or to Cloudinary.
- The private store is either disk (`SKILL_WALLET_PRIVATE_DIR`, default `server/private-uploads/`, git-ignored) or MongoDB (`PrivateFile`). MongoDB is the default in production, because hosted disks are wiped on deploy.
- Storage keys are random UUIDs (`sw/<uuid>.<ext>`). Writes go to a temporary file first and are then renamed.
- Downloads use short-lived URLs (`SKILL_WALLET_ASSET_URL_MINUTES`) that are HMAC-signed and bound to one viewer: `/api/skill-wallet/files/<token>`.
  - Authorization is checked **again** when the file is downloaded, so knowing an asset ID or holding an old URL is not enough.
  - A public URL works only for the image of a currently published public snapshot. It stops working when the project is unpublished.
  - Responses send `Cache-Control: private, no-store`, `nosniff` and a restrictive CSP. Every refusal is a 404.
- An hourly job (`skill_wallet.orphan_sweep`) removes project images that were uploaded but never attached (after `SKILL_WALLET_ORPHAN_ASSET_HOURS`) and any leftover partial writes. Replaced or deleted images are removed when nothing references them any more.

## 9. API

All routes are under `/api/skill-wallet`. Mutations require authentication, pass the existing CSRF/origin guard and are rate-limited per user.

| Area | Routes |
|---|---|
| Config | `GET /config` · `PUT /config` (campus coordinator) |
| Projects | `GET/POST /projects` · `GET/PUT/DELETE /projects/:id` · `GET /projects/:id/history` · `POST /projects/:id/submit` · `POST /projects/:id/withdraw` · `POST /projects/:id/milestones` · `POST /assets/project-image` |
| Team | `GET /projects/:id/team` · `POST /projects/:id/invitations` · `POST /projects/:id/team/leave` · `POST /projects/:id/team/transfer` · `DELETE /projects/:id/team/:userId` · `GET /invitations` · `POST /invitations/:id/accept` · `POST /invitations/:id/decline` · `DELETE /invitations/:id` |
| Publication | `GET/PUT /projects/:id/publication` · `POST /projects/:id/publication/consent` |
| Gallery | `GET /gallery` · `GET /gallery/:id` · `GET /leaderboard` · `POST /projects/:id/like` · `GET/POST /projects/:id/comments` · `DELETE /comments/:id` · `POST /projects/:id/report` · `POST /projects/:id/contact` · `GET /contact-requests` · `POST /contact-requests/:id/respond` · `GET /portfolio/me` · `GET /portfolio/:userId` |
| Public (no session) | `GET /public/gallery` · `GET /public/gallery/:id` · `GET /public/leaderboard` · `GET /files/:token` |
| NPTEL | `GET/POST /certifications` · `GET/PUT/DELETE /certifications/:id` |
| Links | `GET/POST /profile-links` · `PUT/DELETE /profile-links/:id` |
| Review | `GET /review/me` · `GET /review/queue` · `GET /review/projects/:id` · `POST /review/projects/:id/reviews` · `GET /review/certifications` · `GET /review/certifications/:id` · `POST /review/certifications/:id/decision` |
| Management | `GET /management/overview` · `GET /management/projects` · `GET /management/staff` · `PUT /management/projects/:id/reviewers` · `POST /management/projects/:id/hide` · `POST /management/projects/:id/unhide` · `GET/PATCH /management/recommendations[/:id]` · `GET/PATCH /management/milestones[/:id]` · `GET/PATCH /management/reports[/:id]` · `GET/POST /management/designations` · `DELETE /management/designations/:id` |

Listings are paginated with `page`. The server sets owner, reviewer and verifier IDs, statuses and permissions; it never accepts them from the client.

## 10. Environment variables

These are listed in `server/.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `SKILL_WALLET_PRIVATE_STORAGE` | `disk` in development, `db` in production | Private file store |
| `SKILL_WALLET_PRIVATE_DIR` | `private-uploads` | Folder for the disk store |
| `SKILL_WALLET_ASSET_URL_SECRET` | derived from the access-token secret | Signing key for file URLs. **Set a separate random value in production.** |
| `SKILL_WALLET_ASSET_URL_MINUTES` | 10 | How long a signed file URL stays valid |
| `SKILL_WALLET_CERT_MAX_MB` / `SKILL_WALLET_IMAGE_MAX_MB` | 5 / 5 | Upload size limits |
| `SKILL_WALLET_MAX_IMAGE_PIXELS` / `SKILL_WALLET_MAX_IMAGE_DIMENSION` / `SKILL_WALLET_MIN_IMAGE_DIMENSION` | 40 M / 8000 / 64 | Decode limits |
| `SKILL_WALLET_WEBP_QUALITY` | 85 | WebP quality for certificates |
| `SKILL_WALLET_INVITE_EXPIRY_DAYS` / `SKILL_WALLET_MAX_TEAM_SIZE` / `SKILL_WALLET_ORPHAN_ASSET_HOURS` | 14 / 8 / 24 | Team rules and cleanup |
| `SKILL_WALLET_WRITE_LIMIT`, `_UPLOAD_LIMIT`, `_INVITE_LIMIT`, `_COMMENT_LIMIT`, `_CONTACT_LIMIT`, `_PUBLIC_LIMIT` | 60/min, 20/10 min, 20/10 min, 20/5 min, 10/h, 300/min per IP | Rate limits. All are per user except `_PUBLIC_LIMIT`. |

The server needs the `sharp` dependency, which is already in `server/package.json`.

## 11. Tests

```bash
cd server
node --test --test-concurrency=1 tests/skill-wallet-nptel.test.js        # image pipeline, WebP bytes, hall tickets, verification
node --test --test-concurrency=1 tests/skill-wallet-projects.test.js     # validation, dates, URLs, visibility, review, gallery, links, config
node --test --test-concurrency=1 tests/skill-wallet-invitations.test.js  # roll-number invitations, races, team rules, consent
node --test --test-concurrency=1 tests/security-audit-skill-wallet.test.js  # 2026-10 audit regressions (SW-1..3)
npm test                                                                 # whole backend suite
cd ../client && npm test && npm run build
cd ../mobile-kotlin && ./gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease
```

The backend tests need a local MongoDB. They use the `cmp_test` database, or `TEST_MONGO_URI`, whose database name must end in `_test`. The fixtures write private files to a temporary folder and raise the write/invite rate limits for the test process only.

## 12. Known limitations and required configuration

- **Push delivery** uses the existing FCM integration and works only where `FIREBASE_*` credentials are configured. In-app and Socket.io notifications work without FCM. Push delivery was not tested end to end in development.
- **No automatic hall-ticket check** against college records, and **no NPTEL API**. Verification is manual (see section 5).
- **Transactions:** on a standalone mongod, invitation acceptance falls back to conditional updates with manual rollback. Use a replica set in production, as recommended for VEXON as a whole.
- **iOS** (`mobile-ios`, SwiftUI) was not changed: it cannot be built or tested on the Windows development machine. Students use the web there.
- **Android** covers projects (view and create, without an image), invitations (accept and decline) and notification routing. NPTEL uploads, editing, publication and the staff workspaces are web-only.
- Gallery search uses escaped regular expressions. A MongoDB text index may be needed at large scale.
