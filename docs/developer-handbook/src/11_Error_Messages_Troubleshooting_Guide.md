---
title: Error Messages and Troubleshooting Guide
subtitle: Every message VEXON can show - what it means, what the user should do, and what you should check as the developer
number: 11
audience: The VEXON developer, and the staff or students you support when something on the screen says "failed" or "try again"
---

# How to use this guide

When VEXON shows an error, whether in a red toast, a message under a form field, or a banner in the Android app, the text comes from one of three places:

| Where the text comes from | Example | Where it is written |
|---|---|---|
| The **server** (most messages) | "Invalid email or password. 2 attempt(s) remaining before 5-minute lock." | `throw new ApiError(...)` in `server/src/controllers/`, `services/`, `middleware/` |
| The **form rules** on the server | "Password must be 8-72 characters" | `.withMessage(...)` in `server/src/routes/index.js` |
| The **app itself** (no server involved) | "Cannot reach the server", "Location permission denied..." | `client/src/utils/format.js`, `client/src/pages/transport/myLocation.js`, `client/src/utils/returnLocation.js`, Kotlin `core/Http.kt` |

**Fastest way to find a message:** open this PDF and press **Ctrl+F**. Type a few words of the message exactly as shown. Numbers and names inside messages change, so search for the fixed words (for example "attempt(s) remaining", not "2 attempt(s)").

Each entry tells you:

- **Meaning**: what happened, in plain English.
- **User should**: what to tell the student or staff member.
- **Developer check**: the file and rule to look at if the message seems wrong.

> [!KEY] Most messages are **not bugs**. They are VEXON's rules working correctly (wrong password, wrong role, a deadline passed). Only treat a message as a bug when the user *should* be allowed to do the thing and the message says otherwise, or when you see **"Something went wrong"** or **"Internal server error"**.

> [!NOTE] Part 1 explains the messages you will meet most often. The **Appendix** at the end lists **every** message in the server code (generated automatically from the source), with the exact file and line where it is produced.

# Decode any error in 30 seconds

Every server error has a **status code**. The user never sees it, but you can: open the browser's DevTools (F12), go to the Network tab, click the red request, and read the status. The code tells you the *kind* of problem before you even read the words.

| Code | Plain meaning | Is it a bug? | First thing to do |
|---|---|---|---|
| 400 | The request was malformed (a bad id, a missing file) | Rarely | Retry from the screen; check the URL or id |
| 401 | Not signed in, or the session ended | No | Sign in again |
| 403 | Signed in, but **not allowed** to do this | Usually no | Check the user's role, department and class |
| 404 | The thing does not exist (or is hidden from this user) | Sometimes | Refresh; check whether it was deleted or expired |
| 409 | A conflict: a duplicate, already done, or changed by someone else | Rarely | Refresh the page and try again |
| 410 | Expired or retired | No | Start that step again (new code or new link) |
| 413 | Too large (file or form) | No | Use a smaller file |
| 415 | File type not allowed | No | Use an allowed type (JPG, PNG, WEBP, GIF, PDF, DOC/DOCX, TXT) |
| 422 | A form value broke a rule | No | Fix the field named in the message |
| 423 | Account temporarily locked | No | Wait the minutes shown, or ask an admin |
| 429 | Too many requests too fast | No | Wait, then try again |
| 500 | Unexpected server error | **Yes** | Read the server log (`[error]` stack trace) |
| 502 / 503 / 504 | An outside service (SMS, AI) failed or is not set up | Configuration | Check that service and its settings |
| No code ("failed", "Cannot reach the server") | The request never got an answer | Network or server down | Check the internet; check the server is running or awake |

# Signing in and sessions

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| Invalid email or password. [N] attempt(s) remaining before [N]-minute lock. | Wrong email **or** wrong password. VEXON never says which one, for security. | Check spelling and Caps Lock. Use the college email exactly as given. After 3 wrong tries the account locks for a while. | `authController.login`; `SecurityLog` shows the real reason (`unknown_account` or `invalid_password`) |
| Too many failed attempts. Account locked for [N] minute(s). | The account just reached 3, 6, 9 or 12+ failures in a row. The lock grows: 5, 10, 30, then 60 minutes. | Wait for the countdown shown on the login page. If they forgot the password, ask the Class In-Charge or an Admin to reset it. | `authController.login`, `calculateLockoutMs` in `server/src/utils/loginSecurity.js`; the user also gets an in-app security alert |
| Too many failed attempts. Try again in [N] minute(s). | The account is already locked. | Wait for the countdown. Do not keep trying: each attempt is recorded. | `User.lockUntil` |
| Too many failed sign-in attempts from this network. Try again in [N] minute(s). | Many failures came from the **same internet address**. A college Wi-Fi shares one address, so one person's mistakes can lock out others nearby. | Wait the minutes shown, or use mobile data. | `checkIpThrottled` (`server/src/utils/loginSecurity.js`). If it hits everyone at once in production, check `TRUST_PROXY` (Guide 08) |
| A sign-in for this account is already in progress. Please try again in a moment. | Two sign-ins for the same account arrived at the same moment (a double tap, or two devices). | Wait two seconds and press Sign in once. | `acquireLoginLease` in `authController.js` |
| This account has been suspended. Contact the administrator. | An admin set the account to inactive. | Contact the admin. | Admin, Users: the account's active status |
| Self sign-up is disabled. Your account is created by the college administrator. | Public registration is switched off (normal). | Ask the Class In-Charge (students) or the Admin (staff) for an account. | `ALLOW_SELF_SIGNUP` (off by default) |
| Please sign in to continue | The request carried no sign-in token. | Sign in. | `protect` in `server/src/middleware/auth.js` |
| Your session has expired | The 15-minute access token expired and could not be renewed. | Sign in again. | Normally renewed automatically by `refreshSession()`; if this appears often, check the refresh cookie and CSRF |
| Your session has ended. Please sign in again. | This device's session was signed out: logout, "sign out other devices", a password reset, or a role change. | Sign in again. If they did not sign out, they should change their password. | `Session.revokedAt`, `revokedReason` |
| Your session expired due to inactivity. Please log in again. | **Web only.** 2 minutes without any click, key press or scroll ended the session. Students, club admins, COE, office, transport and alumni web accounts have this rule. | Sign in again. This is a security rule, not a fault. Use the Android app to stay signed in longer. | `server/src/utils/sessionIdle.js` (`WEB_IDLE_EXEMPT_ROLES`) |
| Session expired due to inactivity. Please sign in again. | No use at all for 7 days (any device). | Sign in again. | `authenticateAccessToken` in `middleware/auth.js` |
| Account is unavailable | The account was deleted or deactivated while signed in. | Contact the admin. | The `User` document's `isActive` field |
| Too many session-refresh attempts. Please sign in again. | The app tried to renew the session too many times in 15 minutes. | Sign in again. | `refreshLimiter` in `server/src/middleware/rateLimit.js`; repeated loops point to a client bug |
| Current password is incorrect | On Change Password, the old password was wrong. | Re-type the current password. | `authController.changePassword` |
| New password must be different from the current one | The new password equals the old one. | Choose a different password. | Same |
| Password must be 8-72 characters / must contain a letter / must contain a number | The new password breaks a rule. | Use 8 or more characters with at least one letter and one number. | `password()` validator in `routes/index.js` |
| Forgot your password? Contact your Class In-Charge or Admin to reset your password. | There is no email reset in VEXON (it was retired). | Ask the Class In-Charge (students) or an Admin. | `POST /api/users/:id/reset-password` |

# Permissions: "you are not allowed"

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| You do not have permission to perform this action | This **role** may not use this feature at all. | Nothing to fix if the role is right; ask the admin if they believe they should have access. | The `authorize(...)` list on that route in `routes/index.js`; role lists in `server/src/constants.js` |
| The Controller of Examinations can only use the Timetable and Attendance dashboards | COE accounts are fenced to their own pages. | Use Timetable or Attendance only. | `server/src/middleware/coeGuard.js` |
| The Office account can only view attendance and attendance reports | Office accounts are read-only, attendance only. | As above. | `coeGuard.js` |
| The transport account can only use Bus Tracking | Transport accounts are fenced to Bus Tracking. | As above. | `coeGuard.js` |
| Not authorized / Not authorized to view this profile | The record belongs to someone outside your scope (another class, another department). | Nothing; this is privacy protection. | The controller's scope check (`peopleScope.js`, `academicScope.js`) |
| You can only ... for your own department / your own class | The HOD or faculty member tried to act outside their department or class. | Ask the right HOD, or the admin. | Scope helpers; the user's `department`, `section`, `inChargeYear` |
| First Year HOD can only manage 1st year subjects and timetables | The Science & Humanities HOD owns 1st year only. | Ask the branch HOD for years 2-4. | `isFirstYearHod` in `constants.js` |
| Your access to attendance is read-only | Principal, dean, AO, chairman, COE and office may view attendance but not mark it. | Nothing to fix. | `ATTENDANCE_READ_ONLY_ROLES` |
| Invalid or expired CSRF token | **Web security check failed** on a save. Usually an old cookie after an update, or an open tab from a previous sign-in. | Refresh the page. If it repeats, sign out and sign in again. | `server/src/middleware/security.js`, `client/src/services/csrfCookie.js`; tests `csrf-legacy-cookie`, `csrf-self-heal` |
| Cross-origin request blocked by security policy | The page was opened from an address the server does not trust. | Open VEXON from its official address only. | `CLIENT_URL` / `APP_URL` must list the real public address |
| Your account has no department ... on file - ask an admin to set it | The account is missing class data that this feature needs. | Ask the admin to complete the profile (department, section, year). | Admin, Users: the user's department and section |

# Connection and server problems

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| Cannot reach the server | The browser got **no answer** (offline, server stopped, or server sleeping). | Check the internet and try again in 30 seconds. | Is the server running? On Render's free plan the first visit after sleeping takes about 30 s (Guide 08). Check `/api/health` |
| Cannot reach the JNN server - check your internet connection (Android) | Same, in the Android app. | Check mobile data or Wi-Fi; try again. | The server address on the login screen (Server, then Test & save) |
| The server is taking too long - please try again (Android) | No reply within 20 seconds. | Try again; on a slow network, wait. | Server logs; slow queries; Render waking up |
| Offline - reconnecting... (Android banner) | The app lost the connection and is retrying by itself. | Wait; it clears automatically when the connection returns. | Nothing unless it never clears |
| Reconnecting... / no "Live" badge (web) | Live updates paused; the page still works but may be out of date. | Refresh the page if it does not come back. | Socket.IO connection (Guide 06, Socket section) |
| Something went wrong | A generic fallback: the server sent no readable message, or the app could not tell what failed. | Try once more. If it repeats, report the exact steps. | **Treat it as a bug.** Read the server log for `[error]` at that time |
| Internal server error | A 500 in production: the server hit an unexpected error and hid the details. | Report it with the time and the steps. | The server log has the full stack trace (Guide 06, "Reading a stack trace") |
| Route not found: [METHOD] [URL] | The app called an address that does not exist. | Refresh (an old app version may be cached). | Mismatch between `client/src/services/api.js` and `routes/index.js`; a stale Android build |
| Too many requests, please slow down | More than 1,000 requests in 15 minutes from one address. | Wait 15 minutes. | `apiLimiter`; a client stuck in a loop |
| You are posting too fast. Please wait a moment. | More than 40 saves in a minute. | Wait a minute. | `writeLimiter` |
| Request body too large | The form sent more than 200 KB of data. | Shorten the text; attach files separately. | `express.json({ limit: '200kb' })` in `app.js` |
| Could not load data (Android) | A screen's data request failed. | Pull to refresh or reopen the screen. | The request's status in the server logs |

# Saving forms and data

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| (any message naming a field, e.g. "Name must be 2-80 characters", "Enter a valid email") | A form value broke a rule. | Correct that field exactly as the message says. | `body('field')...withMessage(...)` in `routes/index.js` (the Appendix lists all of them) |
| Invalid id / Invalid [field] | The link or record id is broken. | Go back and open the item again from the list. | `idParam` (`middleware/validate.js`) or a Mongoose `CastError` (`middleware/error.js`) |
| That [field] is already in use / An account with this email already exists | A value that must be unique already exists. | Use a different email or number, or edit the existing record. | Unique index (MongoDB error 11000), mapped in `middleware/error.js` |
| ... was just reviewed / updated / changed by someone else | Two people acted on the same item at the same moment; the other person was first. | **Refresh the page** and look at the new status before acting again. | Optimistic concurrency in the controller (correct behaviour) |
| [Thing] not found | The item was deleted, expired, or is not visible to this user. | Refresh the list. | Is the document present? Does the user's scope include it? |
| ... cannot be in the past / cannot be before ... / must be after ... | A date or time is in the wrong order or already passed. | Choose a valid date or time. | The date checks in that controller |

# Uploading files and images

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| Only JPG, PNG, WEBP or GIF images are allowed | The file is not a real image of those types. Renaming a file does not work: VEXON checks the file's content. | Export or save the picture as JPG or PNG and upload again. | `persistFile` in `server/src/utils/storage.js` (magic-byte check) |
| Only JPG, PNG, WEBP, GIF, PDF, DOC, DOCX or TXT files are allowed | Same, for documents. | Save the document as PDF and retry. | Same |
| File too large (max 5 MB) / Image must be under 5 MB | The file is bigger than the limit. | Compress the photo or PDF and retry. | `MAX_UPLOAD_MB` (default 5) |
| Upload limit reached. Try again later. | More than 30 uploads in 10 minutes. | Wait 10 minutes. | `uploadLimiter` |
| No file uploaded / A file is required | The form was sent without a file. | Choose the file again, then submit. | The multipart field must be named `file` |
| Maximum 5 images allowed | Too many images on one post. | Remove some images. | Client-side limit in the form |

