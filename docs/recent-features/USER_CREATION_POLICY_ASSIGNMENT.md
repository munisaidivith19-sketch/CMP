# User Creation — Policy Assignment

Date: 2026-10-17 · Branch `fix/csrf-legacy-cookie` · Local and uncommitted. Nothing was committed, pushed or deployed. Tests ran only against the throw-away `*_test` MongoDB database.

## What it does

The **Create login** dialog (Users → Create login) now has a **Policy Assignment** control with two options:

| Option | Meaning | What is stored |
|---|---|---|
| **No Additional Policies** (default) | "Use the existing dashboard access and permissions provided by the assigned role." | Nothing extra. `policies` stays the schema default `[]` and `policyManaged` stays `false`. Effective access is computed from the role exactly as before. |
| **Add Policies** | "Configure additional permissions for this user." | The validated additional grants, saved in the same `User` document as the account. |

Additional policies only **add** access on top of the role. They use the existing per-user policy model (`User.policies`, `server/src/policies.js → STAFF_GRANTABLE`) and the same enforcement path (`middleware/adminPolicy.js → staffGrantGuard`) as the existing per-user *Policies* dialog. There is no second permission system.

### Which accounts can receive policies

Only the staff roles in `STAFF_GRANT_ROLES`: faculty, HOD, principal, dean, AO, chairman, office, COE. For every other account type (student, club admin, alumni, warden, security, transport), *Add Policies* is disabled with an explanation, and the server returns `422`.

The grantable catalogue is `STAFF_GRANTABLE`:

| Module | Actions |
|---|---|
| Attendance | view, create (mark and edit). Campus-wide or one department; create needs view. See *Attendance policies for staff* below. |
| User Management | view, create, edit, suspend, export (export is campus-wide only) |
| Staff Management | view |
| Security Logs | view |
| Activity Logs | view |

Delegating actions are never grantable to staff: changing roles, creating staff accounts and assigning policies.

### Who may choose *Add Policies*

| Signed-in account | Add Policies |
|---|---|
| Super Admin | Yes. Anything in the staff catalogue. Requires password re-entry (`REAUTH_REQUIRED`), the same as the Policies dialog. |
| Policy-managed Admin holding **User Management → policies** and **Staff Management → edit** for the new account's department | Yes, but only within its delegation cap (`own policies ∩ delegation.grantablePolicies`), at no wider scope than its own. |
| Policy-managed Admin without User Management → policies | No (`403`, audited as `PRIVILEGE_ESCALATION_BLOCKED`). |
| Legacy (non-policy-managed) Admin | No, which matches the existing rule that legacy Admins cannot assign policies. |
| Faculty, HOD, Principal, Chairman, Dean, AO, COE, Office, Warden, Transport, Security, Student | No. Even a staff account using User Management through its own grant cannot attach policies. |

User creation, role assignment, individual permission assignment and role-wide policy management remain separate capabilities. `user_management.create` never implies policy assignment.

## Backend

- `POST /api/admin/users` accepts two new optional fields:
  - `policyMode`: `none` | `custom`. If omitted, `none` applies, so older clients (web, Android, iOS) keep working unchanged.
  - `policies`: the same list shape as `PUT /admin/users/:id/policies`, i.e. `[{ module, actions, scope, department? }]`.
- `services/adminPolicies.js → validateCreationPolicies` runs **before** the account is created:
  - `none` with policies attached → `422` (never silently dropped).
  - `custom`: the role must be a staff grantee (`422`). Input goes through `normalizeStaffPolicies`, which rejects unknown modules, actions and scopes, admin-only actions and campus-only export (`422`). An empty selection → `422`.
  - A non-Super-Admin actor must be policy-managed, hold `user_management.policies` and pass `adminAllows(actor, 'staff_management', 'edit', department)`. Then `exceedsAuthority(actor, [], policies, target)` checks the actor's cap, scope, department and chain-escalation rules (`403 DELEGATION_EXCEEDED`).
- **Atomicity:** the account and its policies are one document, written by one `User.create`. Every check happens before that write, so a refused policy never leaves a half-configured account. No transaction or compensation is needed.
- **Mass assignment:** `policyManaged`, `delegation` and other privileged fields are never copied from the body (`pick(CREATE_FIELDS)`). `admin` and `super_admin` are still rejected by the `role` validator.
- **Audit:** a successful grant writes `POLICIES_CHANGED` to the protected audit log, with details `{ previous: [], new, targetRole, additional: true, via: 'user_create' }`. A delegated Admin's grant is also written to the routine security log. Refusals write `PRIVILEGE_ESCALATION_BLOCKED` and `POLICY_DENIED`. Passwords, OTPs and tokens are never logged.
- `GET /api/admin/my-policies` now also returns `staffCatalogue` to Admins and the Super Admin, so the form shows exactly what the server accepts.
- Grants take effect on the new account's first request. Policies are read from the database on every request, so there is no cache to invalidate.

## Web UI (`client/src/components/CreateUserModal.jsx`)

- A radio group with both options and their descriptions, below the account fields. *No Additional Policies* is selected by default.
- *Add Policies* is disabled when it does not apply, with the reason shown (wrong account type, not authorized, outside your department, nothing delegatable).
- When selected, the form shows:
  - **Inherited from the role:** an explanation that the role's standard access is kept and not copied.
  - **Additional permissions:** the existing `PolicyEditor`, limited to the delegatable catalogue.
  - **Effective permissions preview:** inherited access, plus each additional grant, plus the admin pages those grants open.
