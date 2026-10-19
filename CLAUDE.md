# VEXON SKILL WALLET — COMPLETE IMPLEMENTATION PROMPT

## ROLE

Act as a senior full-stack engineer, security engineer, database architect, UI/UX designer, and test engineer working on the existing VEXON college platform.

Implement a complete, production-minded **Skill Wallet** feature integrated into the existing VEXON application.

Do not create a separate application. Do not assume file paths, APIs, models, roles, notification services, or storage providers exist without inspecting the repository first.

The existing project may contain:
- React + Vite frontend
- Redux Toolkit / RTK Query
- Node.js + Express backend
- MongoDB + Mongoose
- Existing authentication, role-based access control, notifications, audit logging, and file storage
- Native Kotlin Android application
- Native Swift / SwiftUI iOS application

Verify the actual repository before deciding how to integrate each part.

## 1. FIRST: INSPECT THE REPOSITORY

Before changing code:

1. Read the project documentation, repository instructions, architecture documents, and relevant package manifests.
2. Inspect the existing frontend routes, sidebar, design system, API services, and authentication flow.
3. Inspect backend route registration, controllers, models, middleware, authorization helpers, and error handling.
4. Inspect the existing notification system and Android/iOS notification integration.
5. Inspect file upload and storage utilities, including image-processing dependencies.
6. Inspect the existing Super Admin, faculty, student, audit-log, and policy implementations.
7. Identify existing test commands and patterns.
8. Discover relevant skills, MCP integrations, and connected tools available in the current environment. Use only relevant, authorized integrations. Do not install unrelated packages or plugins.
9. Create an implementation plan based on actual findings, then proceed without waiting for approval after each ordinary step.

Reuse existing infrastructure wherever practical. Avoid duplicate authentication, permission systems, notification services, and file-storage implementations.

Do not overwrite unrelated user changes. Do not commit, push, deploy, migrate production data, or modify production infrastructure.

## 2. SKILL WALLET NAVIGATION

Add a clearly named **Skill Wallet** section to the appropriate student dashboard/navigation.

Provide these main areas:

1. My Projects
2. NPTEL Certifications
3. Links & Profiles
4. Team Invitations
5. My Achievements / Portfolio
6. Faculty Review Workspace, for authorized faculty
7. Innovation Gallery
8. Innovation Management, for authorized innovation/IIC coordinators

Follow the existing VEXON design system, responsive layout, navigation conventions, loading states, empty states, error handling, and accessibility standards.

Do not create a second student authentication system.

## 3. MY PROJECTS

Students can create and manage their project portfolio.

### Required project fields

- Project title — required
- Project domain — required
- Project description — required
- Skills learned — multiple values/tags
- Development stage — `developing` or `implemented`
- Started date — required
- Ended date — required only when the project is implemented
- Project image
- GitHub repository URL — optional
- Google Drive project URL — optional
- Project mode — `solo` or `team`
- Project owner
- Team members and invitation states
- Creation and modification timestamps
- Project revision/version information
- Visibility and publication state
- Review state where applicable

### Project domains

Provide configurable options such as:
- Web Development
- App Development
- AI / Machine Learning
- Data Science
- Cybersecurity
- IoT / Hardware
- Cloud / DevOps
- Blockchain
- Social Innovation
- Other

Allow authorized configuration changes without hardcoding the entire domain list throughout the code.

### Conditional date behavior

If the student selects `developing`:
- Show the start date.
- Hide the end-date field.
- Store `endedAt` as null.
- Reject an end date submitted through a direct API request.

If the student selects `implemented`:
- Show the end-date field.
- Require an end date.
- Validate that the end date is not earlier than the start date.

If an implemented project is changed back to developing, clear its end date and validate the transition on the server.

Do not rely on frontend validation alone.

### Project image

Provide a proper image picker, upload progress, preview, retry, and clear error messages.

Use the existing secure upload infrastructure. Validate image content, MIME type, file signature, dimensions, and size on the server. Store files using safe generated identifiers rather than user-provided filenames.

Do not automatically convert every Skill Wallet file to WebP. The specific WebP-only storage requirement below applies to NPTEL certificate images.