# Gate pass and parent OTP

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| Your parent's mobile number is not on file - ask the administrator to add it before requesting a gate pass | The parent number is required for the OTP check, and it is missing. | Ask the admin or Class In-Charge to add the parent's number. | The student's `parentPhone` |
| You already have a pending or active gate pass | Only one open pass per student. | Wait for the current pass to finish, or cancel it if it is still pending. | Statuses in `GATE_PASS_PENDING_STATUSES` plus `active` |
| Your gate pass request is already being processed | A double tap sent two requests. | Wait; check My passes. | `gatePassLockUntil` |
| Day scholars request an Outing pass instead / Outing passes are for day scholars only | Hostellers and day scholars use different pass types. | Choose the correct pass type. | The student's `stayType` |
| A gate pass can cover at most 30 days | The date range is too long. | Shorten the dates. | `createGatePass` |
| Verify the parent's OTP before forwarding to the HOD | The class faculty must confirm the parent by OTP first. | Faculty: press Send OTP, enter the code the parent receives, then forward. | `facultyReview` and `forwardFrom: 'parent_verified'` |
| Only the student's class faculty can verify this request | Another faculty member tried to do the OTP step. | The student's own Class In-Charge or class faculty must do it. | `isClassFaculty` |
| Please wait [N] second(s) before requesting another OTP | An OTP was sent just now; there is a short cool-down. | Wait for the countdown, then resend. | `OTP_RESEND_COOLDOWN_SECONDS` (default 60) |
| Too many OTP requests. Please wait a few minutes. | Too many OTP sends from this network. | Wait a few minutes. | `otpLimiter` |
| Could not send the OTP. Please try again. / Could not reach the SMS service / The SMS service rejected the message | The SMS gateway failed or refused. | Try again shortly. If it keeps failing, use the alternate-number option or contact the admin. | Server log; the vendor; `SMS_*` settings and DLT template ids |
| The college SMS service is not configured yet. Ask an administrator. | SMS sending is switched on, but its settings are missing. | Contact the admin. | `OTP_SMS_ENABLED=true` without the `SMS_*` variables. Either set them or switch SMS off (admins then read OTPs in Security & Logs, then OTP) |
| The parent mobile number is not a valid 10-digit number. | The stored parent number is malformed. | Ask the admin to correct it. | The student's `parentPhone` |
| Say why the OTP is going to a different number | Sending to an alternate number needs a reason. | Faculty: type a short reason (for example "parent not reachable"). | `parent-otp-alternate-mobile` test |
| Your QR code and code will be generated at [time] | Bulk-approved passes get their codes a few at a time. | Check again after that time. | `server/src/services/gatePassCodeQueue.js` |
| Invalid or already-used verification code | At the gate: the code is wrong, already used, or the pass expired. | Security: re-type the 4 characters carefully; the student should open the pass and check its status. | `verifyGatePass` (it first expires old passes) |
| Enter a valid 4-character gate pass code (letters and numbers) | The code typed is not 4 letters or digits. | Re-type it. | `normalizeGateCode` |
| This pass has expired | The validity window passed. | Request a new pass. | `verificationExpiry`; `expireGatePasses` |
| Exit has already been recorded / This student's return has already been recorded | The gate step was already done. | Nothing; check the pass history. | `recordOut` / `recordIn` |
| The student has not exited on this pass | Return was attempted on a pass with no recorded exit. | Security: record the exit first, or check the right pass. | Pass status must be `active` |
| No return code yet - verify your location first / Your return code has expired. Verify your location again. | The return-to-campus check needs a fresh location verification. | Student: press Verify my location on campus, then show the new code. | `server/src/services/gatePassReturn.js`, `RETURN_CREDENTIAL_MINUTES` |
| Your location is not accurate enough yet (about +/-[N] m) | The phone or laptop location is too rough to prove you are on campus. | Go outdoors or near a window and use the phone app; laptops without GPS are often too imprecise. | `LOCATION_MAX_ACCURACY_METERS`; `client/src/utils/returnLocation.js` |
| Your device is sharing only an approximate location ... | Precise location is switched off for the browser or app. | Turn on precise location (the message shows where) and retry. | Device setting, not a server problem |

# Attendance

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| Attendance opens at [time] | Too early: the period has not started. | Wait until the period starts. | The period window in `attendanceController.js` |
| This period has ended - attendance is closed | Too late for this period today. | Ask the HOD, who can correct it for today. | Same |
| Attendance can only be taken on the day of the class | It cannot be marked for another day. | Mark it on the day; for past days use a correction request. | Same |
| Attendance cannot be marked for a future date | The date is in the future. | Pick today. | Same |
| This period is assigned to another faculty member / Take attendance from your timetable period | Only the timetabled faculty member can take this period. | Open the period from your own timetable (My Classes). | `TimetableSlot.faculty` |
| A substitute has been assigned to take this period today | A cover teacher was assigned. | The substitute takes it. | `PeriodCover` |
| HOLIDAY - [reason]. Attendance cannot be taken for this class on this date. | The Principal declared a holiday. | Nothing to do; no attendance is needed. | `server/src/services/holidays.js` |
| Regular attendance is blocked for this period: the [subject] exam is scheduled ... | A published exam covers this period. | Nothing to do; exam attendance is automatic. | `server/src/services/exams.js` (`examBlockMessage`) |
| This period is recorded as Class Not Conducted - the HOD must cancel that before attendance can be taken | The period was marked as not held. | Ask the HOD to undo it. | `attendanceController.js` |
| Some students are not in [subject] ... | The list sent contains students outside this class. | Refresh the roster and mark again. | `rosterFilter`; a stale roster on screen |
| A student appears more than once | A duplicate entry in the submitted list. | Refresh and re-mark. | Client roster state |
| On Duty can only come from an approved OD request or a registered event | "OD" cannot be chosen by hand. | Mark present or absent; OD appears automatically once approved. | `odLeaveController.js` |
| A correction request for this period is already pending | The student already asked for this period. | Wait for the faculty or HOD decision. | `AttendanceCorrectionRequest` |
| This request was just reviewed by someone else | Two reviewers acted at once. | Refresh. | Correct behaviour |

# Timetable, exams and holidays

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| These exams overlap for the same students: ... | Two exams for the same class clash in time. | Change one exam's date or time. | `examController.js` clash check |
| ... the exam date cannot be in the past | The date has passed. | Choose a future date. | Same |
| This exam has already started - it can no longer be edited | It is too late to change it. | Cancel it and create a new one if really needed. | Same |
| Only a draft can be published | It is already published or cancelled. | Refresh to see its status. | `EXAM_STATUSES` |
| Only the Principal can manage holidays | Only the Principal may declare holidays. | Ask the Principal's office. | `HOLIDAY_MANAGE_ROLES` |
| The "To" date cannot be before the "From" date | Dates are reversed. | Swap them. | `holidayController.js` |
| (slot clash messages when editing a timetable) | The section, faculty or room is already booked at that time. | Choose another period, room or faculty. | `timetableController.js` clash checks; the `unique_active_slot` index |

# Complaints and SOS

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| Only student accounts can register a grievance | Staff cannot file grievances here. | Use the official staff channel. | `createComplaint` |
| Invalid "escalate to" authority for this category | The chosen authority does not handle this category. | Choose from the list shown for that category. | `COMPLAINT_ESCALATE_TO` |
| The waiting period for escalation has not elapsed yet | "Not resolved" opens 8 hours after the complaint was raised. | Wait and try again later. | `COMPLAINT_NOT_RESOLVED_WAIT_MS` |
| You are not the current authority for this grievance | It has moved to someone else (escalated). | Nothing; the new authority handles it. | `currentAuthorityUserId` |
| A [status] grievance cannot be cancelled / escalated | Too late in its life cycle. | Nothing. | `COMPLAINT_CANCELLABLE_STATUSES` |
| You have raised several alerts in the last few minutes. Responders have been notified - please call campus security directly. | The SOS limit (5 in 10 minutes) was reached. Earlier alerts **were** delivered. | Phone campus security directly. | `sosController.createAlert` |
| This alert is already closed / Resolution note is required | Responder actions on an SOS. | Refresh; type a note when resolving. | `sosController.js` |

# Chat

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| This conversation is outside your chat scope | VEXON limits who can privately message whom (class, department). | Use a group or contact through the proper staff member. | `server/src/utils/chatScope.js` |
| Not a member of this conversation | The user was removed, or the link belongs to someone else. | Ask a group admin to add them. | `Conversation.participants` |
| Messages can only be edited within 5 minutes of sending | Editing time is over. | Send a new message instead. | `chatController.editMessage` |
| Messages cannot be edited in private chats / Message deletion is not allowed | These are deliberate rules. | Nothing. | `chatController.js` |
| Only admins, HODs and faculty can create group chats | Students cannot create groups. | Ask a faculty member. | Same |
| Only group admins can add / remove members | The user is a member, not an admin. | Ask the group admin. | `isGroupAdmin` |

