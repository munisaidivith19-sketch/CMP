# Super Admin, module policies and emergency control

## Roles

| Account | Created by | Can do |
|---|---|---|
| **Super Admin** (`super_admin`) | `server/scripts/create-super-admin.mjs` only | Super Admin console: manage Admin accounts and their policies, create/manage accounts of every other role (Users page), security center, parent gate-pass OTP cards, **read-only** chats (every conversation; cannot send; each opened chat is audited), **read-only** attendance, gate passes and hostel, backup/recovery status, emergency control. Never marks attendance, acts on a gate pass, or posts in chat (server allows GET only there). Web only. |
| **Policy-managed Admin** (`admin`, `policyManaged: true`) | Super Admin | Deny-by-default: only the modules/actions ticked in its policies. |
| **Legacy Admin** (`admin`, `policyManaged: false`) | earlier admin panel | Unchanged, unrestricted admin behaviour — except it can no longer create, promote, edit, delete or reset Admin / Super Admin accounts. Saving policies for it converts it to policy-managed. |

No API creates or promotes a Super Admin, and no role sent by a client is trusted.

## Provisioning a Super Admin

```sh
cd server
SUPER_ADMIN_EMAIL=owner@college.edu SUPER_ADMIN_NAME="Platform Owner" \
SUPER_ADMIN_PASSWORD='<strong password>' node scripts/create-super-admin.mjs
#   --reset-password   re-key an existing Super Admin (signs it out everywhere)
#   --force-change     require a password change at first sign-in
```

The script connects to the database selected by `server/.env` (`DB_TARGET`). Prefix
`DB_TARGET=local` or `DB_TARGET=atlas` to choose explicitly. Credentials are read from
the environment only; nothing is written to the repository.

## Policy catalogue

Defined in `server/src/policies.js`, enforced by `server/src/middleware/adminPolicy.js`
(route → module/action, deny by default) and, for user/staff management, in
`server/src/controllers/adminController.js` (which module applies to the target
account, plus department scope).

| Module | Actions | Scopes |
|---|---|---|
| Attendance | view, create, update, correct, export | campus |
| Timetable | view, create, edit, cancel | campus |
| Staff Attendance | view, record, correct, export | campus |
| Staff Management | view, create, edit, suspend | campus, department |
| Events | view, create, edit, cancel | campus |
| Clubs | view, create, edit, members, events | campus |
| User Management | view, create, edit, suspend, roles, policies, export | campus, department |
| Security Logs | view | campus |
| Activity Logs | view | campus |

Rules: `view` never implies a write, no write implies export/cancel/policies, and there is no
delete action — deleting accounts, clubs or any audit record is not grantable. Policies are
read from the database on every request, so a revocation applies to the next request.
`user_management.policies` lets an Admin change *other* Admins' policies only within the
modules, actions and scope it holds itself (further capped by its delegation limit, see below);
never its own, never a Super Admin's or a legacy Admin's.

Not offered because the modules have no such operation today: timetable *publish*, event
*publish*, security-log *export/settings*, activity-log *export*.

## Role-policy delegation

A Super Admin can narrow, per policy-managed Admin, **which roles it may create**, **which roles
it may assign** to existing accounts, and **the most it may delegate** to other Admins
(Super Admin console → Admin accounts → an Admin → *User creation & delegation*). Stored on the
Admin as `delegation` (`createRoles`, `assignRoles`, `grantablePolicies`) and written only by
`PUT /api/super-admin/admins/:id/delegation` (Super Admin, password re-entry, audited as
`DELEGATION_CHANGED`).

Admin accounts carry module policies. Every other role (faculty, HOD, …) has fixed, role-based
permissions, and the eight staff roles in `STAFF_GRANT_ROLES` (faculty, HOD, principal, dean, AO,
chairman, office, COE) may additionally hold a narrow set of **additional policies**
(`STAFF_GRANTABLE`: Attendance view/create (campus or one department), User Management
view/create/edit/suspend/export, Staff Management view, Security Logs view, Activity Logs view). These only add access, never a delegating action (roles,
policies, staff creation). They are set through the per-user *Policies* dialog or at creation time
(*Policy Assignment*, see `docs/recent-features/USER_CREATION_POLICY_ASSIGNMENT.md`). Students,
alumni, club admins, warden, security and transport cannot hold policies.

