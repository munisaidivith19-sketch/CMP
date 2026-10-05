You are working on my existing JNN college management platform.

IMPORTANT:
- This is an EXISTING production-style MERN project.
- Do NOT rebuild the project from scratch.
- Do NOT replace the existing architecture or tech stack.
- Do NOT delete working features.
- Do NOT perform destructive resets.
- First inspect the existing codebase and understand the current authentication, User model, roles, class-in-charge logic, password handling, OTP/gate-pass flow, Admin dashboard, Security & Logs area, session management, and frontend/mobile structure.
- Reuse existing components, APIs, middleware, models, utilities, styling, and patterns wherever possible.
- Make the smallest safe changes required.
- Do not create duplicate systems when an existing implementation can be extended.
- Do not modify unrelated features.
- Do not add Git commands, commits, pushes, or repository operations.

==================================================
PROJECT GOAL
==================================================

Implement the following features in the existing JNN platform:

1. Faculty can create Student login accounts only for their own class-in-charge scope.
2. Admin can create and edit Student accounts college-wide.
3. Authorized Faculty/Admin can reset Student passwords without requiring the old password.
4. Admin can reset passwords for permitted users without requiring the old password.
5. Remove email-based password reset.
6. Add proper Admin-only "Security & Logs" dashboard.
7. Inside Security & Logs, create a completely separate "OTP" sub-dashboard.
8. Every generated OTP must appear as its own small OTP card.
9. OTP SMS sending is DISABLED for now, but the OTP architecture must be ready to enable SMS later.
10. When SMS is enabled later, OTP must be sent ONLY to the student's registered parent mobile number.
11. All important authentication, user-management, password, session, OTP, and security events must be recorded in Security Logs.

==================================================
PHASE 1 — INSPECT EXISTING PROJECT FIRST
==================================================

Before changing anything, inspect:

- backend/server structure
- frontend/client structure
- mobile structure
- User model/schema
- authentication controllers/routes/services
- role/permission middleware
- class-in-charge implementation
- timetable implementation
- student creation/user creation flow
- password change/reset flow
- email password-reset implementation
- OTP generation/verification
- gate-pass OTP flow
- SMS provider abstraction, if already present
- session model and tokenVersion/session invalidation
- Admin dashboard
- existing Security & Logs implementation, if any
- existing audit logging
- existing UI components for cards, tables, filters, dialogs, badges
- existing API conventions
- existing tests

Do not assume file names.

Find the actual implementation and extend it.

After inspection, identify the minimum files that need modification.

==================================================
PHASE 2 — FACULTY STUDENT ACCOUNT CREATION
==================================================

Faculty must be able to create Student login accounts.

BUT:

A Faculty member can create students ONLY within their exact class-in-charge scope.

Do NOT use general subject-handling assignments for this permission.

Class-in-charge scope must be based on:

- Department
- Academic Year
- Section
- Semester

Example:

Faculty:
Department = CSE
Year = 3
Section = A
Semester = 5
Class-In-Charge = YES

When this faculty opens:

Faculty → Students → Create Student

the form must automatically populate:

Department: CSE
Year: 3rd Year
Section: A

These fields MUST be:

- read-only
- disabled/locked
- visually clear that they are automatically assigned
- NOT editable by the Faculty

Faculty should only enter student-specific information such as:

- Student name
- Roll number
- username/login identifier
- email if the existing system requires it
- parent mobile
- password or generated password according to the existing account-creation design
- other existing student fields that are appropriate

Do not allow the Faculty to select another:

- department
- year
- section

from the frontend.

MORE IMPORTANT:

Frontend restrictions are NOT sufficient.

Backend must derive the Faculty's class-in-charge scope from the authenticated user/session and force:

department
year
section

from the Faculty's authorized scope.

If a malicious request attempts:

POST /users
department=OTHER_DEPARTMENT
year=OTHER_YEAR
section=OTHER_SECTION

the backend MUST reject it.