# Bus tracking and "My location"

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| You do not have access to bus tracking | This role has no transport module (alumni, COE, office), or with "assigned" visibility the student has no assignment. | Ask the transport office to assign a route. | `TRANSPORT_VIEW_ROLES`, `TRANSPORT_STUDENT_VISIBILITY` |
| Location permission denied. Allow location access in your browser settings ... | The user said "Block" to location. | Allow location for the site, then press My location again. | Browser setting, not a server problem |
| Location is blocked for this site. Click the lock icon next to the address bar ... | Location was blocked earlier and the browser remembers it. | Lock icon, then Site settings, then Location, then Allow, then retry. | Same |
| Only an approximate location is available ... | The device gave a rough position (a laptop without GPS). | Turn on precise location, or use the phone app outdoors. | `client/src/pages/transport/myLocation.js` |
| Your device did not provide a GPS or Wi-Fi position. The browser fell back to an estimate from your internet connection ... | The position is the internet provider's city, possibly far away. It is shown as a shaded area, not a dot. | Turn on Windows Location with Wi-Fi, or use the phone. | Same (`sourceOf`, `AREA_ONLY_M`) |
| Finding your location took too long ... | No position within the time limit. | Move near a window or outdoors and retry. | Same (`MY_LOCATION_MS`) |
| Location only works on a secure (https://) connection ... | Browsers allow location only on https (or localhost). | Open VEXON through its https:// address. | Hosting must use HTTPS |
| This browser cannot share its location ... | Old or unusual browser. | Use current Chrome, Edge, Safari or Firefox, or the app. | Same |
| [bus number] already has an active trip - it must be stopped before another one starts | A trip for that bus is already running. | Stop the old trip first (or ask the transport office). | `server/src/services/transport/trips.js` |
| You are not assigned to share this bus's location | The staff member is not listed as tracking staff for this bus. | Ask the transport office to add them. | `Bus.trackingStaff` |
| This bus reports through its own GPS tracker | Phone sharing is not used for tracker buses. | Nothing to do. | `Bus.gpsSource` |
| Location updates are arriving too fast | The phone sent positions too often. | Nothing; the app slows down by itself. | `locationLimiter` |

> [!NOTE] A bus that is **not shown on the map** produces no message at all. It means no valid GPS fix has been accepted for it yet: the trip has not started, positions are too old or inaccurate, or the viewer may not see that bus. See the bus troubleshooting row in Guide 06.

# Study Assistant (AI)

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| The AI service is temporarily unavailable. Please try again later. | The AI provider is not configured or not responding. | Try later. | `GROQ_API_KEY` set? Provider status (`server/src/services/ai/groqService.js`) |
| The AI service is busy right now. Please try again in a minute. | The provider rate-limited VEXON. | Wait a minute. | Groq usage limits |
| The AI assistant is handling a lot of requests right now ... | VEXON's own queue is full. | Try again shortly. | `AI_MAX_CONCURRENT`, `AI_MAX_QUEUE` |
| The AI took too long to respond. Please try again. | Timed out. | Ask a shorter question, or retry. | `AI_REQUEST_TIMEOUT_MS` |
| You are asking questions too quickly ... / You have reached the hourly limit for the Study Assistant ... | Per-user limits (10 a minute, 60 an hour by default). | Wait. | `AI_RATE_LIMIT_PER_MINUTE`, `AI_RATE_LIMIT_PER_HOUR` |
| Please type a question / Questions can be at most [N] characters | Empty or too long. | Type a question, or shorten it. | `AI_MAX_MESSAGE_LENGTH` |
| This conversation was cleared. Please ask again. | The chat was deleted in another tab. | Start a new question. | `AIConversation` |

# Android app specific

| Message you see | Meaning | User should | Developer check |
|---|---|---|---|
| Cannot reach this address (on Server, then Test & save) | The address typed is wrong or unreachable from the phone. | Re-type the full address (https://...). A computer's `localhost` never works on a phone. | `core/Config.kt` (`checkServer`) |
| The server did not answer in time (Test & save) | The server is slow or sleeping. | Wait 30 s and test again. | Render free plan wake-up |
| CLEARTEXT communication not permitted (seen in logcat) | The app refused a plain http:// server. | Use the https:// address. | `usesCleartextTraffic` in `app/build.gradle.kts` (Guide 06) |
| No notifications arrive on the phone | No error message; push is not set up or permission is off. | Allow notifications for the app in Android settings. | `google-services.json` at build time; `FCM_SERVICE_ACCOUNT` on the server |

# Messages only the developer sees

These appear in the **server terminal** or **Render logs**, not on users' screens. Guide 06 has fuller explanations.

| Log message | Meaning | What to do |
|---|---|---|
| [db] Could not connect to MongoDB (local), attempt N/5 | The database is not reachable. | Start MongoDB; check `MONGO_URI` |
| DB_TARGET=atlas but MONGO_URI_ATLAS is not set in .env | Atlas was chosen without its address. | Set `MONGO_URI_ATLAS`, or `DB_TARGET=local` |
| Missing required environment variable: [NAME] | A production secret is missing; the server refuses to start. | Set it on the host (Render dashboard) |
| [env] [NAME] not set - using an insecure development default | A local secret is missing. | Fine locally; never in production |
| [error] ... (followed by a stack trace) | An unexpected exception (the user saw "Something went wrong" or "Internal server error"). | Read the first line that is inside `server/src/` and fix the cause |
| [mail] SMTP_HOST is not configured | Email (for example the lockout alert) was not sent. | Set the `SMTP_*` variables if email is wanted |
| EADDRINUSE :::5000 | Port 5000 is already used. | Stop the other process, or change `PORT` |
| Refusing to run tests against a non-test database | Safety stop in the tests. | Use a database name ending in `_test` |
| [MONGOOSE] Warning: `errors` is a reserved schema pathname | A harmless warning printed during tests. | No action needed |

# When the message is not in this guide

1. Search the **Appendix** below for a few fixed words of the message.
2. Still not found? Search the code: in VS Code press Ctrl+Shift+F and search the words in `server/src` and `client/src`. The file you find is where the message is made.
3. Note the status code from the Network tab, then use the "Decode any error" table.
4. Follow the debugging loop in Guide 06, and write an incident report if users were affected.

> [!TIP] When a user reports a problem, ask for three things: **the exact words on the screen (a screenshot is best), the time it happened, and what they clicked just before**. With those, the Appendix and the server logs will almost always lead you straight to the line of code.


\pagebreak

# Appendix A: every server error message

Generated from the source code by `build_error_catalog.py`: **640 distinct messages**. `[value]` marks a part that changes (a number, a name, a time). The code column is the HTTP status; the meaning of each code is in "Decode any error in 30 seconds". Source is the file under `server/src/` and the line number.

## Sign-in, sessions and accounts

| Code | Message | Source |
|---|---|---|
| 400 | Current password is incorrect | `controllers/authController.js:474` |
| 400 | Use your @jnn.edu.in college email to sign up | `controllers/authController.js:162` |
| 401 | Account is unavailable | `middleware/auth.js:40` |
| 401 | Invalid email or password. [value] attempt(s) remaining before [value]-minute lock. | `controllers/authController.js:233, controllers/authController.js:321` |
| 401 | No active session | `controllers/authController.js:370` |
| 401 | Please sign in to continue | `middleware/auth.js:14` |
| 401 | Session expired due to inactivity. Please sign in again. | `middleware/auth.js:37` |
| 401 | Your session has ended. Please sign in again. | `middleware/auth.js:31` |
| 401 | Your session has expired | `middleware/auth.js:21, middleware/auth.js:23` |
| 403 | Only a Class In-Charge can create student accounts, and only for their own class | `controllers/accountController.js:68` |
| 403 | Only a Class In-Charge can manage student details, and only for their own class | `controllers/accountController.js:135` |
| 403 | Only an administrator can move a student to another department | `controllers/accountController.js:159` |
| 403 | Self sign-up is disabled. Your account is created by the college administrator. | `controllers/authController.js:159` |
| 403 | This account has been suspended. Contact the administrator. | `controllers/authController.js:331` |
| 403 | You can only create student accounts for your own Class In-Charge class | `controllers/accountController.js:79` |
| 403 | You can only manage students of your own class | `controllers/accountController.js:137` |
| 403 | You do not have permission to perform this action | `middleware/auth.js:77` |
| 403 | You do not have permission to reset passwords | `controllers/accountController.js:228` |
| 404 | Session not found | `controllers/authController.js:523` |
| 409 | An account with this email already exists | `controllers/accountController.js:83, controllers/accountController.js:174, controllers/authController.js:165` |
| 409 | That register number is already in use by another student | `controllers/accountController.js:87, controllers/accountController.js:187` |
| 422 | [value] cannot be used with gender [value] | `controllers/accountController.js:179` |
| 422 | [value][key]} cannot be empty | `controllers/accountController.js:167` |
| 422 | New password must be different from the current one | `controllers/authController.js:476` |
| 422 | Semester [value] belongs to year [value], not year [value] | `controllers/accountController.js:198` |
| 422 | Student mobile number and parent mobile number cannot be the same | `controllers/accountController.js:93, controllers/accountController.js:193` |
| 422 | Year and semester are required | `controllers/accountController.js:196` |
| 423 | Too many failed attempts. Account locked for [value] minute(s). | `controllers/authController.js:223, controllers/authController.js:310` |
| 423 | Too many failed attempts. Try again in [value] minute(s). | `controllers/authController.js:209, controllers/authController.js:253` |
| 423 | Too many failed sign-in attempts from this network. Try again in [value] minute(s). | `controllers/authController.js:181` |
| 429 | A sign-in for this account is already in progress. Please try again in a moment. | `controllers/authController.js:197` |

## Security checks

| Code | Message | Source |
|---|---|---|
| 403 | Cross-origin request blocked by security policy | `middleware/security.js:104` |
| 403 | Invalid or expired CSRF token | `middleware/security.js:120` |
| 422 | [value] must be a valid http(s) URL | `utils/http.js:49` |
| 422 | [value] must start with http:// or https:// | `utils/http.js:52` |

## Users, people and admin

| Code | Message | Source |
|---|---|---|
| 400 | Both faculty IDs are required | `controllers/adminRoleAssignmentController.js:304` |
| 400 | Both users must have the faculty role | `controllers/adminRoleAssignmentController.js:316` |
| 400 | Cannot swap a faculty member with themselves | `controllers/adminRoleAssignmentController.js:306` |
| 400 | Faculty ID is required | `controllers/adminRoleAssignmentController.js:218, controllers/adminRoleAssignmentController.js:439, controllers/adminRoleAssignmentController.js:493` |
| 400 | HOD ID is required | `controllers/adminRoleAssignmentController.js:580` |
| 400 | Neither faculty member currently has a Class In-Charge assignment to swap | `controllers/adminRoleAssignmentController.js:340` |
| 400 | Only faculty members can be appointed HOD | `controllers/adminRoleAssignmentController.js:499` |
| 400 | Only faculty members can be assigned as Class In-Charge | `controllers/adminRoleAssignmentController.js:229` |
| 400 | User is not a faculty member | `controllers/adminRoleAssignmentController.js:443` |
| 400 | User is not currently an HOD | `controllers/adminRoleAssignmentController.js:584` |
| 400 | Valid department is required | `controllers/adminRoleAssignmentController.js:219, controllers/adminRoleAssignmentController.js:492` |
| 400 | Valid section is required | `controllers/adminRoleAssignmentController.js:221` |
| 400 | Valid semester (1–8) is required | `controllers/adminRoleAssignmentController.js:222` |
| 400 | Valid year (1–4) is required | `controllers/adminRoleAssignmentController.js:220` |
| 400 | You cannot change your own role or status | `controllers/adminController.js:284` |
| 400 | You cannot delete your own account | `controllers/adminController.js:429` |
| 403 | Department, year, roll number, parent’s mobile number and stay type are set by the administrator | `controllers/userController.js:158` |
| 403 | Not authorized to view this profile | `controllers/userController.js:107` |
| 403 | Your role is not authorized to browse the People directory | `controllers/userController.js:96, utils/peopleScope.js:83` |
| 404 | Faculty not found | `controllers/adminRoleAssignmentController.js:228, controllers/adminRoleAssignmentController.js:442` |
| 404 | One or both faculty members not found | `controllers/adminRoleAssignmentController.js:314` |
| 404 | Selected faculty not found | `controllers/adminRoleAssignmentController.js:496` |
| 404 | User not found | `controllers/adminController.js:287, controllers/adminController.js:432, controllers/adminRoleAssignmentController.js:583 (+1)` |
| 409 | An account with this email already exists | `controllers/adminController.js:245, controllers/adminController.js:299` |
| 409 | That employee ID is already in use | `controllers/adminController.js:248` |
| 409 | That register number is already in use by another student | `controllers/adminController.js:253, controllers/adminController.js:312` |
| 422 | In-charge year and semester apply to faculty accounts only | `controllers/adminController.js:362` |
| 422 | Semester [value] belongs to year [value], not year [value] | `controllers/adminController.js:376, controllers/adminRoleAssignmentController.js:224` |
| 422 | Student mobile number and parent mobile number cannot be the same | `controllers/adminController.js:259, controllers/adminController.js:323` |
| 422 | Years/sections handled apply to faculty accounts only | `controllers/adminController.js:350` |

## Gate pass, OTP and return to campus

| Code | Message | Source |
|---|---|---|
| 400 | Unsupported SMS type. | `services/otp/providers/collegeSmsProvider.js:83` |
| 403 | Day scholars request an Outing pass instead | `controllers/gatePassController.js:164` |
| 403 | Gate history is available to college-wide roles only | `controllers/gatePassController.js:1277` |
| 403 | Not authorized | `controllers/gatePassBindController.js:129, controllers/gatePassBindController.js:131, controllers/gatePassController.js:338 (+2)` |
| 403 | Only the [value] can reject students now | `controllers/gatePassBindController.js:436` |
| 403 | Only the faculty who created the group can change it | `controllers/gatePassBindController.js:231` |
| 403 | Only the faculty who created the group can send it | `controllers/gatePassBindController.js:250` |
| 403 | Only the pass holder can view its code | `controllers/gatePassController.js:468` |
| 403 | Only the principal can authorize institutional mass outpasses | `controllers/gatePassController.js:1370` |
| 403 | Only the principal can decide this group | `controllers/gatePassBindController.js:371` |
| 403 | Only the student's class faculty can verify this request | `controllers/gatePassController.js:715` |
| 403 | Outing passes are for day scholars only | `controllers/gatePassController.js:228` |
| 403 | You are not the assigned [value] reviewer for this pass | `controllers/gatePassController.js:512` |
| 403 | You are not the HOD for this class | `controllers/gatePassBindController.js:336` |
| 403 | You can only bind requests from your own class | `controllers/gatePassBindController.js:179` |
| 404 | Bind group not found | `controllers/gatePassBindController.js:74, controllers/gatePassBindController.js:142, controllers/gatePassBindController.js:161 (+5)` |
| 404 | Gate pass not found | `controllers/gatePassBindController.js:178, controllers/gatePassController.js:132, controllers/gatePassController.js:454 (+7)` |
| 404 | Invalid or already-used return code | `controllers/gatePassController.js:1103` |
| 404 | Invalid or already-used verification code | `controllers/gatePassController.js:897` |
| 404 | No return code yet — verify your location first | `controllers/gatePassController.js:1054` |
| 404 | That student is not waiting in this group | `controllers/gatePassBindController.js:445` |
| 404 | This request is not in a bind group | `controllers/gatePassBindController.js:229` |
| 409 | Exit has already been recorded | `controllers/gatePassController.js:943` |
| 409 | This gate pass is no longer waiting for your return | `services/gatePassReturn.js:86` |
| 409 | This request changed just now — refresh and try again | `controllers/gatePassBindController.js:214, controllers/gatePassBindController.js:235` |
| 409 | This request changed while verifying — refresh and try again | `controllers/gatePassController.js:812` |
| 409 | This request is already in a bind group | `controllers/gatePassBindController.js:182` |
| 409 | This student’s return has already been recorded | `controllers/gatePassController.js:983` |
| 409 | You already have a pending or active gate pass | `controllers/gatePassController.js:182, controllers/gatePassController.js:240, controllers/gatePassController.js:670` |
| 409 | Your gate pass request is already being processed | `controllers/gatePassController.js:263` |
| 409 | Your QR code and code will be generated at [value] | `controllers/gatePassController.js:474` |
| 410 | This pass has expired | `controllers/gatePassController.js:481` |
| 410 | This return code has expired — ask the student to verify their location again | `controllers/gatePassController.js:1109` |
| 410 | Your return code has expired. Verify your location again. | `controllers/gatePassController.js:1055` |
| 422 | A [value] pass cannot be cancelled | `controllers/gatePassController.js:847` |
| 422 | A bind group can hold at most [value] students | `controllers/gatePassBindController.js:187` |
| 422 | A gate pass can cover at most 30 days | `controllers/gatePassController.js:166, controllers/gatePassController.js:657, controllers/gatePassController.js:1384` |
| 422 | Bind at least one parent-verified student before sending the group | `controllers/gatePassBindController.js:252` |
| 422 | Description must be at least 3 characters | `controllers/gatePassController.js:1387` |
| 422 | Emergency requests cannot be bound | `controllers/gatePassBindController.js:180` |
| 422 | Enter a valid 10-digit mobile number | `controllers/gatePassController.js:744` |
| 422 | Enter a valid 4-character gate pass code (letters and numbers) | `controllers/gatePassController.js:890` |
| 422 | Enter a valid 4-character return code (letters and numbers) | `services/gatePassReturn.js:104` |
| 422 | Enter the 4-character gate pass code | `controllers/gatePassController.js:925` |
| 422 | Expected return must be after the leaving time | `controllers/gatePassController.js:656` |
| 422 | Invalid departure or return date | `controllers/gatePassController.js:1378` |
| 422 | Invalid or expired return code — ask the student to verify their location again | `controllers/gatePassController.js:987` |
| 422 | Leaving time cannot be in the past | `controllers/gatePassController.js:655` |
| 422 | No [value] account is available right now — choose another authority | `controllers/gatePassController.js:663` |
| 422 | No active hostellers found in the institution | `controllers/gatePassController.js:1406` |
| 422 | No students are left in this group — reject it instead | `controllers/gatePassBindController.js:342, controllers/gatePassBindController.js:383` |
| 422 | Only an open group can be deleted, by the faculty who created it | `controllers/gatePassBindController.js:162` |
| 422 | Return date cannot be before the departure date | `controllers/gatePassController.js:165, controllers/gatePassController.js:1381` |
| 422 | Say why the OTP is going to a different number (e.g. parent not reachable) | `controllers/gatePassController.js:747` |
| 422 | Students can be rejected only while the group waits on the HOD or principal | `controllers/gatePassBindController.js:435` |
| 422 | That date is in the future | `controllers/gatePassController.js:1232` |
| 422 | The group has already been sent — the HOD or principal can reject single students instead | `controllers/gatePassBindController.js:232` |
| 422 | The parent mobile number is not a valid 10-digit number. | `services/otp/providers/collegeSmsProvider.js:37` |
| 422 | The student has not exited on this pass | `controllers/gatePassController.js:984` |
| 422 | This code does not belong to this gate pass | `controllers/gatePassController.js:929` |
| 422 | This group has already been sent | `controllers/gatePassBindController.js:249` |
| 422 | This group has already been sent — create a new group | `controllers/gatePassBindController.js:186, controllers/gatePassBindController.js:218` |
| 422 | This group is for [value] · Year [value] · Section [value] — bind students of that class only | `controllers/gatePassBindController.js:193` |
| 422 | This group is not waiting on HOD review | `controllers/gatePassBindController.js:335` |
| 422 | This group is not waiting on principal approval | `controllers/gatePassBindController.js:370` |
| 422 | This group is now set to another class | `controllers/gatePassBindController.js:204` |
| 422 | This group was just decided by someone else | `controllers/gatePassBindController.js:312, controllers/gatePassBindController.js:346, controllers/gatePassBindController.js:387` |
| 422 | This group was just sent | `controllers/gatePassBindController.js:260` |
| 422 | This group was just sent on | `controllers/gatePassBindController.js:164` |
| 422 | This pass has no active verification code | `controllers/gatePassController.js:477` |
| 422 | This pass is no longer waiting on [value] review | `controllers/gatePassController.js:511` |
| 422 | This pass is not waiting for a return | `controllers/gatePassController.js:1105` |
| 422 | This pass was just reviewed by someone else | `controllers/gatePassController.js:540` |
| 422 | This QR code is not a return pass | `services/gatePassReturn.js:100` |
| 422 | This request is not waiting for parent verification | `controllers/gatePassController.js:753, controllers/gatePassController.js:785` |
| 422 | Verify the parent's OTP before binding this request | `controllers/gatePassBindController.js:181` |
| 422 | You can have at most [value] open bind groups — send or delete one first | `controllers/gatePassBindController.js:150` |
| 422 | Your account has no department/section on file — ask an admin to set it | `controllers/gatePassController.js:168, controllers/gatePassController.js:230, controllers/gatePassController.js:659` |
| 422 | Your parent’s mobile number is not on file — ask the administrator to add it before requesting a gate pass | `controllers/gatePassController.js:171` |
| 422 | Your parent’s mobile number is not on file — ask the administrator to add it before requesting an outing | `controllers/gatePassController.js:233` |
| 429 | Please wait [value] second[value] before requesting another OTP | `services/otp/otpService.js:153` |
| 500 | OTP service is misconfigured | `services/otp/otpService.js:21` |
| 502 | Could not reach the SMS service. Please try again. | `services/otp/providers/collegeSmsProvider.js:66` |
| 502 | Could not send the OTP. Please try again. | `services/otp/otpService.js:186` |
| 502 | The SMS service rejected the message. Please try again. | `services/otp/providers/collegeSmsProvider.js:68` |
| 503 | Could not create a return code. Please try again. | `services/gatePassReturn.js:92` |
| 503 | Could not issue a gate code. Please try again. | `controllers/gatePassController.js:504` |
| 503 | The college SMS service is not configured correctly. Ask an administrator. | `services/otp/providers/collegeSmsProvider.js:44` |
| 503 | The college SMS service is not configured securely. Ask an administrator. | `services/otp/providers/collegeSmsProvider.js:52` |
| 503 | The college SMS service is not configured yet. Ask an administrator. | `services/otp/providers/collegeSmsProvider.js:34` |

## Attendance, OD and leave

| Code | Message | Source |
|---|---|---|
| 403 | 1st year attendance reports are managed by Science & Humanities HOD | `services/attendanceReport.js:134` |
| 403 | 1st year subjects are managed by Science & Humanities HOD | `services/attendanceReport.js:141` |
| 403 | A substitute has been assigned to take this period today | `controllers/attendanceController.js:229` |
| 403 | Attendance can only be taken on the day of the class | `controllers/attendanceController.js:231` |
| 403 | Attendance opens at [value] | `controllers/attendanceController.js:235` |
| 403 | First Year HOD can only generate reports for 1st year subjects | `services/attendanceReport.js:120` |
| 403 | First Year HOD can only review corrections for 1st year subjects | `controllers/attendanceController.js:1705` |
| 403 | HOD can only edit attendance for today’s date | `controllers/attendanceController.js:219` |
| 403 | Not authorized for this subject | `controllers/attendanceController.js:1340` |
| 403 | Not authorized to review OD / Leave requests. | `controllers/odLeaveController.js:256` |
| 403 | Not authorized to review this request. | `controllers/odLeaveController.js:558` |
| 403 | Take attendance from your timetable period | `controllers/attendanceController.js:224` |
| 403 | This period has ended — attendance is closed | `controllers/attendanceController.js:236` |
| 403 | This period is assigned to another faculty member | `controllers/attendanceController.js:228` |
| 403 | This request is outside your review scope. | `controllers/odLeaveController.js:435` |
| 403 | This staff member is outside your scope | `controllers/attendanceMonitorController.js:74` |
| 403 | This student is not in one of your classes | `controllers/attendanceController.js:914, controllers/attendanceController.js:1766` |
| 403 | This student is outside your department | `controllers/attendanceController.js:902` |
| 403 | This subject is outside your department | `controllers/attendanceController.js:1343, services/attendanceReport.js:139` |
| 403 | You are not assigned to this subject | `controllers/attendanceController.js:176, controllers/attendanceController.js:1699` |
| 403 | You can only cancel your own request. | `controllers/odLeaveController.js:592` |
| 403 | You can only edit attendance for your own department | `controllers/attendanceController.js:218` |
| 403 | You can only mark attendance for your own department | `controllers/attendanceController.js:180` |
| 403 | You can only notify students in your own department | `controllers/attendanceController.js:1759` |
| 403 | You can only review corrections for your own department (years 2–4) | `controllers/attendanceController.js:1708` |
| 403 | You can only view your own department | `controllers/staffAttendanceController.js:31` |
| 403 | You cannot generate attendance reports | `services/attendanceReport.js:171` |
| 403 | You cannot mark attendance | `controllers/attendanceController.js:239` |
| 403 | You cannot view attendance corrections | `controllers/attendanceController.js:1670` |
| 403 | Your access to attendance is read-only | `controllers/attendanceController.js:174, controllers/attendanceController.js:211` |
| 403 | Your account has no department assigned | `controllers/attendanceMonitorController.js:44` |
| 403 | Your own attendance is marked by an administrator | `controllers/staffAttendanceController.js:328` |
| 404 | Correction request not found | `controllers/attendanceController.js:1694` |
| 404 | No attendance record found for this date and period | `controllers/attendanceController.js:1618` |
| 404 | No class is currently assigned to you as Class In-Charge. | `services/attendanceReport.js:78` |
| 404 | No such period in your timetable for that date | `services/attendanceReport.js:289` |
| 404 | Request not found | `controllers/odLeaveController.js:431, controllers/odLeaveController.js:589` |
| 404 | Student not found | `controllers/attendanceController.js:898, controllers/attendanceController.js:1756` |
| 404 | Subject not found | `controllers/attendanceController.js:260, controllers/attendanceController.js:264, controllers/attendanceController.js:1156 (+6)` |
| 404 | Timetable period not found | `controllers/attendanceController.js:251` |
| 409 | A correction request for this period is already pending | `controllers/attendanceController.js:1628` |
| 409 | No completed periods are available for today. | `services/attendanceReport.js:571` |
| 409 | This period ends at [value]. The period report can be generated once the period has finished (server time [value]). | `services/attendanceReport.js:214` |
| 409 | This period is recorded as Class Not Conducted — the HOD must cancel that before attendance can be taken | `controllers/attendanceController.js:214` |
| 409 | This request was just reviewed by someone else | `controllers/attendanceController.js:1720` |
| 422 | "From" must be before "to" | `services/attendanceReport.js:484` |
| 422 | [value] is not taught to section [value] | `controllers/attendanceController.js:168` |
| 422 | A rejection reason is required (at least 3 characters). | `controllers/odLeaveController.js:443` |
| 422 | A staff member appears more than once | `controllers/staffAttendanceController.js:319` |
| 422 | A student appears more than once | `controllers/attendanceController.js:519` |
| 422 | Approved Leave requests cannot be cancelled. | `controllers/odLeaveController.js:601` |
| 422 | Attendance cannot be marked for a future date | `controllers/attendanceController.js:210, controllers/staffAttendanceController.js:315` |
| 422 | Category is required. | `controllers/odLeaveController.js:121` |
| 422 | Choose a period | `services/attendanceReport.js:247` |
| 422 | Choose a range of at most [value] days | `controllers/attendanceMonitorController.js:54` |
| 422 | Choose a section | `services/attendanceReport.js:244` |
| 422 | Choose a start date and an end date | `services/attendanceReport.js:481` |
| 422 | Choose one of your sections | `services/attendanceReport.js:94` |
| 422 | Choose one of your subjects | `services/attendanceReport.js:93` |
| 422 | Description must be at least 5 characters long. | `controllers/odLeaveController.js:125` |
| 422 | Invalid [value] | `controllers/attendanceController.js:58` |
| 422 | Invalid action for faculty. Must be "forward" or "reject". | `controllers/odLeaveController.js:486` |
| 422 | Invalid action for HOD. Must be "forward" or "reject". | `controllers/odLeaveController.js:523` |
| 422 | Invalid action for Principal. Must be "approve" or "reject". | `controllers/odLeaveController.js:555` |
| 422 | Invalid attendance status | `controllers/attendanceController.js:582` |
| 422 | Invalid period | `controllers/attendanceController.js:268` |
| 422 | Invalid request type. Must be "od" or "leave". | `controllers/odLeaveController.js:109` |
| 422 | Invalid semester | `controllers/attendanceController.js:843` |
| 422 | Invalid staff member | `controllers/attendanceMonitorController.js:70` |
| 422 | Invalid subject | `controllers/attendanceMonitorController.js:208` |
| 422 | On Duty can only come from an approved OD request or a registered event | `controllers/attendanceController.js:590` |
| 422 | Requests cannot exceed 15 consecutive days. | `controllers/odLeaveController.js:144` |
| 422 | Select a section | `controllers/attendanceController.js:167` |
| 422 | Some students are not in [value]${section ? | `controllers/attendanceController.js:523` |
| 422 | Supporting document is compulsory to apply for On Duty (OD). | `controllers/odLeaveController.js:117` |
| 422 | That date is in the future | `services/attendanceReport.js:211, services/attendanceReport.js:373` |
| 422 | The end date cannot be in the future | `services/attendanceReport.js:485` |
| 422 | This period is already marked "[value]" | `controllers/attendanceController.js:1619` |
| 422 | This period is not held on [value] | `controllers/attendanceController.js:257` |
| 422 | This request has already been reviewed | `controllers/attendanceController.js:1695` |
| 422 | This request is already [value]. | `controllers/odLeaveController.js:439, controllers/odLeaveController.js:596` |
| 422 | This request is no longer waiting for Class In-Charge review. | `controllers/odLeaveController.js:451` |
| 422 | This request is no longer waiting for HOD review. | `controllers/odLeaveController.js:490` |
| 422 | This request is no longer waiting for Principal approval. | `controllers/odLeaveController.js:527` |
| 422 | To Date cannot be before From Date. | `controllers/odLeaveController.js:132` |
| 422 | Unknown report type | `services/attendanceReport.js:477, services/attendanceReport.js:586` |
| 422 | You already have an active or pending request for overlapping dates. | `controllers/odLeaveController.js:156` |
| 422 | Your account has no department — ask an admin to set it | `controllers/staffAttendanceController.js:33` |
| 422 | Your account has no department/year/section on file — ask your Class In-Charge or an admin to set it | `controllers/odLeaveController.js:113` |

## Staff early exit and period cover

| Code | Message | Source |
|---|---|---|
| 403 | Only teaching staff request an early exit | `controllers/staffController.js:97` |
| 403 | Only the requester can withdraw this request | `controllers/staffController.js:195` |
| 403 | You can only record early exits for your own department’s staff | `controllers/staffController.js:96` |
| 403 | You can only view your own department’s staff | `controllers/staffController.js:275` |
| 403 | You cannot arrange cover for this period | `controllers/staffController.js:337, controllers/staffController.js:349` |
| 403 | You cannot change this arrangement | `controllers/staffController.js:420` |
| 403 | You cannot decide this early exit | `controllers/staffController.js:147` |
| 403 | You cannot update this early exit | `controllers/staffController.js:181` |
| 404 | Arrangement not found | `controllers/staffController.js:418` |
| 404 | Early exit not found | `controllers/staffController.js:139` |
| 404 | Staff member not found | `controllers/staffController.js:95` |
| 404 | Timetable period not found | `controllers/staffController.js:249` |
| 409 | [value] is not free at [value]–[value] on [value] | `controllers/staffController.js:365` |
| 409 | An early exit for today is already pending or approved | `controllers/staffController.js:132` |
| 409 | Attendance was already taken for this period | `controllers/staffController.js:357` |
| 409 | Only a pending request can be withdrawn | `controllers/staffController.js:201` |
| 409 | The departure is already recorded | `controllers/staffController.js:183` |
| 409 | This period already has an arrangement — cancel it first | `controllers/staffController.js:393` |
| 409 | This request has already been decided | `controllers/staffController.js:159` |
| 422 | A substitute can only be assigned for today or a later date | `controllers/staffController.js:352` |
| 422 | Choose a valid date | `controllers/staffController.js:255` |
| 422 | Choose an active faculty member as the substitute | `controllers/staffController.js:363` |
| 422 | Departure time must be HH:mm | `controllers/staffController.js:92` |
| 422 | Only an approved early exit can record a departure | `controllers/staffController.js:182` |
| 422 | Only the last 7 days can be updated | `controllers/staffController.js:353` |
| 422 | This period is held on [value]s, not on [value] | `controllers/staffController.js:257` |

## Timetable, subjects and academic scope

| Code | Message | Source |
|---|---|---|
| 403 | Faculty availability schedule is only accessible to HODs | `controllers/timetableController.js:635, controllers/timetableController.js:649` |
| 403 | First Year HOD can only manage 1st year subjects and timetables | `controllers/timetableController.js:27` |
| 403 | First year subjects and timetables are managed by the Science & Humanities HOD | `controllers/timetableController.js:35` |
| 403 | Master timetable is only accessible to HODs | `controllers/timetableController.js:381, controllers/timetableController.js:395` |
| 403 | You are not assigned to this class | `utils/academicScope.js:245` |
| 403 | You can only manage your own department’s timetable | `controllers/timetableController.js:32` |
| 403 | You can only view your own teaching schedule | `controllers/timetableController.js:707` |
| 403 | Your account has no department assigned | `utils/academicScope.js:279` |
| 404 | Subject not found | `controllers/timetableController.js:219, controllers/timetableController.js:240, controllers/timetableController.js:789` |
| 404 | Timetable slot not found | `controllers/timetableController.js:854, controllers/timetableController.js:907` |
| 409 | [value] already exists for this department and semester | `controllers/timetableController.js:211` |
| 409 | Period [value] already exists on [value] — [value] | `services/timetablePeriods.js:71` |
| 409 | Room [value] is already booked for [value] (section [value]) on [value] | `controllers/timetableController.js:771` |
| 409 | Section [value] already has [value] on [value] | `controllers/timetableController.js:769` |
| 409 | This faculty is already assigned during this time — [value], [value] section [value], [value] | `controllers/timetableController.js:770` |
| 422 | [value] belongs to [value], not [value] | `controllers/timetableController.js:791` |
| 422 | [value] is a semester [value] subject, not semester [value] | `controllers/timetableController.js:794` |
| 422 | [value] is not taught to section [value] | `controllers/timetableController.js:797` |
| 422 | Choose an active faculty member | `controllers/timetableController.js:799` |
| 422 | Every assigned faculty member must be an active faculty account | `controllers/timetableController.js:191` |
| 422 | No period number is free at this time — enter the period number | `services/timetablePeriods.js:55` |
| 422 | Period numbers must follow the time order on [value]: [value] cannot come [value] P[value] at [value] | `services/timetablePeriods.js:74` |
| 422 | This day has no room for another break | `services/timetablePeriods.js:41` |

## Exams

| Code | Message | Source |
|---|---|---|
| 403 | Only the HOD and the Controller of Examinations manage exams | `controllers/examController.js:93` |
| 403 | You can only manage exams for your own department | `controllers/examController.js:101` |
| 403 | You can only manage exams within your own scope | `controllers/examController.js:59` |
| 403 | You cannot view the exam timetable | `controllers/examController.js:275` |
| 404 | Exam not found | `controllers/examController.js:381` |
| 409 | [value] overlaps the [value] exam [value] for the same students | `controllers/examController.js:177` |
| 409 | These exams overlap for the same students: [value] and [value] | `controllers/examController.js:168` |
| 409 | This exam was just changed by someone else — reload and try again | `controllers/examController.js:450, controllers/examController.js:476` |
| 422 | "From" must be before "to" | `controllers/examController.js:294` |
| 422 | [value]: [value] is not a real date | `controllers/examController.js:138` |
| 422 | [value]: choose a valid exam date | `controllers/examController.js:136` |
| 422 | [value]: end time must be after start time | `controllers/examController.js:140` |
| 422 | [value]: start and end time are required | `controllers/examController.js:139` |
| 422 | [value]: subject code must be 2–20 characters | `controllers/examController.js:134` |
| 422 | [value]: subject name must be 2–120 characters | `controllers/examController.js:135` |
| 422 | [value]: the exam date cannot be in the past | `controllers/examController.js:146` |
| 422 | A cancelled exam cannot be edited | `controllers/examController.js:396` |
| 422 | A past exam cannot be cancelled | `controllers/examController.js:466` |
| 422 | Only a draft can be published (this exam is [value]) | `controllers/examController.js:439` |
| 422 | Section [value] is not configured for [value])} | `controllers/examController.js:122` |
| 422 | This exam has already started — it can no longer be edited | `controllers/examController.js:397` |
| 422 | This exam is already cancelled | `controllers/examController.js:465` |
| 422 | Unknown department "[value]" | `controllers/examController.js:104` |
| 422 | Year must be 1st–4th or All Years | `controllers/examController.js:111` |

