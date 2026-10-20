# Admin policy checkboxes

Branch: `feature/admin-policy-checkboxes`, created from `security/audit-fixes-r1`. Local only, not pushed.

In the Super Admin console each dashboard is now one checkbox for a policy-managed Admin:

- **Ticked:** the item shows in that Admin's sidebar, its pages open, and its API works.
- **Unticked:** the item is hidden, its pages redirect to the Dashboard with a message, and its API returns `403 POLICY_DENIED`.

Legacy (not policy-managed) Admins and every other role are unchanged.

## The shared module list

**Source of truth:** `server/src/constants/adminModules.js` (`ADMIN_MODULES`, `ADMIN_MODULE_SECTIONS`, `ADMIN_MODULE_KEYS`). Each module has:

| Field | Meaning |
|---|---|
| `key` | returned by the API, e.g. `gatePass` |
| `label` | shown on the checkbox and in the sidebar |
| `section` | `menu`, `campus` or `administration` (the sidebar's headers) |
| `nav` | client route prefixes |
| `api` | API route prefixes (relative to `/api`) |
| `policies` | the policy-catalogue modules the checkbox grants |

The client never hardcodes the list. This follows the repo's existing pattern of serving the policy catalogue from the API. The client gets the list from:

- `GET /api/account/modules`: the signed-in account's modules plus the list's `key`, `label`, `section` and `nav`.
- `GET /api/super-admin/policies/catalogue`: now also returns `adminModules` and `adminModuleSections`.

**How a checkbox maps to policies:**
- **Modules backed by an existing fine-grained catalogue entry** (Attendance, Timetable, Events, Clubs, People & Users, the two logs) keep their per-action rules. Ticking grants every action.
- **Every other module** gets a generated catalogue entry with one action, `use`. Its API prefixes are guarded with that action (`USE_RULES` in `middleware/adminPolicy.js`). The entries are generated from the list in `policies.js`, so the list stays the only place to edit.

## Modules and the routes they cover

| Key | Label | Section | Client routes | API prefixes (`/api…`) | Catalogue module(s) |
|---|---|---|---|---|---|
| `announcements` | Announcements | Menu | `/announcements` | `/announcements` | `announcements` (use) |
| `events` | Events | Menu | `/events` | `/events` | `events` (existing actions) |
| `clubs` | Clubs | Menu | `/clubs`, `/admin/clubs` | `/clubs` | `clubs` (existing) |
| `discussions` | Discussions | Menu | `/discussions` | `/discussions` | `discussions` (use) |
| `people` | People & Users | Menu | `/people`, `/admin/users` | `/users`, `/admin/users`, `/admin/role-assignments`, `/admin/policy-targets` | `user_management`, `staff_management` (existing) |
| `notifications` | Notifications | Menu | `/notifications` | `/notifications` | `notifications` (use) |
| `chat` | Chat | Campus | `/chat`, `/admin/chat-requests` | `/chat` | `chat` (use) |
| `timetable` | Timetable | Campus | `/timetable`, `/admin/academics` | `/timetable`, `/subjects`, `/exams` | `timetable` (existing) |
| `transport` | Bus Tracking | Campus | `/transport` | `/transport` | `transport` (use) |
| `studyMaterials` | Study Materials | Campus | `/study-materials` | `/study-materials`, `/ai/study-assistant` | `study_materials` (use) |
| `achievements` | Achievements | Campus | `/achievements` | `/achievements` | `achievements` (use) |
| `innovationGallery` | Innovation Gallery | Campus | `/skill-wallet/gallery`, `/skill-wallet/projects`, `/skill-wallet/portfolio` | `/skill-wallet` | `innovation_gallery` (use) |
| `attendance` | Attendance | Campus | `/attendance`, `/admin/attendance` | `/attendance`, `/staff` | `attendance`, `staff_attendance` (existing) |
| `gatePass` | Gate Pass | Campus | `/gate-pass` | `/gate-pass` | `gate_pass` (use) |
| `hostel` | Hostel | Campus | `/hostel` | `/hostel` | `hostel` (use) |
| `lostFound` | Lost & Found | Campus | `/lost-found` | `/lost-found` | `lost_found` (use) |
| `grievances` | Grievances | Campus | `/complaints`, `/admin/complaints` | `/complaints` | `grievances` (use) |
| `alumni` | Alumni Network | Campus | `/alumni` | `/alumni`, `/mentorship`, `/mentorship-requests` | `alumni` (use) |
| `sos` | Emergency SOS | Campus | `/sos` | `/sos` (raising an SOS, `POST /sos`, stays open to everyone) | `sos` (use) |
| `insights` | Insights | Campus | `/analytics` | `/analytics` | `insights` (use) |
| `analytics` | Analytics | Administration | `/admin` | `/admin/analytics` | `admin_analytics` (use) |
| `moderation` | Moderation | Administration | `/admin/reports` | `/reports` | `moderation` (use) |
| `activityLog` | Activity log | Administration | `/admin/activity` | `/admin/activity` | `activity_logs` (existing) |
| `securityLogs` | Security & Logs | Administration | `/admin/security` | `/admin/security` | `security_logs` (existing) |

**Always open to a policy-managed Admin**, with no checkbox:
- the Dashboard (`/api/dashboard`)
- its own account (`/api/auth/*`, `PUT /api/users/me`, devices)
- `GET /api/admin/my-policies` and `GET /api/account/modules`
- holidays (read)
- raising an SOS
- client error reports

**Grouping decisions:** some sidebar items share an API, so they share one checkbox:
- People + Users (both are User and Staff Management)
- Chat + Group requests (`/chat/requests`)
- Clubs + Club approvals
- Timetable + Academics
- Attendance (Campus) + Attendance (Administration)
- Grievances + the grievance dashboard

The Skill Wallet student wallet, Skill Wallet Review and Innovation Management are not shown to the `admin` role at all, so they have no checkbox.

## Server changes

- **`server/src/constants/adminModules.js` (new):** the list.
- **`server/src/policies.js`:**
  - generates the `use` catalogue entries;
  - `adminModulesFor(user)` returns the effective module keys: all of them for a legacy Admin, the modules with at least one granted action for a policy-managed Admin, and `null` for other roles;
  - `modulesToPolicies(keys, previous)` returns exactly the ticked modules' policies. A module that stays ticked keeps its existing grants, so fine-tuned actions and department scopes survive a checkbox save. A newly ticked module gets every action, campus-wide. An unticked module loses its grants.
- **`server/src/middleware/adminPolicy.js` (the existing deny-by-default guard; only policy-managed Admins are affected):**
  - Notifications, Announcements (read) and `/admin/analytics` left the always-open baseline and are now modules.
  - `USE_RULES` guards every `use` module's API prefixes.
  - `/exams` was added to the Timetable rules. Before, a policy-managed Admin was refused it even with Timetable granted.
  - `POST /uploads` is allowed for an Admin holding at least one module. Before, every policy-managed Admin was refused it, so module forms with images could not work.
  - `GET /account/modules` was added to the baseline.
- **Endpoints:**
  - **new** `GET /api/account/modules`: authenticated, `Cache-Control: no-store`, and computed from the user loaded fresh on every request (no cache).
  - **new** `PUT /api/super-admin/admins/:id/modules {modules: [...keys]}`: Super Admin only, requires re-authentication like the other sensitive Super Admin routes, validated (unknown key → 422). It goes through the existing policy service (`applyPolicies`: audit trail, notification, conditional write) and returns the Admin plus `modules`.
  - **changed** `GET /api/admin/my-policies` now includes `modules`.
  - **changed** `GET /api/super-admin/policies/catalogue` now includes `adminModules` and `adminModuleSections`.
  - **changed** the policy-list size limits went from 20 to 40 on the four policy routes, because the catalogue grew from 9 to 26 modules.

## Client changes

- **`client/src/utils/adminModules.js` (new):** pure helpers: path → module (longest prefix), `routeAllowed`, `navItemAllowed`, grouping, and checkbox ↔ policy-draft conversion (mirrors the server's `modulesToPolicies`).
- **`client/src/components/layout/navItems.js` (new):**
  - the sidebar's item lists, moved unchanged from Sidebar.jsx;
  - `sidebarSections(user, {account, myPolicies, swRoles})`. A policy-managed Admin sees the Dashboard plus the items of its ticked modules. While the module list is loading, an Admin sees the Dashboard only, so there is no flash of hidden items.
  - The old hardcoded `NAV_POLICY` map is replaced by the server-provided module list.
- **`Sidebar.jsx`:**
  - renders `sidebarSections` with the live `GET /account/modules`, re-read every 60 s;
  - the chat and group-request badges poll only when their item is visible.
- **`App.jsx` (`ModuleGuard`):** for a policy-managed Admin, opening a page of an unticked module redirects to the Dashboard with a toast:
  - "You do not have access to X" on direct navigation;
  - "Your access to X was turned off by a Super Admin" when it was removed while the Admin was signed in.
- **`services/api.js`:**
  - on any `403 POLICY_DENIED`, the base query invalidates `AccountModules` and `MyPolicies` (at most every 3 s);
  - the module list is refetched, the sidebar drops the item, and the guard leaves the page with the message. The page shows its normal error state for that one request; it does not crash.
- **`NotificationBell.jsx`, `Dashboard.jsx`:** the bell, the attendance widget and the achievements widget are hidden, and stop polling, for a restricted Admin without those modules.
- **`services/superAdmin.js`:** `useGetAccountModulesQuery`, `useSetAdminModulesMutation`.
- **Super Admin console** (`components/superadmin/ModuleCheckboxes.jsx` new, `pages/superadmin/SuperAdmin.jsx`):
  - New Admin and the Admin detail show one checkbox per module, grouped under Menu / Campus / Administration, with Tick all / Clear all.
  - A module granted narrower than "everything" is labelled *custom*.
  - "Save dashboards" writes the ticked keys with `PUT …/modules`.
  - The previous per-action editor is kept as an optional "Fine-tune actions and data scopes" panel. If it was used, the exact policies are saved with `PUT …/policies`, as before.

## Tests

`server/tests/admin-policy-checkboxes.test.js` (7 tests, all pass):

- the list and the per-module probe routes stay in step;
- **only `gatePass` and `hostel` ticked:** both APIs return 200, and a read route of every one of the other 22 modules returns 403 `POLICY_DENIED`; a write is refused too; raising an SOS is not blocked;
- `GET /account/modules` returns exactly `['gatePass','hostel']` with `no-store`, and `/admin/my-policies` carries the same list;
- **no caching:** unticking Hostel shows on the very next `/account/modules` call and the Hostel API returns 403 immediately; re-ticking restores it;
- each module ticked on its own opens its own probe route and not another module's;
- a legacy Admin gets every module and no route returns `POLICY_DENIED`;
- students and faculty get `modules: null`, and their access is unchanged (notifications, announcements);
- `PUT …/modules` is refused for an Admin (403) and rejects unknown keys (422, nothing saved); a checkbox save keeps a fine-tuned department-scoped grant; the change is in the audit trail.

`client/tests/adminPolicyCheckboxes.test.mjs` (7 tests, all pass) uses the server's own module list as the mocked `/account/modules` response:

- with `['gatePass','hostel']` the sidebar shows exactly Dashboard, Gate pass and Hostel;
- multi-module sidebars come out in the right sections;
- with nothing ticked, or the list still loading, the sidebar shows the Dashboard only;
- a legacy Admin and other roles see their full sidebar;
- every Admin sidebar item belongs to a module, and every module has an item;
- route-guard decisions;
- the checkbox editor produces the same policies as the server's `modulesToPolicies`.

**Full runs:**

| Run | Result |
|---|---|
| Server `npm test` | 886 tests: 882 pass, **4 fail** |
| Client `npm test` | **84/84 pass** |
| Client `npm run build` | **success** |

The 4 server failures are the same pre-existing ones documented in `AUDIT_FIXES_R1.md`. They fail identically on the base `85b5ddb`, and none involves this change:
- **`gate-exit-campus-day` (2 tests):** the clock is pinned to 2026-10-10, which is now in the past.
- **`admin-delegation` #7:** a later rule refuses policies sent with "No Additional Policies".
- **`staff-policies:140`:** `attendance` became staff-grantable.

No existing test was changed.

## Not done, limits

- **No browser check:** the UI was not tested in a browser. The client test checks the sidebar *selection* (`sidebarSections`), not a rendered DOM, because the repo's client tests are plain Node with no React renderer.
- **Existing policy-managed Admins lose access:** they lose Notifications, Announcements and the Administration › Analytics page until a Super Admin ticks those modules. That is the requested "none ticked = no modules" rule, but it does change behaviour for accounts that exist today.
- **Real-time events still arrive:** a restricted Admin without Notifications or Chat still receives Socket.IO real-time events (the bell and pages are hidden and their APIs refused). Gating socket emits per module was not in scope.
- **Global search** (`/api/search`) belongs to no module and is still refused for policy-managed Admins, as before.
- **Mobile apps** (Kotlin and iOS) were not changed. The server enforces the same 403s for them, but their menus do not yet hide unticked modules. The memory rule to rebuild APKs did not apply, because `mobile-kotlin` was not touched.
- **Delegated Admins:** delegated policy assignment (`AdminPoliciesTab`, an Admin with User Management → policies) still uses the per-action editor. The new modules appear there as one-action (`use`) entries the delegating Admin can hand out only if it holds them.