Faculty with NO valid class-in-charge scope must NOT be allowed to create Student accounts.

Do not broaden permission to all Faculty.

==================================================
PHASE 3 — ADMIN STUDENT MANAGEMENT
==================================================

Admin can:

- create Student accounts
- edit Student accounts
- change Student academic details where existing Admin permissions allow
- reset Student passwords
- enable/disable accounts according to existing account-status architecture

Admin is college-wide.

Keep existing RBAC conventions.

Do not weaken authorization for other roles.

==================================================
PHASE 4 — PASSWORD MANAGEMENT
==================================================

Implement two clearly different flows.

A) SELF PASSWORD CHANGE

When a user changes their own password:

- Current password is required.
- New password is required.
- Confirm password is required.
- Existing password validation rules should remain.
- Never log the password itself.

B) AUTHORIZED PASSWORD RESET

For authorized staff:

- Admin can reset passwords for permitted users.
- Assigned Faculty can reset passwords for Students within their class-in-charge scope.
- Old/current password is NOT required.
- Only new password + confirmation are required.

Backend MUST verify authorization.

Faculty cannot reset:

- another Faculty's password
- Admin password
- HOD password
- Principal password
- other privileged accounts
- Students outside their class-in-charge scope

Admin can reset permitted user accounts according to the existing role hierarchy.

After an authorized password reset:

- invalidate existing sessions for the target user
- increment tokenVersion or use the project's existing session invalidation mechanism
- invalidate refresh tokens/sessions as appropriate
- force the target user to log in again
- do not expose the old password
- do not log the new password
- do not log the old password

==================================================
PHASE 5 — REMOVE EMAIL PASSWORD RESET
==================================================

Remove/disable the existing email password-reset workflow.

Do NOT send password-reset links by email.

The login page should instead show:

"Forgot your password? Contact your Class In-Charge or Admin to reset your password."

For students:

"Forgot your password? Contact your Class In-Charge or Admin to reset your password."

Do not leave an active email-reset endpoint that bypasses the new security model.

Remove obsolete frontend links/buttons/forms related to email password reset.

If an existing backend endpoint must remain temporarily for compatibility, make sure it cannot be used as an insecure password-reset path.

Do not break normal login.

==================================================
PHASE 6 — ADMIN SECURITY & LOGS
==================================================

Create or extend:

Admin → Security & Logs

This entire area must be ADMIN ONLY.

Frontend:

- Security & Logs menu must only appear for Admin.
- Direct URL access by other roles must be blocked.

Backend:

Every Security & Logs API must verify Admin authorization.

These roles must receive HTTP 403:

- Student
- Faculty
- HOD
- Principal
- Dean
- AO
- Chairman
- Warden
- Security
- Alumni
- any other non-Admin role

Never rely only on frontend hiding.

==================================================
PHASE 7 — SECURITY LOGS
==================================================

Security Logs and OTP must be SEPARATE.

Navigation:

Admin
 └── Security & Logs
      ├── Security Logs
      └── OTP

Security Logs should contain important security/audit events.

At minimum support:

AUTHENTICATION:
- LOGIN_SUCCESS
- LOGIN_FAILED
- LOGOUT
- SESSION_CREATED
- SESSION_EXPIRED
- SESSION_REVOKED
- FORCED_LOGOUT
- refresh/session failures where meaningful

PASSWORD:
- PASSWORD_CHANGED
- PASSWORD_RESET
- PASSWORD_RESET_FAILED

USER MANAGEMENT:
- USER_CREATED
- USER_UPDATED
- USER_ENABLED
- USER_DISABLED
- ROLE_CHANGED

ACADEMIC/SCOPE:
- ACADEMIC_SCOPE_CHANGED
- CLASS_IN_CHARGE_CHANGED

OTP:
- OTP_CREATED
- OTP_SENT
- OTP_VERIFIED
- OTP_FAILED
- OTP_EXPIRED
- OTP_RESEND
- OTP_LOCKED