## Holidays and dates

| Code | Message | Source |
|---|---|---|
| 403 | Only the Principal can manage holidays | `controllers/holidayController.js:17` |
| 404 | Holiday not found | `controllers/holidayController.js:99, controllers/holidayController.js:122` |
| 409 | This overlaps the existing holiday “[value]” ([value], [value]). Edit or delete that holiday first. | `services/holidays.js:205` |
| 422 | "From" must be before "to" | `controllers/holidayController.js:62, utils/dates.js:79` |
| 422 | A holiday can cover at most [value] days | `controllers/holidayController.js:35` |
| 422 | Choose a department before choosing a year | `controllers/holidayController.js:44` |
| 422 | Choose a valid department | `controllers/holidayController.js:39` |
| 422 | Choose a year before choosing a section | `controllers/holidayController.js:45` |
| 422 | Choose Single Day or Custom | `controllers/holidayController.js:30` |
| 422 | Invalid date | `utils/dates.js:39, utils/dates.js:43, utils/dates.js:45` |
| 422 | Reason must be 3–200 characters | `controllers/holidayController.js:27` |
| 422 | Section must be one of [value] or ALL | `controllers/holidayController.js:43` |
| 422 | The "To" date cannot be before the "From" date | `controllers/holidayController.js:34` |
| 422 | Unknown range | `utils/dates.js:83` |
| 422 | Year must be 1–4 or ALL | `controllers/holidayController.js:41` |