Mapping of common permission names to VEXON's catalogue:

| Requested name | VEXON |
|---|---|
| `users.read` | `user_management.view` / `staff_management.view` |
| `users.create` | `user_management.create` / `staff_management.create`, narrowed by `delegation.createRoles` |
| `users.update` | `user_management.edit` / `staff_management.edit` |
| `users.assign_role` | `user_management.roles` + edit on both roles, narrowed by `delegation.assignRoles` |
| `role_policies.read` / `role_policies.assign` | `user_management.policies` (lists Admin targets and changes their policies), capped by `delegation.grantablePolicies` |
| `role_policies.manage` | Super Admin only (delegation limits, legacy-Admin conversion, Admin accounts) |

Rules (all server-side, `server/src/policies.js`):

- Limits only **narrow**. A limit left unset (`null`) means the module policies decide, exactly as
  before this feature, so existing Admins keep their current access and nothing was migrated.
  An empty list means "none".
- `users.create` never implies role assignment or policy assignment; each is its own action.
- Creating an account needs the module's `create` action **and** the role inside `createRoles`
  (when set). Changing a role needs `user_management.roles`, edit rights over the account's
  **current** role and the **new** role, and both inside `assignRoles` (when set). Appointing or
  demoting an HOD moves accounts between faculty and HOD, so both must be in `assignRoles`.
- Admin and Super Admin are never creatable, assignable or delegatable; aliases such as
  `SUPER_ADMIN` or `super_admin ` are rejected as unknown roles.
- An Admin assigns policies only to other **policy-managed** Admins (never itself, a Super Admin
  or a legacy Admin), only within `own policies ∩ grantablePolicies`, at no wider scope.
- **No escalation through a chain:** granting another Admin `create`, `roles` or `policies` is
  refused unless a Super Admin has set that Admin's matching limit, and that limit lies inside the
  granting Admin's own.
- The Admin UI lists other Admins with only the delegatable permissions; the rest is shown as a
  count and kept unchanged on save (`merge: true`).
- Every refusal is written to the protected audit trail (`PRIVILEGE_ESCALATION_BLOCKED`) and to
  Security & Logs (`POLICY_DENIED`). Policies and delegation are read from the database on every
  request, so a change applies to the next request; there is no server cache to invalidate.

### Additional policies for staff accounts

Individual **faculty, HOD, principal, dean, AO, chairman, office and COE** accounts can be given
extra access on top of their role (Users page → a staff row → **Policies**). These policies only
**add** access: the account keeps everything its role allows and is never made deny-by-default
(`policyManaged` stays false). Security, warden, transport, student and alumni accounts cannot
hold policies.

| Module | Actions that may be given to staff |
|---|---|
| User Management | view, create, edit, suspend, export (export campus-wide only) |
| Staff Management | view |
| Security Logs | view |
| Activity Logs | view |

Never grantable to staff: changing roles, creating/editing/suspending staff accounts, assigning
policies, and the other modules (attendance, timetable, events, clubs…), whose screens behave by
role and would not honour a grant consistently. So a staff grant can never be used to escalate.

- **Who assigns:** the Super Admin (password re-entry), or a policy-managed Admin holding
  `user_management.policies` **and** `staff_management.edit` for that account's department, only
  within its own cap (`own policies ∩ grantablePolicies`). Granting account creation also needs
  the Admin to be able to create every ordinary role itself. Legacy Admins cannot assign.
- **How it is enforced:** `staffGrantGuard` (middleware/adminPolicy.js) matches the request
  against the same route → (module, action) map used for Admins; when the staff account holds that
  policy, the request is marked policy-authorized and `authorize()` / the confined-role guard accept
  it on that admin route only. Controllers then apply the same module and department-scope checks
  as for Admins (`adminAllows`, `userListScope`), including password resets.
- **API:** `GET /admin/users/:id/policies` (what the caller may see/grant), `PUT /admin/users/:id/policies`
  (`merge: true` keeps what the caller cannot see), `GET /admin/my-policies` (the staff account's own
  additional policies). Every change is audited (`POLICIES_CHANGED`, target role recorded) and the
  account is notified; revocation applies to the next request.