### Project links

Validate GitHub and Google Drive URLs. Reject malformed or unsafe schemes, including `javascript:` and `data:`. Do not fetch or execute submitted URLs automatically.

Google Drive links are optional. Never assume a private Drive URL is publicly accessible, and warn students to check sharing permissions.

### Project modes

Allow students to select:
- Solo project
- Team project

A solo project should not contain accepted team members. A team project must have a valid owner and accepted membership records.

## 4. TEAM INVITATIONS BY COLLEGE ROLL NUMBER

Students must be able to invite teammates by entering their college roll number.

### Invitation workflow

1. Student A creates a team project.
2. Student A enters Student B's roll number.
3. The backend resolves the roll number against the existing student directory.
4. Validate that the target is an eligible student account.
5. Create a pending invitation associated with the internal user ID, project ID, inviter ID, and invitee ID.
6. Send an in-app notification through the existing VEXON notification system.
7. If supported, deliver a push notification using the existing Android/iOS notification infrastructure.
8. Student B opens the invitation and sees the project title, inviter, invitation details, and Accept / Decline actions.
9. Acceptance is processed by an authenticated, authorized backend endpoint.
10. On acceptance, add Student B to the project's accepted membership list and update the invitation state.
11. On decline, retain the invitation outcome without creating membership.
12. Notify Student A of the result.

### Invitation requirements

- Roll number alone must never grant membership.
- Do not expose another student's private profile details when resolving a roll number.
- Prevent duplicate pending invitations.
- Prevent self-invitations and invitations to ineligible accounts.
- Only the intended invitee can accept or decline.
- Only the authorized inviter/owner can cancel a pending invitation.
- Make acceptance and decline idempotent and race-safe.
- Use transactions or safe conditional updates where supported.
- Handle expired, cancelled, already accepted, and already declined invitations.
- Pending invitations must not grant project access.
- Store timestamps and invitation history.
- Avoid leaking private project details in notification payloads.
- Define and enforce team-owner transfer and member-removal rules.

Do not create fake notifications. Connect to the actual existing service and document any infrastructure that cannot be tested locally.

## 5. NPTEL CERTIFICATIONS

Add an NPTEL Certifications section inside My Skill Wallet.

### Required fields

- Hall ticket number
- Course name
- Course start date
- Course end date
- Course duration in weeks
- Course credits
- Course-offering institution, such as IIT Madras or IIT Kharagpur
- Certificate image
- Student ID associated with the authenticated account
- Verification status
- Verification history
- Created/updated timestamps

### Institution field

Provide common choices where appropriate, but allow a configurable `Other / not listed` option.

Do not assume that every NPTEL course is offered by the same institute. The institution field should be extensible.

### Hall ticket validation

Use the authenticated student's existing college record where possible. Validate that the submitted hall ticket number belongs to that student.

Do not trust the client-supplied student ID. Do not expose hall ticket numbers in public profiles, gallery cards, logs, notifications, or public API responses.

### Certificate verification

Use a workflow such as:
- Pending verification
- Verified
- Correction requested
- Rejected

Authorized faculty/examination staff must be able to review a certificate, record a decision, provide a reason, and maintain review history.

Uploading a certificate must not automatically make it verified.

Do not invent an external NPTEL verification API. If no official integration is configured, provide a documented manual verification workflow.

## 6. CRITICAL: NPTEL IMAGE VALIDATION AND WEBP CONVERSION

This requirement is mandatory.

### Accepted input formats

Accept certificate image uploads only when the image is genuinely one of:
- PNG
- JPEG (`.jpg` or `.jpeg`)
- WebP (`.webp`)

Reject:
- PDF
- SVG
- GIF
- HEIC / HEIF
- BMP
- TIFF
- Other unsupported formats

Do not allow the file extension or browser-provided MIME type to determine acceptance by itself.

### Server-side conversion

Use a trusted server-side image-processing library such as `sharp`, if compatible with the repository.

For every NPTEL certificate image:

1. Enforce configured upload-size and pixel-dimension limits.
2. Inspect the actual file signature and decode the image.
3. Accept only actual PNG, JPEG, or WebP image content.
4. Reject malformed, corrupted, unsupported, or decompression-bomb-like inputs.
5. Re-encode every accepted image to WebP on the server, including uploads already in WebP format.
6. Strip unnecessary metadata and embedded profiles where appropriate.
7. Generate a safe server-controlled filename or storage key ending in `.webp`.
8. Store only the converted WebP output as the canonical certificate image.
9. Persist the correct `image/webp` content type and safe storage reference.
10. Clean up temporary files and partial uploads on success and failure.

### Strict failure handling

If validation or conversion fails:
- Do not save the original file as a fallback.
- Do not mark the certificate submission complete.
- Clean up temporary files and partial storage objects.
- Return a safe, understandable error message.
- Log only sanitized diagnostic details.

A successful upload must result in a real, decodable WebP image, not just a renamed file.

Add automated tests that inspect the resulting bytes and verify that the stored output is actually WebP.

Apply this strict format policy specifically to NPTEL certificate images. Project images and other files should follow their own documented upload rules.

## 7. LINKS & PROFILES

Create a reusable Links & Profiles section.

Students must be able to add:
- GitHub
- LinkedIn
- HackerRank
- LeetCode
- TryHackMe
- Hack The Box
- Personal portfolio
- Kaggle
- Codeforces
- Other custom platforms

### Link fields

- Display/platform name
- URL
- Optional description
- Visibility: private, college-only, or public
- Created/updated timestamps

Allow multiple links and allow the student to edit or remove their own links.

For custom platforms, require a non-empty display name.

Validate URLs using a real URL parser, allow HTTPS by default, reject unsafe schemes, and apply sensible domain validation. Avoid overly restrictive URL rules that reject legitimate profile URL formats.

Do not fetch links automatically from the server. Open external links safely with appropriate browser protections.

Do not claim a profile, skill, achievement, or account has been verified simply because a URL was entered.

## 8. INNOVATION GALLERY AND PUBLICATION CONTROLS

Implement the Innovation Gallery using the following privacy policy.

### Default visibility

All new projects start private.

Project submission and publication are separate operations. Faculty approval must never automatically publish a project.

### Visibility states

- Private
- College-only
- Public

### Rules

- Private projects are accessible only to authorized project members and authorized reviewers.
- College-only projects are visible only to authenticated, eligible college users within the configured access scope.
- Public projects are visible to internet visitors only after explicit publication authorization and any required consent.
- College publication and public publication require separate explicit choices.
- A team project should require owner consent and confirmation from listed contributors before public publication, according to the defined institutional policy.
- Students must be able to request unpublishing.
- Published project revisions that materially change content must pass review again before the new revision is publicly displayed.
- Moderators may temporarily hide content under documented moderation rules.
- Gallery search, API endpoints, cached data, notifications, exports, and file downloads must enforce the same visibility rules.

### Gallery features

- Search by title, description, domain, and tags
- Filter by department, academic year, domain, and project stage
- Sort by newest, trending, faculty rating, and popularity
- Project detail pages
- Likes and comments
- Content reporting and moderation
- Protected contact requests
- Leaderboards with transparent ranking criteria

Never expose private files, reviewer notes, hall ticket numbers, invitation data, or internal user IDs in public responses.

Keep public popularity separate from faculty evaluation. Explain the leaderboard scoring method.

## 9. FACULTY REVIEW AND INNOVATION MANAGEMENT

Build a faculty review workspace integrated with existing VEXON permissions.

### Review capabilities

- Assigned project queue
- Project details and authorized evidence
- Configurable rubric scores
- Written feedback
- Approve
- Request changes
- Reject with reason
- Recommend for funding
- Recommend for IIC / incubation
- Review history
- Reviewer and timestamp tracking

Use a configurable default rubric, for example:
- Originality and innovation: 25%
- Problem relevance and impact: 20%
- Technical feasibility: 20%
- Prototype/testing evidence: 20%
- Presentation/documentation: 15%

These weights are proposed defaults, not mandatory institutional policy. Make them configurable and version the rubric used for each review.

Separate student-visible feedback from internal reviewer notes.