## Study materials and AI assistant

| Code | Message | Source |
|---|---|---|
| 400 | Invalid conversation id | `services/ai/studyAssistantService.js:57` |
| 403 | 1st year belongs to the [value] HOD | `controllers/studyMaterialController.js:164` |
| 403 | [value] belongs to another department — you can only manage your own | `controllers/studyMaterialController.js:44` |
| 403 | Not authorized to manage study materials | `controllers/studyMaterialController.js:52` |
| 403 | You are not assigned to this subject/class | `utils/studyMaterialScope.js:64` |
| 403 | You are not authorized to manage this material | `controllers/studyMaterialController.js:110, controllers/studyMaterialController.js:132` |
| 403 | You can only view 1st-year classes | `controllers/studyMaterialController.js:160` |
| 403 | You can only view your own department | `controllers/studyMaterialController.js:163` |
| 404 | Conversation not found | `services/ai/studyAssistantService.js:60, services/ai/studyAssistantService.js:190, services/ai/studyAssistantService.js:196` |
| 404 | Material not found | `controllers/studyMaterialController.js:83, controllers/studyMaterialController.js:109, controllers/studyMaterialController.js:131` |
| 404 | Subject not found | `controllers/studyMaterialController.js:28` |
| 404 | This conversation was cleared. Please ask again. | `services/ai/studyAssistantService.js:148` |
| 422 | [value] is a semester [value] subject, not semester [value] | `controllers/studyMaterialController.js:33` |
| 422 | A file is required | `controllers/studyMaterialController.js:93` |
| 422 | Department is required | `controllers/studyMaterialController.js:49` |
| 422 | Please type a question | `services/ai/studyAssistantService.js:81` |
| 422 | Questions can be at most [value] characters | `services/ai/studyAssistantService.js:82` |
| 422 | Select a department | `controllers/studyMaterialController.js:168` |
| 422 | Semester [value] belongs to year [value], not year [value] | `controllers/studyMaterialController.js:38, controllers/studyMaterialController.js:154` |
| 422 | Your account has no department — ask an admin to set it | `controllers/studyMaterialController.js:162` |
| 500 | Something went wrong. Please try again. | `services/ai/studyAssistantService.js:123` |

## Chat

| Code | Message | Source |
|---|---|---|
| 403 | [value] is not a student of [value] | `controllers/chatController.js:140` |
| 403 | [value] is not faculty and cannot be added | `controllers/chatController.js:133` |
| 403 | Faculty groups can only include students of your own class ([value] is not in a class you teach) | `controllers/chatController.js:110` |
| 403 | Groups can only include staff of your own department ([value] is not in [value]) | `controllers/chatController.js:114` |
| 403 | Groups can only include your own department ([value] is not in [value]) | `controllers/chatController.js:120` |
| 403 | Message deletion is not allowed | `controllers/chatController.js:468` |
| 403 | Messages can only be edited within 5 minutes of sending | `controllers/chatController.js:490` |
| 403 | Messages cannot be edited in private chats | `controllers/chatController.js:476` |
| 403 | Not a member of this conversation | `controllers/chatController.js:69` |
| 403 | Only admins, HODs and faculty can create group chats | `controllers/chatController.js:196` |
| 403 | Only an HOD can create a Custom, Academics or Faculty group | `controllers/chatController.js:234` |
| 403 | Only group admins can add members to this group | `controllers/chatController.js:565` |
| 403 | Only group admins can manage group admin roles | `controllers/chatController.js:629` |
| 403 | Only group admins can remove members | `controllers/chatController.js:594` |
| 403 | Only the group admin can edit or delete this group | `controllers/chatController.js:621` |
| 403 | The group creator cannot be removed | `controllers/chatController.js:598` |
| 403 | This conversation is outside your chat scope | `controllers/chatController.js:75` |
| 403 | You can only edit your own messages | `controllers/chatController.js:484` |
| 404 | Conversation not found | `controllers/chatController.js:68, controllers/chatController.js:547` |
| 404 | Message not found | `controllers/chatController.js:480, controllers/chatController.js:521` |
| 404 | No valid users to add | `controllers/chatController.js:570` |
| 404 | One or more users could not be found | `controllers/chatController.js:203` |
| 404 | This request was not found or has already been reviewed | `controllers/chatController.js:313, controllers/chatController.js:340` |
| 404 | User is not a member of this conversation | `controllers/chatController.js:635` |
| 422 | [value] group includes students only ([value] is staff) | `controllers/chatController.js:138` |
| 422 | A Faculty group can only include faculty | `controllers/chatController.js:131` |
| 422 | A group must have at least one group admin | `controllers/chatController.js:643` |
| 422 | Add at least one other member | `controllers/chatController.js:198` |
| 422 | An academic group is one class — [value] is not in year [value] section [value] | `controllers/chatController.js:148` |
| 422 | Cannot add members to a private conversation | `controllers/chatController.js:563` |
| 422 | Cannot edit a deleted message | `controllers/chatController.js:481` |
| 422 | Cannot remove members from a private conversation | `controllers/chatController.js:589` |
| 422 | Choose a department | `controllers/chatController.js:688` |
| 422 | Choose one person to start a private chat | `controllers/chatController.js:193` |
| 422 | Choose the group type: Custom, Academics or Faculty | `controllers/chatController.js:237` |
| 422 | Choose the year and section for an academic group | `controllers/chatController.js:145` |
| 422 | Group conversations need a name | `controllers/chatController.js:231` |
| 422 | Group name is too short | `controllers/chatController.js:660` |
| 422 | Message cannot be empty | `controllers/chatController.js:494` |
| 422 | Private conversations cannot be edited | `controllers/chatController.js:619` |
| 422 | Private conversations cannot have group admins | `controllers/chatController.js:627` |
| 422 | Some requested members are no longer active — ask the requester to send a new request | `controllers/chatController.js:318` |
| 422 | Target user is required | `controllers/chatController.js:633` |
| 422 | The requester’s account is no longer active | `controllers/chatController.js:315` |
| 422 | You can only reply to a message in this conversation | `controllers/chatController.js:372` |
| 422 | Your account has no department — ask an admin to set it | `controllers/chatController.js:105` |

## Complaints

| Code | Message | Source |
|---|---|---|
| 403 | Not authorized | `controllers/complaintController.js:192, controllers/complaintController.js:220` |
| 403 | Only student accounts can register a grievance | `controllers/complaintController.js:111` |
| 403 | Only the student who raised this grievance can do this | `controllers/complaintController.js:279` |
| 403 | You are not the current authority for this grievance | `controllers/complaintController.js:243` |
| 404 | Grievance not found | `controllers/complaintController.js:219, controllers/complaintController.js:241, controllers/complaintController.js:278 (+2)` |
| 422 | A [value] grievance cannot be cancelled | `controllers/complaintController.js:379` |
| 422 | A [value] grievance cannot be escalated | `controllers/complaintController.js:281` |
| 422 | Invalid "escalate to" authority for this category | `controllers/complaintController.js:119` |
| 422 | Invalid escalation target | `controllers/complaintController.js:132` |
| 422 | Invalid grievance category | `controllers/complaintController.js:118` |
| 422 | Invalid status | `controllers/complaintController.js:238` |
| 422 | Invalid subcategory for this category | `controllers/complaintController.js:122` |
| 422 | The waiting period for escalation has not elapsed yet | `controllers/complaintController.js:284` |
| 422 | This grievance was just updated by someone else | `controllers/complaintController.js:251, controllers/complaintController.js:297, controllers/complaintController.js:329` |
| 422 | Unknown authority role: [value] | `controllers/complaintController.js:42` |
| 422 | Your account has no department on file — ask an admin to set it | `controllers/complaintController.js:127` |

## SOS

| Code | Message | Source |
|---|---|---|
| 400 | Resolution note is required | `controllers/sosController.js:131` |
| 404 | Alert not found | `controllers/sosController.js:100, controllers/sosController.js:127` |
| 409 | This alert is already closed | `controllers/sosController.js:101, controllers/sosController.js:128` |
| 429 | You have raised several alerts in the last few minutes. Responders have been notified — please call campus security directly. | `controllers/sosController.js:42` |

## Bus tracking

| Code | Message | Source |
|---|---|---|
| 401 | Invalid or expired signature | `controllers/transportController.js:256, controllers/transportController.js:260` |
| 403 | Only the person sharing this trip can send its location | `controllers/transportController.js:234` |
| 403 | You are not assigned to share this bus’s location | `services/transport/trips.js:49` |
| 403 | You cannot start bus trips | `services/transport/trips.js:45` |
| 403 | You cannot stop this trip | `services/transport/trips.js:71` |
| 403 | You do not have access to bus tracking | `controllers/transportController.js:70` |
| 404 | Assignment not found | `controllers/transportController.js:452` |
| 404 | Bus not found | `controllers/transportController.js:103, controllers/transportController.js:388, services/transport/trips.js:47` |
| 404 | Not found | `controllers/transportController.js:253` |
| 404 | Route not found | `controllers/transportController.js:151, controllers/transportController.js:153, controllers/transportController.js:328` |
| 404 | Trip not found | `controllers/transportController.js:208, controllers/transportController.js:233, services/transport/trips.js:70` |
| 404 | Unknown tracker device | `controllers/transportController.js:266` |
| 409 | [value] already has an active trip — it must be stopped before another one starts | `services/transport/trips.js:56` |
| 409 | A route with this name already exists | `controllers/transportController.js:321, controllers/transportController.js:335` |
| 409 | Active buses still use this route — reassign them first | `controllers/transportController.js:330` |
| 409 | This bus is no longer active | `controllers/transportController.js:238` |
| 409 | This trip is no longer active | `controllers/transportController.js:236` |
| 422 | A route needs 2–200 stops | `controllers/transportController.js:295` |
| 422 | Bus number: letters, digits, spaces and dashes (max 20) | `controllers/transportController.js:349` |
| 422 | Choose an active route | `controllers/transportController.js:361, controllers/transportController.js:438` |
| 422 | Choose an active student or staff member | `controllers/transportController.js:436` |
| 422 | deviceId and 1–50 fixes are required | `controllers/transportController.js:264` |
| 422 | GPS source must be tracker or phone | `controllers/transportController.js:354` |
| 422 | Invalid bus | `controllers/transportController.js:102` |
| 422 | Invalid route | `controllers/transportController.js:150` |
| 422 | Invalid staff member | `controllers/transportController.js:367` |
| 422 | Route geometry contains an invalid point | `controllers/transportController.js:306` |
| 422 | Route geometry must be 2–20000 [longitude, latitude] points | `controllers/transportController.js:303` |
| 422 | Stop [value]: a name of 2–80 characters is required | `controllers/transportController.js:278` |
| 422 | Stop [value]: invalid coordinates | `controllers/transportController.js:276` |
| 422 | Stop sequence numbers must be unique positive integers | `controllers/transportController.js:298` |
| 422 | That bus does not run this route | `controllers/transportController.js:440` |
| 422 | That stop is not on this route | `controllers/transportController.js:439` |
| 422 | This bus reports through its own GPS tracker | `services/transport/trips.js:51` |
| 422 | Trip sharers must be active faculty, HOD or transport staff | `controllers/transportController.js:369` |

