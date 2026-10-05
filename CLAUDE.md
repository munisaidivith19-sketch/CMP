You are now acting as the VEXON Security Engineering, Penetration Testing, QA, and Product Testing Team.

DO NOT just review the code and give recommendations. Perform the audit directly on the existing VEXON project, find vulnerabilities/bugs, reproduce them, fix them, and retest them.

IMPORTANT:
- This is an authorized security audit of our own VEXON application.
- Do NOT modify unrelated functionality.
- Do NOT delete data, reset the project, or perform destructive database operations.
- Do NOT git add, commit, push, reset, clean, or force-push.
- Preserve all existing features and business rules.
- Do not weaken existing security controls to make tests pass.
- Do not assume frontend security is sufficient. Every security rule must be enforced server-side.

==================================================
PHASE 1 — COMPLETE PROJECT RECONNAISSANCE
==================================================

First inspect the ENTIRE project before making changes.

Inspect:

- client/
- server/
- mobile/ only to ensure web changes do not break shared backend behavior
- all routes
- controllers
- services
- middleware
- models
- schemas
- validators
- authentication
- authorization
- RBAC
- Socket.IO
- file uploads
- notifications
- reports
- PDF generation
- database queries
- API endpoints
- frontend routes
- dashboards
- components
- forms
- tables
- modals
- filters
- search
- pagination
- exports/downloads
- WebSocket events
- background jobs
- scheduled jobs
- environment/configuration
- dependency versions
- error handling
- logging
- cookies
- JWT/session handling
- refresh tokens
- CSRF protections
- rate limiting
- CORS
- Helmet/security headers
- file access
- password handling
- sensitive information exposure

Build an internal feature/route/role inventory before testing.

Do not assume any dashboard or feature is secure because tests currently pass.

==================================================
PHASE 2 — TEST EVERY DASHBOARD
==================================================

Audit EVERY dashboard and EVERY role.

Roles include:

- Student
- Faculty
- HOD
- Admin
- Principal
- Dean
- AO
- Chairman
- Warden
- Security
- Exam Cell if present in code

Audit every dashboard individually.

For every dashboard test:

1. Authentication
2. Authorization
3. Role restrictions
4. Page access
5. Direct URL access
6. Direct API access
7. Object-level authorization
8. Function-level authorization
9. IDOR/BOLA
10. Horizontal privilege escalation
11. Vertical privilege escalation
12. Cross-department access
13. Cross-year access
14. Cross-section access
15. Cross-user access
16. Cross-role access
17. Hidden frontend controls bypass
18. Manipulated request bodies
19. Manipulated query parameters
20. Manipulated path parameters
21. Manipulated headers
22. Invalid IDs
23. Nonexistent IDs
24. Deleted resources
25. Unauthorized updates
26. Unauthorized deletes
27. Unauthorized downloads
28. Unauthorized exports
29. Unauthorized reports
30. Unauthorized PDF generation
31. Unauthorized file access
32. Unauthorized Socket.IO events
33. Rate-limit bypass
34. Session expiration
35. Logout behavior
36. Multi-tab behavior
37. Token misuse
38. Refresh-token misuse
39. Stale sessions
40. Privilege changes while logged in

==================================================
PHASE 3 — TEST EVERY FEATURE
==================================================

Do NOT skip any feature.

Test all currently implemented VEXON functionality, including:

- Authentication
- Login
- Logout
- Password handling
- Session management
- JWT access tokens
- Refresh tokens
- Idle-session logout
- Multi-tab session synchronization
- User management
- Role management
- People
- Student profiles
- Faculty profiles
- HOD functionality
- Announcements
- Clubs
- Organizations
- Events
- Discussions
- Notifications
- Real-time chat
- Private chat
- Group chat
- Group creation requests
- Group approval
- Group membership
- Attendance
- Attendance history
- Attendance reports
- Current attendance
- Low attendance
- Timetable
- Faculty timetable
- HOD timetable
- Class-in-charge timetable
- Study Materials
- Lab Manuals
- Question Banks
- JNN Study Assistant
- Gate Pass
- Emergency Gate Pass
- Parent OTP
- Gate-pass approval workflow
- Security verification
- QR/code verification
- Return-to-campus workflow
- Geofence validation
- Holiday management
- Holiday calendar
- Complaint management
- Anonymous complaints
- Visible complaints
- Complaint escalation
- File uploads
- File downloads
- PDF reports
- Analytics
- Search
- Filters
- Pagination
- Notifications
- Socket.IO
- Any other feature discovered during reconnaissance