A funding recommendation must not automatically approve or distribute funding.

Only authorized staff may verify patent/startup milestones or mark a certification as verified.

Super Admin must not automatically gain permission to publish student ideas or change academic review decisions solely because of the Super Admin role. Follow least-privilege access and existing policy enforcement.

## 10. DATABASE AND API DESIGN

Inspect existing conventions before creating files.

Design suitable schemas/models for:
- Innovation projects
- Project revisions
- Team memberships
- Team invitations
- Project assets
- NPTEL certifications
- Certification verification history
- Student profile links
- Faculty reviews
- Innovation recommendations
- Gallery interactions
- Moderation reports
- Publication consent and visibility history
- Auditable sensitive actions

Reuse existing models where appropriate. Avoid unnecessary duplication and unbounded embedded arrays.

Define indexes and uniqueness constraints for common lookups and duplicate-prevention rules.

Add validated endpoints following the repository's conventions. Candidate route groups include:

- `/api/skill-wallet/projects`
- `/api/skill-wallet/projects/:id/team`
- `/api/skill-wallet/invitations`
- `/api/skill-wallet/certifications`
- `/api/skill-wallet/profile-links`
- `/api/skill-wallet/gallery`
- `/api/skill-wallet/projects/:id/publication`
- `/api/skill-wallet/projects/:id/reviews`
- `/api/skill-wallet/projects/:id/interactions`
- `/api/skill-wallet/leaderboard`

These are proposed routes. Adapt them to the actual API architecture and avoid conflicting with existing routes.

All mutating routes must validate inputs, authenticate the user, authorize the operation, handle concurrency safely, and use the existing CSRF/origin protection where applicable.

Use pagination for project listings, gallery search, review queues, and interaction history.

Do not accept owner IDs, reviewer IDs, verification status, or permission levels directly from untrusted clients without server-side authorization.

## 11. FILE STORAGE AND PRIVACY

Inspect the existing storage provider and reuse it if suitable.

Implement:
- Server-side upload validation
- Safe object keys
- Private-by-default storage for certificates and private project assets
- Authorized downloads or short-lived signed URLs where appropriate
- File-size and file-type limits
- Cleanup of temporary and orphaned objects
- Safe deletion and retention behavior
- No sensitive file URLs in logs
- Independent asset authorization even when a user knows an asset ID

Never assume a project becoming public means every associated asset also becomes public.

For Google Drive links, store the URL only after validation. Do not claim the document is accessible or private unless that state has actually been verified.

## 12. UI AND MOBILE INTEGRATION

Integrate with the existing React dashboard and API services.

Provide:
- Student project creation/editing forms
- Conditional end-date field
- Skill tags
- Project image picker
- Team invitation management
- Notification inbox actions
- NPTEL certificate form and upload progress
- Verification status and feedback
- Profile links management
- Portfolio display
- Faculty review workspace
- Innovation gallery and filters
- Publication settings
- Empty, loading, success, and failure states
- Accessible form labels and keyboard navigation

Inspect the actual Android and iOS projects before modifying them.

If the native mobile apps support the relevant student workflows, integrate project creation/viewing, invitations, and notification actions consistently. Do not implement mobile functionality by assuming React Native or Expo if the repository uses native Kotlin/Swift.

Do not create fake mobile integration or claim push notifications work unless the required service and credentials are available and verified.

## 13. SECURITY REQUIREMENTS

- Follow existing VEXON authentication and RBAC policies.
- Enforce authorization on every API route and asset download.
- Prevent IDOR and cross-student data access.
- Prevent unauthorized team invitations, acceptance, or membership changes.
- Use server-side validation for all conditional fields and state transitions.
- Protect private student ideas and certificate records.
- Validate external URLs and file uploads.
- Rate-limit uploads, invitations, comments, and contact requests.
- Avoid leaking sensitive details in error messages or logs.
- Record sensitive review and publication changes in the existing audit system.
- Do not log certificate contents, private URLs, hall ticket numbers, or credentials.
- Respect student consent and define safe withdrawal/unpublishing behavior.
- Never use public popularity as proof of technical merit.
- Do not introduce secrets or production credentials into source code.
- Do not weaken existing authorization to make the feature work.