## Announcements, clubs, events and discussions

| Code | Message | Source |
|---|---|---|
| 400 | A club needs at least one admin | `controllers/clubController.js:270` |
| 400 | Capacity cannot be lower than current registrations ([value]) | `controllers/eventController.js:219` |
| 400 | Choose a valid club | `controllers/announcementController.js:48` |
| 400 | Club not found | `controllers/eventController.js:176` |
| 400 | Faculty advisor must be a faculty member | `controllers/clubController.js:105` |
| 400 | Faculty coordinators must be active faculty members | `controllers/eventController.js:72` |
| 400 | Registration has closed | `controllers/eventController.js:275` |
| 400 | Request already sent | `controllers/clubController.js:179` |
| 400 | This club is not accepting members yet | `controllers/clubController.js:177` |
| 400 | This content type cannot be hidden — choose delete instead | `controllers/reportController.js:109` |
| 400 | This discussion is locked | `controllers/discussionController.js:137, controllers/discussionController.js:157` |
| 400 | This event has already ended | `controllers/eventController.js:274` |
| 400 | This report has already been handled | `controllers/reportController.js:94` |
| 400 | Too many faculty coordinators | `controllers/eventController.js:70` |
| 400 | Use suspend for user accounts | `controllers/reportController.js:117` |
| 400 | Use “Leave club” to remove yourself | `controllers/clubController.js:250` |
| 400 | User is not a confirmed participant | `controllers/eventController.js:401` |
| 400 | User is not a member | `controllers/clubController.js:264` |
| 400 | You are already a member | `controllers/clubController.js:178` |
| 400 | You are not registered for this event | `controllers/eventController.js:321` |
| 400 | You are the only club admin. Promote another member before leaving. | `controllers/clubController.js:205` |
| 400 | You cannot suspend yourself | `controllers/reportController.js:123` |
| 403 | 1st year announcements are posted by the [value] HOD | `controllers/announcementController.js:40` |
| 403 | Not allowed | `controllers/discussionController.js:149, controllers/discussionController.js:186` |
| 403 | Only administrators can delete clubs, events, announcements or accounts — warn the owner or leave the report for an administrator | `controllers/reportController.js:101` |
| 403 | Only administrators can suspend accounts | `controllers/reportController.js:95` |
| 403 | Only admins of this club can create its events | `controllers/eventController.js:177` |
| 403 | Only assigned faculty coordinators and the hosting HOD can mark attendance | `controllers/eventController.js:396` |
| 403 | Only club admins can change roles | `controllers/clubController.js:262` |
| 403 | Only club admins can edit this club | `controllers/clubController.js:133` |
| 403 | Only club admins can manage requests | `controllers/clubController.js:225` |
| 403 | Only club admins can post to this club | `controllers/announcementController.js:50` |
| 403 | Only club admins can remove members | `controllers/clubController.js:248` |
| 403 | Only club admins can view requests | `controllers/clubController.js:217` |
| 403 | Only the Principal and HODs can publish department, year or section announcements | `controllers/announcementController.js:61` |
| 403 | Only the Principal can publish the main campus announcement | `controllers/announcementController.js:56` |
| 403 | Only the Principal, Admin, and Department HODs can create events | `controllers/eventController.js:168` |
| 403 | The [value] HOD posts to 1st year students only | `controllers/announcementController.js:36` |
| 403 | You can only edit your own posts | `controllers/discussionController.js:136` |
| 403 | You can only pin your own announcements | `controllers/announcementController.js:170` |
| 403 | You can only post announcements to your own department | `controllers/announcementController.js:39` |
| 403 | You can only post to your own department | `controllers/announcementController.js:33` |
| 403 | You cannot delete this announcement | `controllers/announcementController.js:159` |
| 403 | You cannot delete this event | `controllers/eventController.js:252` |
| 403 | You cannot edit this announcement | `controllers/announcementController.js:141` |
| 403 | You cannot edit this event | `controllers/eventController.js:214` |
| 403 | You do not have permission to view or export participants | `controllers/eventController.js:373` |
| 403 | You do not have permission to view participants | `controllers/eventController.js:365` |
| 404 | Announcement not found | `controllers/announcementController.js:140, controllers/announcementController.js:158, controllers/announcementController.js:167` |
| 404 | Club not found | `controllers/clubController.js:17, controllers/clubController.js:69` |
| 404 | Content not found | `controllers/reportController.js:43` |
| 404 | Discussion not found | `controllers/discussionController.js:87, controllers/discussionController.js:214` |
| 404 | Event not found | `controllers/eventController.js:94, controllers/eventController.js:146, controllers/eventController.js:271 (+1)` |
| 404 | Reply not found | `controllers/discussionController.js:185, controllers/discussionController.js:203, controllers/reportController.js:44` |
| 404 | Report not found | `controllers/reportController.js:93` |
| 404 | Request not found | `controllers/clubController.js:228` |
| 409 | [value] already has attendance recorded for [value] class period(s) on [value]. Confirm to replace it with [value]. | `controllers/eventController.js:454` |
| 409 | You are already registered | `controllers/eventController.js:276, controllers/eventController.js:295` |
| 409 | You have already reported this | `controllers/reportController.js:47` |
| 422 | Choose a department for a section announcement | `controllers/announcementController.js:76` |
| 422 | Choose a valid department | `controllers/announcementController.js:65` |
| 422 | Choose a valid section | `controllers/announcementController.js:78` |
| 422 | Choose a valid year | `controllers/announcementController.js:72` |
| 422 | Department is required | `controllers/announcementController.js:68` |

## Achievements

| Code | Message | Source |
|---|---|---|
| 403 | An HOD can only post achievements for students of their own department | `controllers/achievementController.js:48` |
| 403 | You are not featured in this achievement | `controllers/achievementController.js:299` |
| 403 | You cannot delete this achievement | `controllers/achievementController.js:248` |
| 403 | You cannot edit this achievement | `controllers/achievementController.js:215` |
| 403 | You cannot feature this achievement | `controllers/achievementController.js:274` |
| 403 | You cannot resolve this request | `controllers/achievementController.js:318` |
| 404 | Achievement not found | `controllers/achievementController.js:164, controllers/achievementController.js:214, controllers/achievementController.js:247 (+5)` |
| 404 | Request not found | `controllers/achievementController.js:320` |
| 409 | You already have a pending request | `controllers/achievementController.js:301` |
| 422 | Enter a valid achievement date | `controllers/achievementController.js:63` |
| 422 | Only active students can be tagged | `controllers/achievementController.js:57` |
| 422 | Select at least one student | `controllers/achievementController.js:54` |
| 422 | The achievement date cannot be in the future | `controllers/achievementController.js:66` |
| 422 | You can tag at most [value] students | `controllers/achievementController.js:55` |

## Lost and found

| Code | Message | Source |
|---|---|---|
| 403 | Only staff can link a possible match | `controllers/lostFoundController.js:166` |
| 403 | Only staff or the reporter can change this report | `controllers/lostFoundController.js:160` |
| 403 | Only the reporter or staff can view possible matches | `controllers/lostFoundController.js:231` |
| 403 | You can close your own report; other status changes are made by staff | `controllers/lostFoundController.js:161` |
| 403 | You can only edit your own reports | `controllers/lostFoundController.js:121` |
| 403 | You can only remove your own reports | `controllers/lostFoundController.js:136` |
| 404 | Item not found | `controllers/lostFoundController.js:112, controllers/lostFoundController.js:120, controllers/lostFoundController.js:134 (+2)` |
| 404 | Matching item not found | `controllers/lostFoundController.js:168` |
| 422 | A lost item can only be matched with a found item | `controllers/lostFoundController.js:169` |
| 422 | Cannot edit a resolved item | `controllers/lostFoundController.js:122` |
| 422 | Date/time cannot be in the future | `controllers/lostFoundController.js:43` |
| 422 | This report is being handled by staff and can no longer be removed | `controllers/lostFoundController.js:137` |

## Hostel, analytics, dashboard and search

| Code | Message | Source |
|---|---|---|
| 403 | Only club admins, the faculty advisor or staff can view club analytics | `controllers/analyticsController.js:400` |
| 403 | You can view analytics for your own department only | `controllers/analyticsController.js:253` |
| 404 | Club not found | `controllers/analyticsController.js:398` |

## Uploads and files

| Code | Message | Source |
|---|---|---|
| 400 | No file uploaded | `utils/storage.js:70` |

## Alumni network and mentorship