- **UI for the staff account:** the granted pages (Users, Security & Logs, Activity log) appear in
  its sidebar; on Users it sees only the buttons its policies cover.
- The Android app shows no admin pages to staff accounts; they use the web for granted pages.

Paths covered: `POST /admin/users`, `PATCH /admin/users/:id` (role), `POST /admin/role-assignments/
set-hod|demote-hod`, `PUT /admin/users/:id/policies`. There is no Admin bulk user-creation endpoint;
the alumni bulk import is not reachable by policy-managed Admins (not in the policy route map),
and legacy Admins remain unrestricted by design.

## Sensitive actions

Creating/editing admins, status changes, password resets, session revocation, policy
changes and every emergency operation require the Super Admin's password to have been
re-entered on the current session within 5 minutes (`POST /api/super-admin/reauth`).
Each is rate-limited and written to the **protected audit trail** (`AuditLog`): no TTL, no
API to edit or delete, and the model refuses updates and deletes. Routine Admin views
(Security & Logs, Activity, Users, People, search) never show Super Admin identities.

Admin password reset: the Super Admin sets a temporary password, which is never logged
or returned. All of that Admin's sessions are revoked and a password change is
enforced at the next sign-in.

## Emergency control

Page: `/ops/emergency-control` (not linked from any menu; Super Admin only, server-enforced).

| Mode | Effect |
|---|---|
| normal | Everyone can use VEXON. |
| maintenance | Ordinary users get a maintenance page (HTTP 503) and cannot sign in or open sockets. Sessions are kept. |
| lockdown | As maintenance, plus every non-Super-Admin session is revoked. |
| recovery | Access stays closed; run the health check (database, active Super Admin, backup status). Reopening to normal requires a passing check made after entering recovery, within 15 minutes. |

Allowed transitions: normal → maintenance | lockdown; maintenance → normal | lockdown | recovery;
lockdown → normal | maintenance | recovery; recovery → normal | maintenance | lockdown.
Lifting a lockdown (→ normal) reopens the whole site at once; users whose sessions the lockdown
revoked simply sign in again.
Transitions compare-and-set on a version number (concurrent or stale requests get 409;
repeating the current mode is a recorded no-op) and need the typed phrase `CONFIRM <MODE>`.
Nothing deletes data or backups. Super Admin access is never blocked.

These modes control the **application** only. They cannot take the Hostinger server or the
database offline; that needs separately authorised infrastructure access.

### Break-glass recovery

If no Super Admin can sign in while the platform is restricted:

```sh
cd server && node scripts/platform-mode.mjs normal   # recorded in the audit trail
# or set PLATFORM_MODE_OVERRIDE=normal in the server environment and restart
```

## Backup status

The app does not run backups. Have your backup job (e.g. a `mongodump` cron) write a JSON file
and point `BACKUP_STATUS_FILE` at it:

```json
{ "lastBackupAt": "2026-10-16T02:00:00Z", "lastVerifiedAt": "2026-10-12T03:00:00Z", "lastResult": "ok" }
```

## Known limitations

- No MFA exists in the project; sensitive actions use password re-entry instead.
- Department scope is enforced for User/Staff Management only; other modules are campus-wide.
- Super Admin may read the protected audit trail; an independent auditor role is not implemented —
  restrict direct database access to the `auditlogs` collection at the infrastructure level.
- Chat oversight is read-only and fully audited. Make sure your institution's policy informs users
  that chats may be reviewed by the platform administrator.
- Parent gate-pass OTP cards are visible only to the Super Admin (removed from Admin → Security & Logs).
  The development-only OTP portal (`/dev/otp`, disabled in production) is unchanged.
- The Android app has no Super Admin screens (Super Admin sign-in is web-only); policy-managed
  admins on Android see the same server denials as on the web.

## Security Operations (SOC)

The Super Admin console has a **Security Ops** page (`/super-admin/soc`): security alerts, error explorer, incidents, system health, registered diagnostics, the error catalog with repair guides, and coverage. See [SOC.md](SOC.md).