## 14. AUTOMATED TESTS

Write tests using the existing repository's test framework.

### Project tests
- Required-field validation
- Domain validation
- Skills parsing and validation
- Developing stage hides/rejects end date
- Implemented stage requires valid end date
- Start/end date consistency
- Safe URL validation
- Image upload validation
- Owner/team authorization

### Invitation tests
- Valid roll-number lookup
- Invalid or ineligible student
- Duplicate invitation prevention
- Self-invitation prevention
- Pending invitation grants no access
- Only invitee can accept/decline
- Acceptance creates membership once
- Decline creates no membership
- Cancellation and expired invitation handling
- Concurrent acceptance safety
- Notification creation and failure handling

### NPTEL tests
- Valid certificate submission
- Hall ticket/student matching
- Duplicate detection
- Authorized verification
- Verification history
- PNG/JPEG/WebP accepted
- PDF/SVG/GIF/HEIC/BMP/TIFF rejected
- MIME/extension spoofing rejected
- Corrupted image rejected
- Oversized image rejected
- Real WebP conversion verified by file bytes and decoder
- Failed conversion stores no original
- Temporary-file cleanup
- Unauthorized certificate access denied

### Visibility tests
- Private projects unavailable to other students
- College-only projects unavailable to logged-out visitors
- Public projects visible only after explicit publication
- Approval does not publish
- Public assets are individually authorized
- Unpublishing removes public access
- Unauthorized users cannot publish
- Private data is absent from public responses
- Material revision requires appropriate renewed review

### Regression tests
- Existing authentication and role checks remain functional.
- Existing notification behavior is not broken.
- Existing project features and dashboard routes continue to work.
- Existing web and mobile workflows are not silently broken.

## 15. TESTING AND VERIFICATION

After implementation:

1. Run focused Skill Wallet tests.
2. Run the complete backend test suite.
3. Run the complete frontend test suite.
4. Run production builds for affected applications.
5. Run available Android/iOS tests if those apps were changed.
6. Inspect failures and fix regressions caused by this implementation.
7. Distinguish pre-existing failures from new failures using evidence.
8. Perform a code review of authorization, upload conversion, publication logic, and invitation handling.
9. Verify the final route registration and navigation integration.
10. If a browser automation tool is already available and authorized, use it to verify the main UI workflows locally. Do not claim browser verification if it was not performed.

Do not fake successful test results. Do not claim an external integration works when credentials or connectivity are unavailable.

## 16. DOCUMENTATION

Create or update suitable project documentation describing:
- Architecture and file structure
- Database schemas
- API endpoints
- Roles and permissions
- Project lifecycle
- Team invitation lifecycle
- NPTEL certificate verification
- Image validation and WebP conversion
- Publication and privacy rules
- File-storage behavior
- Environment variables
- Tests and how to run them
- Known limitations and required external configuration

Update the project index/status documentation if the repository uses those files.

## 17. FINAL REPORT

At completion, provide:

1. Summary of implemented features.
2. Actual files created and modified.
3. Data models and API routes added.
4. Existing services reused.
5. Security protections implemented.
6. Test commands and exact pass/fail counts.
7. Build results.
8. Any pre-existing failures and evidence supporting that classification.
9. Incomplete work and blockers.
10. Required environment variables or infrastructure.
11. Mobile integration status.
12. Remaining risks and recommended next steps.

Clearly distinguish:
- Implemented and tested
- Implemented but not fully tested
- Partially implemented
- Not implemented
- Blocked by missing infrastructure or credentials

Do not report the feature as production-ready unless its required security, privacy, upload, authorization, and regression checks have actually passed.

## EXECUTION INSTRUCTION

Implement the feature in a coordinated phase after inspecting the repository. Do not stop after producing a plan or creating placeholder screens. Do not silently omit a requirement because it is inconvenient.

If the entire scope cannot be completed safely in one run, finish the highest-priority coherent portions, document the remaining work precisely, and leave the repository in a buildable state where practical.

Do not commit, push, deploy, or modify production data.
