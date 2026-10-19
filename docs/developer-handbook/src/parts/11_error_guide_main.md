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