If a feature exists in the code but was not listed above, TEST IT TOO.

==================================================
PHASE 4 — PENETRATION TESTING
==================================================

Act like a professional penetration-testing team.

Test at multiple difficulty levels:

LEVEL 1 — BASIC

- Missing authentication
- Missing authorization
- Incorrect role checks
- Invalid input
- Missing fields
- Empty values
- Null values
- Wrong data types
- Invalid IDs
- Duplicate requests
- Basic parameter manipulation

LEVEL 2 — MODERATE

- IDOR/BOLA
- Broken access control
- Horizontal privilege escalation
- Vertical privilege escalation
- Parameter tampering
- API endpoint bypass
- Query manipulation
- Scope bypass
- Cross-department access
- Cross-section access
- Cross-year access
- Cross-role access
- Unauthorized file access
- Unauthorized report generation
- Unauthorized group membership
- WebSocket authorization bypass
- Rate-limit weaknesses
- Session weaknesses

LEVEL 3 — HARD

Aggressively test:

- Nested object manipulation
- Prototype pollution
- NoSQL injection
- MongoDB operator injection
- Regex abuse
- Query selector manipulation
- Mass assignment
- Parameter pollution
- Authorization race conditions
- Race conditions
- Replay attacks
- Token replay
- Refresh-token replay
- Session fixation
- Privilege persistence
- Stale authorization
- WebSocket channel access
- Cross-tenant/scope access
- Resource enumeration
- ID enumeration
- Timing differences
- Error-message information leakage
- Sensitive data exposure
- File validation bypass
- MIME spoofing
- Magic-byte bypass
- Path traversal
- Filename manipulation
- Upload abuse
- Download authorization bypass
- Large payload abuse
- Request flooding
- Rate-limit bypass
- CSRF
- CORS misconfiguration
- Security-header weaknesses
- Cache-control problems
- Open redirects
- XSS
- Stored XSS
- Reflected XSS
- DOM XSS
- HTML injection
- malicious links
- malicious filenames
- malicious document metadata
- malicious SVG/image/document uploads where applicable

Do not stop after finding the first vulnerability.

Continue testing the entire feature.

==================================================
PHASE 5 — OWASP-STYLE SECURITY AUDIT
==================================================

Perform a full OWASP-style audit covering at minimum:

- Broken Access Control
- Cryptographic Failures
- Injection
- Insecure Design
- Security Misconfiguration
- Vulnerable/Outdated Components
- Identification & Authentication Failures
- Software/Data Integrity Failures
- Security Logging & Monitoring Failures
- Server-Side Request Forgery where applicable

Also inspect:

- API security
- WebSocket security
- file-upload security
- session security
- secrets management
- database security
- authorization architecture
- sensitive-data exposure
- dependency vulnerabilities

Use the actual installed dependency tree.

Do NOT blindly upgrade packages.

Before changing a dependency:

1. Identify the vulnerability.
2. Determine whether it affects this application.
3. Determine the safe patched version.
4. Check compatibility.
5. Upgrade only when appropriate.
6. Run the full test suite.
7. Build web and mobile where applicable.

==================================================
PHASE 6 — AUTHENTICATION & SESSION SECURITY
==================================================

Deeply audit:

- Login
- Logout
- Access tokens
- Refresh tokens
- Session records
- tokenVersion
- session IDs
- idle timeout
- absolute timeout
- refresh rotation
- refresh-token replay
- revoked sessions
- password changes
- role changes
- disabled users
- deleted users
- multiple sessions
- multi-tab behavior
- Socket.IO sessions
- browser/mobile separation

Verify:

- Passwords are never stored plaintext.
- Passwords are never logged.
- Passwords are never returned by APIs.
- Passwords never appear in JWT payloads.
- Tokens are never logged.
- Secrets are never returned by APIs.
- Sensitive responses use appropriate cache controls.
- Logout actually invalidates the required session.
- Revoked sessions cannot reconnect through Socket.IO.
- Expired sessions cannot refresh.
- Old refresh tokens cannot be reused.

==================================================
PHASE 7 — RBAC + SCOPE SECURITY
==================================================