GATE PASS SECURITY:
- GATE_PASS_APPROVED
- GATE_PASS_REJECTED
- GATE_PASS_CANCELLED
- GATE_PASS_QR_VERIFIED
- GATE_PASS_VERIFICATION_FAILED
- GATE_PASS_EXIT_CONFIRMED
- GATE_PASS_RETURN_CONFIRMED

Only record events that are actually relevant to the existing implementation.

Do not invent fake events.

==================================================
PHASE 8 — SECURITY LOG DATA
==================================================

Security log records should capture useful context.

Use server-generated values wherever possible.

Suggested fields:

- event/action
- success/failure
- actor user
- actor role
- target user when applicable
- timestamp
- client/platform
- device name/label if available
- operating system if available
- browser/app information
- IP address
- reason when relevant
- previous/new role when role changes
- previous/new academic scope when scope changes
- relevant resource/entity ID

IMPORTANT:

Do NOT trust:

- client-supplied actor identity
- client-supplied role
- client-supplied timestamp

The backend must derive identity from the authenticated session/token and timestamp from the server.

NEVER store:

- passwords
- password hashes in audit metadata
- access tokens
- refresh tokens
- authentication secrets

Security logs must be append-only from the Admin UI.

Admin can:

- view
- search
- filter

Admin must NOT be able to edit individual audit records from the UI.

==================================================
PHASE 9 — SECURITY LOG UI
==================================================

Create a clean responsive Security Logs dashboard.

Provide:

Summary cards such as:

- Logins Today
- Failed Logins
- Password Resets
- Active Sessions

Filters:

- Search user
- Search roll number
- Search username/email where appropriate
- Event/action
- Role
- Success/failure
- Web/Mobile
- Date range:
  - Today
  - Yesterday
  - Last 7 Days
  - Last 30 Days
  - Custom

Use the project's existing UI design system.

Do not introduce an unrelated UI framework.

Make the page responsive on:

- desktop
- tablet
- mobile

==================================================
PHASE 10 — SEPARATE OTP SUB-DASHBOARD
==================================================

This is VERY IMPORTANT.

Inside:

Admin → Security & Logs

create a separate:

OTP

sub-dashboard/tab/section.

OTP must NOT be mixed into the normal Security Logs table.

Navigation:

Admin
 └── Security & Logs
      ├── Security Logs
      └── OTP

The OTP section is specifically for viewing generated OTP records.

==================================================
PHASE 11 — EVERY OTP AS A SMALL CARD
==================================================

EVERY generated OTP must appear as its OWN SMALL CARD.

Do NOT use one large table for OTPs.

Example layout:

┌─────────────────────────────────────┐
│ OTP                           ACTIVE│
│                                     │
│ 1234                                │
│ Expires: 05 Oct 2026, 12:45 PM      │
│                                     │
│ Student: Rahul Kumar                │
│ Roll No: 23CSE041                   │
│ Department: CSE                     │
│ Year: 3rd Year     Section: A       │
│ Parent Mobile: +91 XXXXX XXXXX      │
│                                     │
│ Generated: 05 Oct 2026, 12:35 PM    │
└─────────────────────────────────────┘

Every OTP record must have its own card.

New OTP = new card.

Cards should be displayed newest first.

Use responsive card grid/list behavior.

Example desktop:

[ OTP CARD ] [ OTP CARD ] [ OTP CARD ]

Example mobile:

[ OTP CARD ]
[ OTP CARD ]
[ OTP CARD ]

Use the project's existing glassmorphism/card design language.

Do not make the cards unnecessarily huge.

==================================================
PHASE 12 — OTP CARD INFORMATION
==================================================

Each OTP card must show:

1. OTP
2. Status
3. Expiry time
4. Student name
5. Roll number
6. Department
7. Year
8. Section
9. Registered parent mobile
10. Generated/created time

Example:

OTP
1234

Status:
ACTIVE