| Code | Message | Source |
|---|---|---|
| 400 | Already withdrawn | `controllers/alumni/alumniJobsController.js:458` |
| 400 | Alumnus is currently not accepting mentees | `controllers/alumni/mentorshipController.js:41` |
| 400 | Application deadline has passed | `controllers/alumni/alumniJobsController.js:315` |
| 400 | Batch has no valid rows to commit | `controllers/alumni/alumniImportController.js:182` |
| 400 | Cannot apply to your own job posting | `controllers/alumni/alumniJobsController.js:310` |
| 400 | Cannot edit a removed job posting | `controllers/alumni/alumniJobsController.js:216` |
| 400 | Cannot request mentorship from yourself | `controllers/alumni/mentorshipController.js:36` |
| 400 | Check-in is only available within 2 hours of the event start/end time | `controllers/alumni/alumniEventsController.js:482` |
| 400 | Job is no longer open for applications | `controllers/alumni/alumniJobsController.js:313` |
| 400 | Please upload a CSV file or provide csv content | `controllers/alumni/alumniImportController.js:52` |
| 400 | Registration deadline for this event has passed | `controllers/alumni/alumniEventsController.js:337` |
| 400 | RSVPs are only accepted for scheduled events | `controllers/alumni/alumniEventsController.js:332` |
| 400 | Sessions cannot be rescheduled within 2 hours of start time | `controllers/alumni/mentorshipController.js:589` |
| 400 | Students cannot cancel sessions within 2 hours of start time | `controllers/alumni/mentorshipController.js:644` |
| 403 | A [value] job cannot be reopened | `controllers/alumni/alumniJobsController.js:258` |
| 403 | Access denied | `controllers/alumni/mentorshipController.js:142` |
| 403 | HOD can only review alumni from their own department | `controllers/alumni/alumniProfileController.js:395` |
| 403 | HOD can only verify alumni from their own department | `controllers/alumni/alumniProfileController.js:343` |
| 403 | Join this chapter to take part | `controllers/alumni/alumniChaptersController.js:34` |
| 403 | Must be an active chapter member to post | `controllers/alumni/alumniChaptersController.js:361` |
| 403 | Only admins can archive chapters | `controllers/alumni/alumniChaptersController.js:199` |
| 403 | Only chapter moderators can post announcements | `controllers/alumni/alumniChaptersController.js:365` |
| 403 | Permission denied | `controllers/alumni/alumniChaptersController.js:184, controllers/alumni/alumniChaptersController.js:269, controllers/alumni/alumniChaptersController.js:399 (+15)` |
| 403 | Students have read-only access to alumni chapters | `controllers/alumni/alumniChaptersController.js:215` |
| 403 | This event is restricted to a specific audience | `controllers/alumni/alumniEventsController.js:346` |
| 403 | This is a private chapter | `controllers/alumni/alumniChaptersController.js:27` |
| 403 | Verified alumni profile required to propose events | `controllers/alumni/alumniEventsController.js:132` |
| 403 | You were removed from this chapter by a moderator | `controllers/alumni/alumniChaptersController.js:223` |
| 403 | Your alumni profile must be verified before you can post jobs | `controllers/alumni/alumniJobsController.js:112` |
| 404 | Active mentorship not found | `controllers/alumni/mentorshipController.js:383` |
| 404 | Active mentorship request not found | `controllers/alumni/mentorshipController.js:362, controllers/alumni/mentorshipController.js:485` |
| 404 | Active RSVP not found | `controllers/alumni/alumniEventsController.js:386` |
| 404 | Alumni profile is not verified | `controllers/alumni/alumniProfileController.js:148` |
| 404 | Alumni profile not found | `controllers/alumni/alumniProfileController.js:141, controllers/alumni/alumniProfileController.js:340, controllers/alumni/alumniProfileController.js:392` |
| 404 | Application not found | `controllers/alumni/alumniJobsController.js:426, controllers/alumni/alumniJobsController.js:456` |
| 404 | Attendee not registered or not in going list | `controllers/alumni/alumniEventsController.js:486` |
| 404 | Chapter not found | `controllers/alumni/alumniChaptersController.js:145, controllers/alumni/alumniChaptersController.js:177, controllers/alumni/alumniChaptersController.js:197 (+7)` |
| 404 | Comment not found | `controllers/alumni/alumniChaptersController.js:498` |
| 404 | Completed mentorship request not found | `controllers/alumni/mentorshipController.js:310` |
| 404 | Confirmed session not found | `controllers/alumni/mentorshipController.js:585, controllers/alumni/mentorshipController.js:640` |
| 404 | Event not found | `controllers/alumni/alumniEventsController.js:184, controllers/alumni/alumniEventsController.js:209, controllers/alumni/alumniEventsController.js:251 (+5)` |
| 404 | Import batch not found | `controllers/alumni/alumniImportController.js:174, controllers/alumni/alumniImportController.js:282` |
| 404 | Invalid or expired invitation link | `controllers/alumni/alumniImportController.js:394, controllers/alumni/alumniImportController.js:424` |
| 404 | Invite not found | `controllers/alumni/alumniImportController.js:370` |
| 404 | Job not found | `controllers/alumni/alumniJobsController.js:369` |
| 404 | Job posting is no longer available | `controllers/alumni/alumniJobsController.js:189` |
| 404 | Job posting not found | `controllers/alumni/alumniJobsController.js:182, controllers/alumni/alumniJobsController.js:209, controllers/alumni/alumniJobsController.js:234 (+3)` |
| 404 | Membership request not found | `controllers/alumni/alumniChaptersController.js:273` |
| 404 | Mentorship request not found | `controllers/alumni/mentorshipController.js:136, controllers/alumni/mentorshipController.js:238` |
| 404 | Open slot not found | `controllers/alumni/mentorshipController.js:471` |
| 404 | Pending invite not found | `controllers/alumni/alumniImportController.js:328` |
| 404 | Post not found | `controllers/alumni/alumniChaptersController.js:388, controllers/alumni/alumniChaptersController.js:414, controllers/alumni/alumniChaptersController.js:437 (+2)` |
| 404 | Session not found | `controllers/alumni/mentorshipController.js:679, controllers/alumni/mentorshipController.js:697` |
| 404 | Verified alumni profile not found | `controllers/alumni/mentorshipController.js:40` |
| 409 | Alumnus has reached their active mentee capacity | `controllers/alumni/mentorshipController.js:44` |
| 409 | An account with this email already exists. Please log in. | `controllers/alumni/alumniImportController.js:432` |
| 409 | Cannot cancel a request that is [value] | `controllers/alumni/mentorshipController.js:241` |
| 409 | Max mentees cannot be less than currently active mentees ([value]) | `controllers/alumni/alumniProfileController.js:82` |
| 409 | New slot is no longer available | `controllers/alumni/mentorshipController.js:598` |
| 409 | Only pending event proposals can be approved | `controllers/alumni/alumniEventsController.js:253` |
| 409 | Only pending event proposals can be rejected | `controllers/alumni/alumniEventsController.js:275` |
| 409 | Request is no longer pending or does not belong to you | `controllers/alumni/mentorshipController.js:173, controllers/alumni/mentorshipController.js:211` |
| 409 | Request is not in active accepted status | `controllers/alumni/mentorshipController.js:275` |
| 409 | This import batch has already been committed | `controllers/alumni/alumniImportController.js:177` |
| 409 | This slot is no longer available | `controllers/alumni/mentorshipController.js:503` |
| 409 | You already have [value] pending mentorship requests (maximum is [value]) | `controllers/alumni/mentorshipController.js:50` |
| 409 | You already have a pending request with this alumnus | `controllers/alumni/mentorshipController.js:56` |
| 409 | You already have an upcoming session scheduled for this mentorship | `controllers/alumni/mentorshipController.js:494` |
| 409 | You have already applied for this job | `controllers/alumni/alumniJobsController.js:321` |
| 409 | You have already rated this mentorship | `controllers/alumni/mentorshipController.js:311` |
| 409 | You have reached your maximum active mentee capacity | `controllers/alumni/mentorshipController.js:184` |
| 422 | A valid https external URL is required for external link jobs | `controllers/alumni/alumniJobsController.js:136` |
| 422 | Chapter name must be at least 3 characters | `controllers/alumni/alumniChaptersController.js:88` |
| 422 | CSV file must have a header row and at least one data row | `controllers/alumni/alumniImportController.js:59` |
| 422 | CSV missing required columns: name, email, department, gradYear | `controllers/alumni/alumniImportController.js:80` |
| 422 | End date must be after start date | `controllers/alumni/alumniEventsController.js:151` |
| 422 | Goals must be an array of at most 5 items | `controllers/alumni/mentorshipController.js:354` |
| 422 | Invalid privacy field: [value] | `controllers/alumni/alumniProfileController.js:88` |
| 422 | Invalid privacy level: [value] | `controllers/alumni/alumniProfileController.js:89` |
| 422 | Maximum rows exceeded ([value] max) | `controllers/alumni/alumniImportController.js:85` |
| 422 | Password must be at least 8 characters and contain both letters and digits | `controllers/alumni/alumniImportController.js:414` |
| 422 | Provide an array of between 1 and 20 slots | `controllers/alumni/mentorshipController.js:437` |
| 422 | Rating must be an integer between 1 and 5 | `controllers/alumni/mentorshipController.js:306` |
| 422 | Rejection reason of at least 5 characters is required | `controllers/alumni/alumniProfileController.js:388` |
| 422 | Slot start time must be in the future | `controllers/alumni/mentorshipController.js:447` |
| 422 | Staff removal requires an explanation reason | `controllers/alumni/alumniJobsController.js:280` |
| 422 | Start date must be in the future | `controllers/alumni/alumniEventsController.js:148` |
| 422 | Status must be accepted or declined | `controllers/alumni/mentorshipController.js:161` |
| 422 | Status must be referred, shortlisted, or rejected | `controllers/alumni/alumniJobsController.js:433` |
| 429 | Daily job posting limit reached ([value] jobs/day) | `controllers/alumni/alumniJobsController.js:123` |
| 429 | Maximum resend limit reached for this invitation (max 5) | `controllers/alumni/alumniImportController.js:336` |

## Other

| Code | Message | Source |
|---|---|---|
| 404 | Not found | `routes/index.js:1908` |


# Appendix B: form validation messages

These **267 messages** come from the request rules in `server/src/routes/` and always arrive with status **422**. They name the field to fix. Grouped by the section of the routes file they belong to.