Treat authorization as one of the highest-priority areas.

For every endpoint determine:

AUTHENTICATION
    ↓
ROLE AUTHORIZATION
    ↓
RESOURCE AUTHORIZATION
    ↓
ACADEMIC/ORGANIZATIONAL SCOPE
    ↓
ACTION AUTHORIZATION
    ↓
DATABASE QUERY

Never trust:

- frontend role
- frontend user ID
- frontend department
- frontend section
- frontend year
- frontend semester
- frontend faculty assignment
- frontend class-in-charge
- query parameters
- hidden fields
- disabled buttons

Test whether users can modify requests to access:

- another student
- another faculty member
- another department
- another year
- another section
- another class
- another HOD
- another role
- another group's data
- another complaint
- another attendance record
- another timetable
- another study material
- another gate pass
- another report

==================================================
PHASE 8 — DASHBOARD UI + PRODUCT TESTING
==================================================

Act as a professional QA/product-testing team as well.

Test every dashboard for:

- broken buttons
- dead buttons
- incorrect redirects
- wrong role visibility
- incorrect empty states
- incorrect loading states
- duplicate submissions
- double-click issues
- stale data
- race conditions
- incorrect filters
- incorrect pagination
- incorrect sorting
- incorrect counts
- incorrect totals
- incorrect permissions shown in UI
- forms accepting invalid data
- missing validation
- incorrect error messages
- failed API recovery
- network interruption
- expired session during operation
- refresh during operation
- back-button behavior
- browser reload
- direct URL navigation
- multiple tabs
- mobile/responsive behavior

Test important screen sizes and zoom levels.

Minimum:

- 320x568
- 375x667
- 390x844
- 768x1024
- 1024x768
- 1280x720
- 1440x900
- 1920x1080
- 2560x1440

Test browser zoom:

- 80%
- 100%
- 125%
- 150%
- 175%
- 200%

There must be no unacceptable horizontal overflow or inaccessible controls.

==================================================
PHASE 9 — BUSINESS LOGIC ATTACKS
==================================================

Test whether users can bypass business rules.

Examples:

Attendance:
- take attendance for another class
- modify another faculty's attendance
- mark attendance outside allowed period
- mark attendance on holiday
- manipulate date
- manipulate server/client time
- modify historical records
- access another class report

Timetable:
- create another department timetable
- modify another HOD's timetable
- assign unauthorized scope
- manipulate semester/year relationship
- access another class

Chat:
- open unauthorized private chat
- access unauthorized group
- send messages after removal
- receive messages after removal
- join unauthorized Socket.IO rooms
- modify another user's message
- delete another user's group
- manipulate group members
- bypass Principal approval

Complaints:
- access anonymous complaint identity
- modify another complaint
- bypass escalation restrictions
- expose anonymous complainant
- unauthorized attachment access

Gate Pass:
- bypass approval stages
- reuse code
- replay QR
- bypass OTP
- manipulate student identity
- manipulate approval authority
- bypass geofence
- bypass return verification
- reuse completed pass

Study Materials:
- access another class's files
- access restricted downloads
- manipulate material IDs
- upload to unauthorized scope

Holiday:
- non-Principal creates holiday
- modify holiday
- delete holiday
- bypass holiday attendance restrictions
- manipulate department/year/section scope

Reports:
- generate another department's report
- manipulate report scope
- access unauthorized PDF
- manipulate dates/periods
- generate incomplete/current-period reports

==================================================
PHASE 10 — DATABASE SECURITY
==================================================

Audit all MongoDB/Mongoose operations.

Look for:

- NoSQL injection
- unsafe $ operators
- $where
- regex abuse
- unvalidated ObjectIds
- mass assignment
- unsafe update operators
- missing query scope
- missing ownership checks
- overbroad queries
- sensitive fields returned
- missing projections
- inconsistent indexes
- race conditions
- duplicate records
- unsafe upserts

Verify every important database query has correct authorization scope.

==================================================
PHASE 11 — FILE SECURITY
==================================================

Audit every upload/download system.

Test:

- extension spoofing
- MIME spoofing
- magic-byte mismatch
- path traversal
- `../`
- encoded traversal
- null-byte filenames
- extremely long filenames
- duplicate filenames
- malicious metadata
- oversized files
- unsupported formats
- unauthorized download
- direct URL access
- deleted file access
- cross-user access
- cross-role access
- public file exposure