Expires:
05 Oct 2026, 12:45 PM

Student:
Rahul Kumar

Roll No:
23CSE041

Department:
CSE

Year:
3rd Year

Section:
A

Parent Mobile:
+91 XXXXX XXXXX

Generated:
05 Oct 2026, 12:35 PM

==================================================
PHASE 13 — OTP STATUS
==================================================

Support clear status values:

ACTIVE
USED
EXPIRED
FAILED
LOCKED

At minimum, clearly show whether the OTP is:

- used
- not used

Status should be determined by backend OTP lifecycle.

Do not allow frontend to manually change OTP status.

Examples:

ACTIVE
→ OTP is valid and unused

USED
→ OTP successfully verified

EXPIRED
→ OTP validity period ended

FAILED/LOCKED
→ maximum verification attempts reached

==================================================
PHASE 14 — OTP GENERATION
==================================================

Keep the existing OTP generation/verification flow.

For now:

SMS SENDING MUST BE DISABLED.

IMPORTANT:

Do NOT remove OTP generation.

Do NOT remove OTP verification.

Do NOT replace the OTP with a static test value.

The application should continue generating real secure OTPs for development/testing.

Use the existing secure random OTP generation implementation if already present.

Keep:

- OTP length
- expiry
- attempt limit
- resend cooldown

from the existing configuration unless there is a specific reason to change them.

==================================================
PHASE 15 — OTP SMS FEATURE FLAG
==================================================

Implement/configure SMS so that it is OFF for now.

Example conceptual configuration:

OTP_SMS_ENABLED=false

or use the project's existing OTP provider configuration if one already exists.

Do NOT hardcode SMS behavior into the controller.

Create/use a provider abstraction so that later the SMS provider can be enabled by configuration/API credentials.

Current behavior:

OTP generated
        ↓
OTP stored
        ↓
OTP displayed in Admin → Security & Logs → OTP
        ↓
SMS NOT SENT
        ↓
OTP can still be verified normally

Later:

OTP generated
        ↓
OTP stored
        ↓
OTP displayed in Admin → Security & Logs → OTP
        ↓
SMS provider enabled
        ↓
OTP sent to REGISTERED PARENT MOBILE
        ↓
OTP verified

==================================================
PHASE 16 — OTP MUST USE REGISTERED PARENT MOBILE
==================================================

When SMS is eventually enabled:

OTP must be sent ONLY to the student's registered parent mobile number stored in the Student/User record.

NEVER use:

- student-entered phone number
- request-body phone number
- frontend-provided arbitrary phone number
- temporary phone number

Backend must retrieve the parent mobile from the database.

If there is no registered parent mobile:

- do not send SMS
- return a safe error
- record the relevant event
- do not silently send elsewhere

SMS API keys/secrets must remain server-side.

Never expose SMS credentials to:

- frontend
- mobile application
- browser
- logs
- Security Logs UI

==================================================
PHASE 17 — OTP SECURITY
==================================================

Do NOT put OTP values in normal application/server logs.

OTP information should be visible in the dedicated:

Admin → Security & Logs → OTP

section only within the application.

Only Admin can access the OTP API.

All other roles must receive 403.

Do not expose OTP data through:

- student APIs
- faculty APIs
- normal user list APIs
- gate-pass list APIs
- public endpoints

OTP API must use strict Admin authorization.

==================================================
PHASE 18 — OTP STORAGE
==================================================

Inspect the existing OTP implementation first.

Reuse the existing OTP model if possible.

If extending it, preserve existing verification behavior.

The OTP record should be associated with:

- student/user
- parent mobile
- creation time
- expiry time
- verification state
- attempt count
- resend information if existing
- related gate-pass/request ID where applicable

Do not duplicate student identity data unnecessarily if existing relationships can safely provide it.

However, the Admin OTP API should return enough information for the card:

- OTP
- student name
- roll no
- department
- year
- section
- parent mobile
- status
- expiry
- created time