- Switching to *No Additional Policies*, or to an account type that cannot hold policies, while selections exist opens a **Discard selected policies?** confirmation. Nothing is discarded silently.
- The Super Admin is asked to re-enter the password when required. Cancelling creates nothing.
- On success, the toast names the account and its policy summary, or says "Role permissions only". On failure, the server's message is shown and success is never reported.
- Editing an existing account's policies still uses the per-user *Policies* dialog (`UserPoliciesModal`), which already describes grants as additions to the role.

Client mirror helpers (UI only; the server decides): `client/src/utils/delegation.js → creationPolicyAccess`, `policySummary`.

## Mobile

The Kotlin Android and native iOS apps do not provide account creation, so no mobile change was needed. Their requests omit `policyMode`, which the server treats as `none`.

## Tests

| Suite | Command | Result |
|---|---|---|
| New backend suite | `cd server && node --test tests/user-creation-policies.test.js` | see final report |
| Related backend suites | `node --test tests/staff-policies.test.js tests/admin-delegation.test.js tests/super-admin.test.js tests/roles.test.js` | see final report |
| Client helpers | `cd client && npm test` | see final report |
| Web production build | `cd client && npm run build` | see final report |

`server/tests/user-creation-policies.test.js` maps to the requested checks:

1. No Additional Policies preserves role access and stores nothing; the legacy body without `policyMode` behaves the same (also covers 11).
2. Super Admin with Add Policies: re-auth required, nothing created without it, grant effective, persists across a second sign-in, audited without the password (also covers 12).
3. A delegating Admin grants only what it holds. Out-of-cap or wider-scope grants and accounts outside its department are refused, and **no account is left behind** (also covers 8 and 10).
4. Admins without User Management → policies (policy-managed or legacy) are refused, and can still create the account with role access.
5. Faculty, HOD, Principal, Chairman, Dean, AO, COE, Office, Warden, Transport, Security and Student cannot create accounts with policies or assign themselves policies.
6. Crafted bodies are refused: policies with `none` or no mode, unknown mode, empty custom, unknown module or action, admin-only actions, bad department, wrong type, ineligible role, `super_admin` and `admin` roles. `policyManaged` and `delegation` are not mass-assignable (also covers 7 and 8).
9. A grant affects only the intended account.

The "Add Policies displays the editor to authorized administrators" check (2) is covered at helper level (`client/tests/delegation.test.mjs → creationPolicyAccess`). The repository has no React component test setup, and no browser verification was performed.

## Attendance policies for staff

Staff accounts can now receive **Attendance → view** and **Attendance → create** (mark and edit) as additional policies, campus-wide or for one department. This works both at creation time and in the per-user Policies dialog. They add to what the role already allows and never remove it.

| Grant | What changes (server: `controllers/attendanceController.js`) |
|---|---|
| none | Nothing. Faculty see their own classes, an HOD their department (today-only edits), and Principal, Dean, AO, Chairman, COE and Office read campus-wide. |
| view (department D, or campus) | `staffScope` adds department D (or everything) to the role's read scope: sessions, student, subject and section attendance, low attendance and the class roster. Rosters stay read-only. |
| view + create | `assertCanWrite` treats the account like an Admin for subjects of the covered department(s): mark or re-mark any class for today or an earlier date. Future dates, Class Not Conducted, holidays and exam periods stay closed for everyone. Read-only roles (Principal, Office, …) can then mark too. |

Rules:

- `create` requires `view`, granted explicitly (`422` otherwise); nothing implies anything.
- Attendance `correct`, `update` and `export` stay Admin-only (`422` for staff).
- Admin attendance policies stay campus-wide. The department scope exists for staff grants only, because only the staff path filters by it.
- A staff attendance grant raises the account past a route's role list **only** on `GET /attendance/roster` and `POST /attendance/mark`, the two routes whose controller checks the grant (`middleware/adminPolicy.js → ATTENDANCE_GRANT_ROUTES`). Admin-wide screens (attendance summaries, the low-attendance monitor, OD/leave queues) are never opened by a staff grant.
- Revoking the grant removes the access on the next request. Policies are read from the database per request.

Web UI (`pages/attendance/StaffAttendance.jsx`): a staff account holding the grant gets the class picker (department → class → period) with the departments its grant covers, and can choose the date. An HOD with a create grant is no longer pinned to today in the picker. Whether the sheet is editable still comes from the server (`roster.editable`).

Mobile: Android marks only through the faculty member's own timetable periods, and iOS has no marking. Both keep working unchanged under the same server rules, but the wider grant is usable from the web app only.

Tests: `server/tests/staff-attendance-policies.test.js`. It covers the catalogue and validation, unchanged behaviour without a grant, department-scoped view (read, not write, no admin-wide screens, no effect on other accounts), create (edit, earlier date, out-of-scope class and future date refused), Principal, Office and HOD with a campus grant, and revocation.

## Known limitations

- Other modules (timetable, events, gate pass…) are still not grantable to staff. Each needs the same treatment as attendance: grant checks inside its controller scoping first.
- Warden, security and transport cannot hold additional policies (unchanged from before).