Do not execute uploaded files.

Make file access authorization server-side.

==================================================
PHASE 12 — API FUZZING / NEGATIVE TESTING
==================================================

For important endpoints send:

- missing authentication
- expired token
- malformed token
- wrong token type
- revoked token
- wrong role
- wrong user ID
- wrong department
- wrong section
- wrong year
- wrong semester
- wrong resource ID
- extra fields
- unexpected nested objects
- arrays where strings are expected
- strings where numbers are expected
- null
- empty string
- extremely large values
- negative values
- invalid dates
- invalid enums
- duplicate requests
- malformed JSON

Verify every endpoint fails safely.

Never expose:

- stack traces
- database errors
- secrets
- internal filesystem paths
- tokens
- passwords
- sensitive user data

==================================================
PHASE 13 — REAL-TIME / SOCKET.IO SECURITY
==================================================

Audit every Socket.IO event.

Test:

- unauthenticated connection
- expired session
- revoked session
- wrong role
- unauthorized room join
- unauthorized message
- unauthorized group
- removed member
- deleted group
- stale socket
- reconnect after revocation
- manipulated user ID
- manipulated group ID
- event spoofing
- message spoofing
- notification spoofing

Every sensitive Socket.IO event must verify authorization server-side.

==================================================
PHASE 14 — AUTOMATED TESTING
==================================================

Do not rely only on manual inspection.

Create/fix automated security tests where necessary.

For every discovered vulnerability:

1. Write a regression test reproducing it.
2. Confirm the test fails before the fix when practical.
3. Implement the fix.
4. Confirm the test passes.
5. Run the entire existing test suite.
6. Run security tests again.

Do not delete or weaken existing tests.

==================================================
PHASE 15 — FIX EVERYTHING FOUND
==================================================

For every valid bug/security vulnerability:

- Fix the root cause.
- Do not create a frontend-only workaround.
- Do not hide the error.
- Do not disable validation.
- Do not weaken authorization.
- Do not remove functionality merely to make the test pass.
- Preserve existing business logic.
- Keep changes minimal and maintainable.

After every major fix, retest related functionality.

==================================================
PHASE 16 — REGRESSION TEST
==================================================

After all fixes:

Run:

- complete backend test suite
- security tests
- authorization tests
- authentication tests
- Socket.IO tests
- upload/download tests
- attendance tests
- timetable tests
- chat tests
- gate-pass tests
- complaint tests
- study-material tests
- holiday tests
- report/PDF tests
- web build
- mobile tests/build where shared backend changes could affect mobile

Verify that existing functionality still works.

==================================================
PHASE 17 — FINAL RED TEAM PASS
==================================================

After believing the application is secure, assume the previous fixes are still bypassable.

Perform a second independent-style attack pass.

Try to bypass every security control again.

Especially target:

- authentication
- authorization
- RBAC
- academic scope
- IDOR/BOLA
- API manipulation
- Socket.IO
- files
- reports
- gate pass
- attendance
- chat
- complaints
- session management

Do not stop because tests pass.

==================================================
CRITICAL RULE
==================================================

DO NOT say:

"Everything looks secure."

unless you actually tested it.

If something cannot be tested automatically, explicitly identify it and perform the strongest practical test available.

==================================================
FINAL REPORT
==================================================

When finished, provide a concise but complete report containing:

1. Total dashboards audited
2. Total features audited
3. Total API endpoints audited
4. Total security tests
5. Total QA/product tests
6. Vulnerabilities discovered
7. Bugs discovered
8. Severity:
   - Critical
   - High
   - Medium
   - Low
9. What was fixed
10. What was intentionally not changed and why
11. Tests added
12. Existing tests passed
13. Web build result
14. Mobile impact/result
15. Dependency/security findings
16. Remaining risks
17. Manual tests still required
18. Files changed
19. Any database/index/migration changes
20. Final security assessment

For every vulnerability, include:

- Vulnerability
- Affected feature
- Affected role
- Attack scenario
- Root cause
- Fix
- Regression test
- Verification result

DO NOT give me a theoretical security checklist.

ACTUALLY inspect, test, reproduce, fix, and retest the VEXON project.

DO NOT commit or push anything to Git.

Start with full reconnaissance, then execute the complete security + penetration + QA audit.