==================================================
PHASE 19 — OTP CARD PRIVACY
==================================================

Because OTPs are sensitive:

- OTP API must be Admin-only.
- Do not expose it through general user endpoints.
- Do not include OTP in ordinary logs.
- Do not expose OTP in frontend source/config.
- Do not expose OTP in mobile client APIs except where strictly required for verification.
- Do not expose SMS API keys.

If the existing architecture hashes OTPs for verification and therefore cannot display them, design a secure server-side approach that allows the Admin-only OTP dashboard to display the OTP as required without weakening general API security.

Do not compromise authentication security merely to display OTPs.

==================================================
PHASE 20 — OTP LOGGING
==================================================

Record OTP lifecycle events in Security Logs:

OTP_CREATED
OTP_SENT       // only when SMS is enabled
OTP_VERIFIED
OTP_FAILED
OTP_EXPIRED
OTP_RESEND
OTP_LOCKED

Do NOT store the plaintext OTP inside the normal audit-log message.

The separate OTP dashboard is responsible for OTP display.

==================================================
PHASE 21 — PASSWORD RESET AUDIT
==================================================

Whenever Admin resets a password:

Create:

PASSWORD_RESET

Security Log.

Record:

- actor Admin
- target user
- target role
- timestamp
- Web/Mobile/Admin UI
- device/client details
- success/failure
- reason if supplied

Whenever Faculty resets a Student password:

Record:

PASSWORD_RESET

with:

- Faculty actor
- Student target
- Faculty role
- target Student
- class-in-charge scope
- timestamp
- client/device
- success/failure

NEVER record:

- old password
- new password
- password hash

==================================================
PHASE 22 — FACULTY PASSWORD CHANGES
==================================================

Any Faculty password change/reset must be logged.

This includes:

- Faculty self password change
- Admin resetting Faculty password

Record the event in Security Logs.

No password value must ever appear.

==================================================
PHASE 23 — USER CREATION/MODIFICATION LOGS
==================================================

When a user is created:

USER_CREATED

When a user is modified:

USER_UPDATED

Include:

- actor
- target user
- target role
- timestamp
- client
- device
- relevant changed fields

Do NOT record sensitive values unnecessarily.

For academic scope changes, record old/new scope.

For password changes, record only the event, never the password.

==================================================
PHASE 24 — SESSION INVALIDATION
==================================================

When an Admin or authorized Faculty resets a user's password:

Invalidate existing sessions for that target account.

Use the project's existing:

- session model
- tokenVersion
- refresh-token rotation
- session revocation

architecture.

Do not create a second session system.

The target user should be required to authenticate again after reset.

Log the relevant session revocation/forced logout event where appropriate.

==================================================
PHASE 25 — FRONTEND AND BACKEND SECURITY
==================================================

Every new feature must be protected at BOTH levels.

Frontend:
- hide unauthorized buttons
- hide unauthorized menu items
- prevent unauthorized navigation

Backend:
- enforce authorization middleware
- validate target user
- validate class-in-charge scope
- validate role
- validate academic scope
- return 403 for unauthorized users

Never rely on frontend restrictions.

==================================================
PHASE 26 — MOBILE
==================================================

Inspect the existing mobile application.

Do not automatically add every Admin Security & Logs feature to mobile.

Security & Logs should remain Admin-only.

If the existing Admin experience is web-only, keep this dashboard web-only unless the existing architecture clearly requires mobile support.

Do not break mobile APIs.

==================================================
PHASE 27 — UI/UX
==================================================

Use the existing JNN design system.

Keep:

- glassmorphism style
- existing cards
- existing typography
- existing spacing
- existing colors
- existing responsive behavior

OTP cards should look like a natural part of the existing Admin dashboard.

Make the OTP dashboard easy to scan.

Recommended:

Top:

Security & Logs

Tabs:

[ Security Logs ] [ OTP ]

OTP page:

[ Search OTP / Student / Roll No ]

[ Status Filter ]