| Area | Message | Source |
|---|---|---|
| Public claim router (mounted at /auth/alumni-claim) | Password must be 8–72 characters | `alumniRoutes.js:39` |
| Public claim router (mounted at /auth/alumni-claim) | Password must contain a letter | `alumniRoutes.js:41` |
| Public claim router (mounted at /auth/alumni-claim) | Password must contain a number | `alumniRoutes.js:43` |
| Public claim router (mounted at /auth/alumni-claim) | You must accept the invitation | `alumniRoutes.js:44` |
| Mentorship requests router (mounted at /mentorship-requests) | Valid alumni ID required | `alumniRoutes.js:56` |
| Mentorship requests router (mounted at /mentorship-requests) | Valid mentorship domain required | `alumniRoutes.js:57` |
| Mentorship requests router (mounted at /mentorship-requests) | Message must be 5–500 characters | `alumniRoutes.js:58` |
| Mentorship requests router (mounted at /mentorship-requests) | Status must be accepted or declined | `alumniRoutes.js:77, alumniRoutes.js:87` |
| Mentorship requests router (mounted at /mentorship-requests) | Rating must be 1–5 | `alumniRoutes.js:113` |
| Mentorship requests router (mounted at /mentorship-requests) | Max 5 goals allowed | `alumniRoutes.js:123` |
| Mentorship slots & sessions router (mounted at /mentorship) | Must provide 1–20 slots | `alumniRoutes.js:144` |
| Mentorship slots & sessions router (mounted at /mentorship) | Valid start time required | `alumniRoutes.js:145` |
| Mentorship slots & sessions router (mounted at /mentorship) | Duration must be 15–180 minutes | `alumniRoutes.js:146` |
| Mentorship slots & sessions router (mounted at /mentorship) | Valid mode required | `alumniRoutes.js:147` |
| Mentorship slots & sessions router (mounted at /mentorship) | Meeting link must be a valid URL | `alumniRoutes.js:148` |
| Mentorship slots & sessions router (mounted at /mentorship) | Valid mentorship request ID required | `alumniRoutes.js:160` |
| Mentorship slots & sessions router (mounted at /mentorship) | Valid slot ID required | `alumniRoutes.js:161, alumniRoutes.js:177` |
| Main Alumni Router (mounted at /alumni) | Title must be 3–120 characters | `alumniRoutes.js:262` |
| Main Alumni Router (mounted at /alumni) | Company must be 2–120 characters | `alumniRoutes.js:263` |
| Main Alumni Router (mounted at /alumni) | Location must be 2–120 characters | `alumniRoutes.js:264` |
| Main Alumni Router (mounted at /alumni) | Valid job type required | `alumniRoutes.js:265` |
| Main Alumni Router (mounted at /alumni) | Valid work mode required | `alumniRoutes.js:266` |
| Main Alumni Router (mounted at /alumni) | Description must be 20–4000 characters | `alumniRoutes.js:267, alumniRoutes.js:332` |
| Main Alumni Router (mounted at /alumni) | Valid apply mode required | `alumniRoutes.js:268` |
| Main Alumni Router (mounted at /alumni) | Valid external URL required | `alumniRoutes.js:269` |
| Main Alumni Router (mounted at /alumni) | Valid deadline required | `alumniRoutes.js:270` |
| Main Alumni Router (mounted at /alumni) | Resume link must be an http(s) URL | `alumniRoutes.js:297` |
| Main Alumni Router (mounted at /alumni) | Title must be 3–140 characters | `alumniRoutes.js:327` |
| Main Alumni Router (mounted at /alumni) | Valid event type required | `alumniRoutes.js:328` |
| Main Alumni Router (mounted at /alumni) | Valid event mode required | `alumniRoutes.js:329` |
| Main Alumni Router (mounted at /alumni) | Valid start time required | `alumniRoutes.js:330` |
| Main Alumni Router (mounted at /alumni) | Valid end time required | `alumniRoutes.js:331` |
| Main Alumni Router (mounted at /alumni) | Rejection reason required (5–300 chars) | `alumniRoutes.js:344, alumniRoutes.js:455` |
| Main Alumni Router (mounted at /alumni) | Valid user ID required | `alumniRoutes.js:361` |
| Main Alumni Router (mounted at /alumni) | Name must be 3–80 characters | `alumniRoutes.js:378` |
| Main Alumni Router (mounted at /alumni) | Valid chapter type required | `alumniRoutes.js:379` |
| Main Alumni Router (mounted at /alumni) | Description must be 10–1000 characters | `alumniRoutes.js:380` |
| Main Alumni Router (mounted at /alumni) | Post content required (1–2000 characters) | `alumniRoutes.js:402` |
| Main Alumni Router (mounted at /alumni) | Comment must be 1–500 characters | `alumniRoutes.js:414` |
| Reusable validators | Password must be 8–72 characters | `index.js:136` |
| Reusable validators | Password must contain a letter | `index.js:138` |
| Reusable validators | Password must contain a number | `index.js:140` |
| Reusable validators | [value] must be a list (max 25) | `index.js:146` |
| Reusable validators | [value] may contain only digits, +, spaces, - and brackets | `index.js:152` |
| Reusable validators | [value] is required | `index.js:167` |
| Reusable validators | [value] must be exactly 10 digits | `index.js:167` |
| Reusable validators | [value] — distinct values from [value] | `index.js:183` |
| Reusable validators | In-charge year and semester apply to faculty accounts only | `index.js:202, index.js:210` |
| Reusable validators | In-charge year must be 1–4 | `index.js:205` |
| Reusable validators | In-charge semester must be 1–8 | `index.js:213` |
| Reusable validators | That in-charge semester does not belong to the in-charge year | `index.js:216` |
| Reusable validators | Year must be 1–4 | `index.js:225` |
| Reusable validators | That semester does not belong to this year | `index.js:228` |
| Reusable validators | [value] must be an uploaded file or https URL | `index.js:246` |
| Auth | Name must be 2–80 characters | `index.js:252` |
| Auth | Enter a valid email | `index.js:253, index.js:264` |
| Auth | Password is required | `index.js:265` |
| Auth | Invalid push token | `index.js:299` |
| Clubs | Club name must be 3–80 characters | `index.js:350` |
| Clubs | Description must be at least 20 characters | `index.js:351` |
| Events | Title must be 3–120 characters | `index.js:399` |
| Events | Description must be at least 10 characters | `index.js:400` |
| Events | Venue is required | `index.js:401` |
| Events | Valid start date required | `index.js:402` |
| Events | Valid end date required | `index.js:403` |
| Events | Invalid faculty coordinator ID | `index.js:410` |
| Events | Invalid date | `index.js:437` |
| Announcements | Title must be 3–160 characters | `index.js:448` |
| Announcements | Content is required | `index.js:449` |
| Announcements | Choose a valid department | `index.js:453` |
| Announcements | Choose a valid section | `index.js:455` |
| Student achievements | Title must be 3–160 characters | `index.js:478` |
| Student achievements | Description must be 10–3000 characters | `index.js:479` |
| Student achievements | Choose a valid category | `index.js:480` |
| Student achievements | Choose a valid level | `index.js:481` |
| Student achievements | Enter a valid achievement date | `index.js:485` |
| Student achievements | The link must start with http:// or https:// | `index.js:490` |
| Student achievements | Select 1–20 students | `index.js:491` |
| Student achievements | Invalid student | `index.js:492` |
| Student achievements | You can add at most 5 images | `index.js:493` |
| Student achievements | Invalid image | `index.js:498` |
| Student achievements | Images must be JPG, PNG or WebP | `index.js:502` |
| Discussions | Title must be 5–160 characters | `index.js:549` |
| Discussions | Please add a bit more detail (10+ characters) | `index.js:550` |
| Discussions | Reply cannot be empty | `index.js:573` |
| Notifications | Choose 5, 10, 15, 20 or 30 minutes | `index.js:618` |
| Notifications | Invalid device token | `index.js:626` |
| Admin | Name must be 2–80 characters | `index.js:645, index.js:718` |
| Admin | Choose Ms, Mr or Dr | `index.js:646, index.js:720` |
| Admin | Choose a gender | `index.js:647, index.js:721` |
| Admin | Enter a valid college email | `index.js:648, index.js:719` |
| Admin | Choose a role | `index.js:650` |
| Admin | Roll number is required | `index.js:656` |
| Admin | Choose a valid department | `index.js:658, index.js:671` |
| Admin | Year is required (1–4) | `index.js:659` |
| Admin | Section is required | `index.js:660` |
| Admin | Semester must be 1–8 | `index.js:665, index.js:727` |
| Admin | That semester does not belong to the selected year | `index.js:668` |
| Admin | Select hosteler or day scholar | `index.js:677` |
| Admin | Parent's mobile number is required | `index.js:682` |
| Admin | Parent's mobile number may contain only digits, +, spaces, - and brackets | `index.js:684` |
| Admin | Student mobile number and parent mobile number cannot be the same | `index.js:695` |
| Admin | Employee ID is required | `index.js:701` |
| Admin | Department is required | `index.js:707` |
| Admin | Choose a valid section | `index.js:709, index.js:726` |
| Admin | Year must be 1–4 | `index.js:725` |
| Admin → Role Assignments & Class In-Charge (Admin only) | Valid faculty ID required | `index.js:746, index.js:765, index.js:773` |
| Admin → Role Assignments & Class In-Charge (Admin only) | Valid department required | `index.js:747, index.js:772` |
| Admin → Role Assignments & Class In-Charge (Admin only) | Valid year (1–4) required | `index.js:748` |
| Admin → Role Assignments & Class In-Charge (Admin only) | Valid section required | `index.js:749` |
| Admin → Role Assignments & Class In-Charge (Admin only) | Valid semester (1–8) required | `index.js:750` |
| Admin → Role Assignments & Class In-Charge (Admin only) | Valid faculty 1 ID required | `index.js:757` |
| Admin → Role Assignments & Class In-Charge (Admin only) | Valid faculty 2 ID required | `index.js:758` |
| Admin → Role Assignments & Class In-Charge (Admin only) | Valid HOD ID required | `index.js:780` |
| Admin → Security & Logs (Admin only, read-only) | Unknown date range | `index.js:787` |
| Admin → Security & Logs (Admin only, read-only) | Invalid "from" date | `index.js:788` |
| Admin → Security & Logs (Admin only, read-only) | Invalid "to" date | `index.js:789` |
| Admin → Security & Logs (Admin only, read-only) | Unknown event | `index.js:797` |
| Admin → Security & Logs (Admin only, read-only) | Unknown role | `index.js:798` |
| Admin → Security & Logs (Admin only, read-only) | Unknown department | `index.js:809` |
| Admin → Security & Logs (Admin only, read-only) | Year must be 1–4 | `index.js:810` |
| Admin → Security & Logs (Admin only, read-only) | Unknown section | `index.js:811` |
| Admin → Security & Logs (Admin only, read-only) | Unknown status | `index.js:812` |
| Class In-Charge: students of their own class | Name must be 2–80 characters | `index.js:826, index.js:857` |
| Class In-Charge: students of their own class | Enter a valid college email | `index.js:827, index.js:858` |
| Class In-Charge: students of their own class | Roll number is required | `index.js:829, index.js:859` |
| Class In-Charge: students of their own class | Select hosteler or day scholar | `index.js:830, index.js:860` |
| Class In-Charge: students of their own class | Choose Mr or Ms | `index.js:831, index.js:861` |
| Class In-Charge: students of their own class | Choose Male or Female | `index.js:832, index.js:862` |
| Class In-Charge: students of their own class | Student mobile number and parent mobile number cannot be the same | `index.js:844` |
| Class In-Charge: students of their own class | Year must be 1–4 | `index.js:866` |
| Class In-Charge: students of their own class | Choose a valid section | `index.js:867` |
| Class In-Charge: students of their own class | Semester must be 1–8 | `index.js:868` |
| Authorized password reset (no current password) | Passwords do not match | `index.js:883` |
| Chat | Choose approve or reject | `index.js:911` |
| Chat | Choose who to chat with | `index.js:920` |
| Chat | Choose Custom, Academics or Faculty | `index.js:925` |
| Chat | Choose a year | `index.js:934` |
| Chat | Choose a section | `index.js:935` |
| Chat | Message cannot be empty | `index.js:963, index.js:980` |
| Chat | Attachments must be uploaded files | `index.js:968` |
| Attendance | Valid date required (YYYY-MM-DD) | `index.js:1000` |
| Attendance | Subject is required | `index.js:1017, index.js:1029, index.js:1071` |
| Attendance | Period is required | `index.js:1019` |
| Attendance | Records are required | `index.js:1033` |
| Attendance | Message must be at most 500 characters | `index.js:1050` |
| Attendance | Unknown report type | `index.js:1099` |
| Attendance | Period must be 1–12 or all | `index.js:1110` |
| Attendance | Scope must be class or handling | `index.js:1112` |
| Early exits and period cover (substitutes) | Give the reason (5–300 characters) | `index.js:1157` |
| Early exits and period cover (substitutes) | Departure time must be HH:mm | `index.js:1158` |
| Early exits and period cover (substitutes) | Choose the substitute | `index.js:1185` |
| Early exits and period cover (substitutes) | Date must be YYYY-MM-DD | `index.js:1195` |
| Early exits and period cover (substitutes) | Records are required | `index.js:1217` |
| Early exits and period cover (substitutes) | Please explain the correction (5+ characters) | `index.js:1232` |
| On Duty (OD) & Leave Requests | Choose On Duty (OD) or Leave | `index.js:1253` |
| On Duty (OD) & Leave Requests | Category is required | `index.js:1254, index.js:1254` |
| On Duty (OD) & Leave Requests | Description is required | `index.js:1255` |
| On Duty (OD) & Leave Requests | Description must be 5–1000 characters | `index.js:1255` |
| On Duty (OD) & Leave Requests | Valid from date required | `index.js:1256` |
| On Duty (OD) & Leave Requests | Valid to date required | `index.js:1257` |
| On Duty (OD) & Leave Requests | Invalid document | `index.js:1258` |
| On Duty (OD) & Leave Requests | Choose forward, approve or reject | `index.js:1290` |
| On Duty (OD) & Leave Requests | Reason must be text | `index.js:1291` |
| Timetable | Subject is required | `index.js:1311` |
| Timetable | Faculty is required | `index.js:1312` |
| Timetable | Choose a valid section | `index.js:1313` |
| Timetable | Department is required | `index.js:1314` |
| Timetable | Choose a day | `index.js:1315` |
| Timetable | Period must be 1–12 | `index.js:1318` |
| Timetable | Start time must be HH:mm | `index.js:1319` |
| Timetable | End time must be HH:mm | `index.js:1320` |
| Timetable | Choose a semester (1–8) | `index.js:1321` |
| Timetable | Subject name required | `index.js:1332` |
| Timetable | Subject code required | `index.js:1333` |
| Timetable | Department required | `index.js:1334` |
| Timetable | Year must be 1–4 | `index.js:1351, index.js:1362, index.js:1372` |
| Timetable | Semester must be 1–8 | `index.js:1352, index.js:1363, index.js:1373` |
| Timetable | Scope must be class or handling | `index.js:1354` |
| Timetable | Invalid day of week | `index.js:1365, index.js:1375, index.js:1383 (+1)` |
| Exam timetable | Year must be 1st–4th or All Years | `index.js:1423` |
| Exam timetable | Choose a valid section or All Sections | `index.js:1424` |
| Exam timetable | Choose a department or All Departments | `index.js:1426` |
| Exam timetable | Subject code must be 2–20 characters | `index.js:1433` |
| Exam timetable | Subject code may contain letters, digits, spaces, . / - | `index.js:1434` |
| Exam timetable | Subject name must be 2–120 characters | `index.js:1435` |
| Exam timetable | Exam date must be YYYY-MM-DD | `index.js:1436` |
| Exam timetable | Start time must be HH:mm | `index.js:1437` |
| Exam timetable | End time must be HH:mm | `index.js:1438` |
| Exam timetable | Status must be draft or published | `index.js:1458` |
| Exam timetable | Add between 1 and 30 exams | `index.js:1459` |
| Exam timetable | Reason must be at most 300 characters | `index.js:1471` |
| College buses | Latitude must be -90…90 | `index.js:1481` |
| College buses | Longitude must be -180…180 | `index.js:1482` |
| College buses | Route name: 2–80 characters | `index.js:1501` |
| College buses | A route needs 2–200 stops | `index.js:1503` |
| College buses | Scheduled time must be HH:mm | `index.js:1507` |
| College buses | Send 1–20 location fixes | `index.js:1530` |
| College buses | Each fix needs a timestamp | `index.js:1532` |
| Holidays | Reason must be 3–200 characters | `index.js:1563` |
| Holidays | Choose Single Day or Custom | `index.js:1564` |
| Holidays | Choose a "To" date | `index.js:1569` |
| Holidays | Year must be 1–4 or ALL | `index.js:1571` |
| Study Materials | Title is required | `index.js:1589` |
| Study Materials | Choose a subject | `index.js:1592` |
| Study Materials | Select a semester | `index.js:1613` |
| JNN Study Assistant (lives inside Study Materials) | Please type a question | `index.js:1633` |
| JNN Study Assistant (lives inside Study Materials) | Questions must be 1–[value] characters | `index.js:1637` |
| JNN Study Assistant (lives inside Study Materials) | Invalid conversation id | `index.js:1638` |
| Gate Pass | Select a valid reason | `index.js:1659` |
| Gate Pass | Please describe the reason (5+ characters) | `index.js:1660, index.js:1685` |
| Gate Pass | Departure date required | `index.js:1661` |
| Gate Pass | Return date required | `index.js:1662` |
| Gate Pass | State is required | `index.js:1665` |
| Gate Pass | District is required | `index.js:1666` |
| Gate Pass | Village / area is required | `index.js:1667` |
| Gate Pass | Subject is required (2–120 characters) | `index.js:1684` |
| Gate Pass | Choose who to send it to: Principal, AO, Dean or Chairman | `index.js:1699` |
| Gate Pass | Please describe the emergency (5+ characters) | `index.js:1700` |
| Gate Pass | Destination is required | `index.js:1701` |
| Gate Pass | Date and leaving time are required | `index.js:1702` |
| Gate Pass | Expected return time is required | `index.js:1703` |
| Gate Pass | Date must be YYYY-MM-DD | `index.js:1716` |
| Gate Pass | View must be in, out or left | `index.js:1725` |
| Gate Pass | Verification code is required | `index.js:1736` |
| Gate Pass | Return code is required | `index.js:1741` |
| Gate Pass | Invalid status | `index.js:1750` |
| Gate Pass | Reason must be text | `index.js:1751` |
| Gate Pass | Reason must be at most 300 characters | `index.js:1751` |
| Gate Pass | Group name is required | `index.js:1757` |
| Gate Pass | Group name must be 2–80 characters | `index.js:1757` |
| Gate Pass | Title is required | `index.js:1758` |
| Gate Pass | Title must be 2–120 characters | `index.js:1758` |
| Gate Pass | Reason is required | `index.js:1759` |
| Gate Pass | Reason must be 5–500 characters | `index.js:1759` |
| Gate Pass | Choose forward or reject | `index.js:1771` |
| Gate Pass | Choose approve or reject | `index.js:1781` |
| Gate Pass | Choose a bind group | `index.js:1800` |
| Gate Pass | Enter a valid 10-digit mobile number | `index.js:1815` |
| Gate Pass | Reason is too long (200 characters max) | `index.js:1816` |
| Gate Pass | Enter the [value]-digit OTP | `index.js:1829` |
| Gate Pass | Valid departure date is required | `index.js:1841` |
| Gate Pass | Valid return date is required | `index.js:1842` |
| Gate Pass | Description must be 3–500 characters | `index.js:1843` |
| Gate Pass | Select a valid regarding category | `index.js:1844` |
| Gate Pass | Invalid destination | `index.js:1845` |
| Gate Pass | Destination fields must be text | `index.js:1846` |
| Gate Pass | Gate pass code is required | `index.js:1858` |
| Gate Pass | Invalid latitude | `index.js:1869` |
| Gate Pass | Invalid longitude | `index.js:1870` |
| Gate Pass | Location accuracy is required | `index.js:1871` |
| Gate Pass | Location timestamp is required | `index.js:1874` |
| Gate Pass | Invalid sent time | `index.js:1879` |
| Gate Pass | Give a reason | `index.js:1891` |
| Gate Pass | Reason must be 3–300 characters | `index.js:1891` |
| Lost & Found | Type must be "lost" or "found" | `index.js:1915` |
| Lost & Found | Item name is required | `index.js:1916` |
| Lost & Found | Choose a category | `index.js:1917` |
| Lost & Found | Location is required | `index.js:1920` |
| Lost & Found | Date/time is required | `index.js:1921` |
| Complaints | Choose a valid grievance category | `index.js:1960` |
| Complaints | Choose a valid subcategory | `index.js:1967` |
| Complaints | Choose a valid authority to escalate to | `index.js:1970` |
| Complaints | Describe the grievance (10–2000 characters) | `index.js:1971` |
| Complaints | At most 5 supporting files | `index.js:1972` |
| Complaints | Attachment must be an uploaded file or https URL | `index.js:1977` |
| Campus SOS | Valid SOS type is required | `index.js:2016` |


# Appendix C: rate-limit messages (status 429)

Sent by `server/src/middleware/rateLimit.js` when one address or user makes too many requests in a short time. The user only needs to wait.

| Limiter | Message |
|---|---|
| `apiLimiter` | Too many requests, please slow down |
| `locationLimiter` | Location updates are arriving too fast |
| `trackerLimiter` | Too many tracker requests |
| `authLimiter` | Too many failed sign-in attempts from this network. Try again later. |
| `refreshLimiter` | Too many session-refresh attempts. Please sign in again. |
| `writeLimiter` | You are posting too fast. Please wait a moment. |
| `uploadLimiter` | Upload limit reached. Try again later. |
| `passwordResetLimiter` | Too many password reset requests. Try again in a few minutes. |
| `verifyLimiter` | Too many verification attempts. Please wait a moment. |
| `otpLimiter` | Too many OTP requests. Please wait a few minutes. |
| `returnLocationLimiter` | Too many location checks. Please wait a few minutes and try again. |
| `passwordResetSubmitLimiter` | Too many attempts. Request a new reset link and try again later. |


# Source references

`server/src/utils/http.js` (ApiError) · `server/src/middleware/error.js` · `server/src/middleware/validate.js` · `server/src/middleware/rateLimit.js` · `server/src/routes/index.js` · `client/src/utils/format.js` · `client/src/pages/transport/myLocation.js` · `client/src/utils/returnLocation.js` · `mobile-kotlin/app/src/main/java/com/vexon/campus/core/Http.kt` · `docs/developer-handbook/build_error_catalog.py`