Then:

OTP card grid

Newest OTPs first.

==================================================
PHASE 28 — SEARCH/FILTER OTP
==================================================

Implement useful OTP filtering:

- Student name
- Roll number
- Department
- Year
- Section
- Status
- Date range

Optional:

- parent mobile search

If displaying parent mobile, respect the existing privacy conventions and mask it appropriately if the project already uses masking.

Do not allow non-admin users to search OTPs.

==================================================
PHASE 29 — DO NOT BREAK EXISTING GATE PASS
==================================================

The OTP changes must NOT break:

- normal gate pass request
- parent OTP verification
- Faculty approval
- HOD approval
- Principal approval
- emergency gate pass
- Security QR/code verification
- Return to campus flow
- parent notification flow

Extend the existing implementation.

Do not create a separate gate-pass OTP system.

==================================================
PHASE 30 — TESTING
==================================================

After implementation, run the existing tests.

Add/update tests for:

FACULTY STUDENT CREATION:
- class-in-charge Faculty can create Student
- Faculty without class-in-charge cannot
- Faculty cannot change department
- Faculty cannot change year
- Faculty cannot change section
- backend rejects manipulated requests
- Faculty cannot create Student outside their scope

ADMIN:
- Admin can create Student
- Admin can edit Student
- Admin can reset Student password

PASSWORD:
- self password change requires old password
- authorized reset does not require old password
- unauthorized reset returns 403
- sessions are invalidated after reset
- password values are never logged

EMAIL RESET:
- email reset flow is disabled
- login displays contact Class In-Charge/Admin message

SECURITY LOGS:
- only Admin can access
- every non-admin role gets 403
- login success logged
- login failure logged
- logout logged
- user creation logged
- user update logged
- password reset logged
- faculty password change logged
- session revocation logged
- role/scope changes logged where applicable

OTP:
- OTP generated
- OTP appears in separate OTP dashboard
- each OTP appears as its own card
- OTP card shows all required fields
- newest OTP appears first
- status changes correctly
- used OTP becomes USED
- expired OTP becomes EXPIRED
- failed/locked OTP is represented correctly
- SMS is NOT sent while disabled
- parent mobile comes from database
- arbitrary phone number cannot override parent mobile
- OTP endpoint is Admin-only
- OTP is not present in normal application logs
- OTP lifecycle events appear in Security Logs
- OTP verification still works

REGRESSION:
- existing backend tests pass
- web build passes
- mobile tests/build pass where applicable

==================================================
PHASE 31 — IMPLEMENTATION SAFETY
==================================================

Before editing each area:

1. Inspect current implementation.
2. Reuse existing models/services.
3. Make minimal changes.
4. Preserve backwards compatibility.
5. Do not remove working functionality unless explicitly required above.
6. Do not rename large parts of the project unnecessarily.
7. Do not introduce new dependencies unless absolutely necessary.
8. If a dependency is already available, reuse it.
9. Do not change database structure unnecessarily.
10. Do not perform destructive database migrations.

If a schema change is required:

- make it backward-compatible
- ensure existing users continue to work
- provide safe defaults
- do not delete existing fields

==================================================
PHASE 32 — FINAL REPORT
==================================================

After implementation, provide a concise report containing:

1. Files changed
2. Backend changes
3. Frontend changes
4. Database/model changes
5. Security changes
6. OTP changes
7. Password reset changes
8. Authorization changes
9. Tests executed
10. Test results
11. Any remaining issues
12. Any manual configuration required to enable SMS later

Do NOT claim something is implemented if it was not actually implemented.

IMPORTANT FINAL RULE:

Do not stop after creating the UI.

The implementation is complete only when:

- backend authorization works
- database/model logic works
- OTP lifecycle works
- Security Logs work
- Admin-only access works
- Faculty scope enforcement works
- password reset works
- session invalidation works
- SMS-disabled mode works
- OTP cards display real backend data
- tests pass
- existing functionality remains intact.