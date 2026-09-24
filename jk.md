You are working on my existing project called VEXON.

IMPORTANT:
I already have the project code, authentication, database, UI, and other existing functionality implemented. DO NOT rebuild the project from scratch. DO NOT replace the existing technology stack. DO NOT create unnecessary new modules or future features.

Your job is to inspect the existing Vexon codebase first, understand how the current application works, and then ADD and integrate only the following features:

1. ACCURATE LOGIN & ACCOUNT SECURITY
2. CHAT / REAL-TIME COMMUNICATION
3. ATTENDANCE MANAGEMENT
4. GATE PASS MANAGEMENT
5. ADVANCED ANALYTICS
6. LOST & FOUND
7. SMART TIMETABLE

The new features must look and behave like native parts of Vexon, not like separately added demo pages.

Before changing anything, inspect the existing authentication, user model, roles, database models, API endpoints, frontend components, navigation, dashboard, notifications, and existing styling. Reuse existing components and functionality wherever possible.

Do not break any existing working feature.

==================================================
1. ACCURATE LOGIN & ACCOUNT SECURITY
==================================================

Improve the existing login system so that login works accurately and securely for every supported user.

The login system should:

- Accept the user's official college email and password.
- Validate credentials against the actual database.
- Never allow frontend-only authentication.
- Authentication must always be verified by the backend.
- Show clear but safe error messages for incorrect credentials.
- Do not reveal whether an email account exists when handling sensitive authentication errors.
- Prevent brute-force login attempts with rate limiting.
- Support secure session management.
- Support logout correctly.
- When the user logs out, invalidate the appropriate session/token.
- Keep users logged in safely when appropriate.
- Handle expired access tokens correctly.
- Refresh authentication securely without forcing the user to log in repeatedly.
- Prevent unauthorized access to protected pages by manually entering URLs.
- Redirect unauthenticated users to login.
- Prevent users from accessing another user's information by changing IDs in URLs or API requests.
- Enforce authorization on the backend, not just in the frontend.

Account security should include:

- Login history
- Active sessions/devices
- Logout from current device
- Logout from other sessions where the existing application supports it
- New-device login detection
- Secure password reset
- Secure password change
- Account lock/rate-limit protection where appropriate
- Audit logging for important account actions

If MFA/OTP functionality already exists, integrate it correctly rather than creating another authentication system.

If MFA does not exist, do not build an unnecessarily complicated new authentication platform unless it is required by the existing implementation.

The login experience must be simple and reliable.

==================================================
2. CHAT / REAL-TIME COMMUNICATION
==================================================

Add a complete campus chat feature using the existing Socket.IO implementation if it already exists.

The chat should support:

- Student-to-student private chat
- Student-to-faculty chat
- Faculty-to-student chat
- Group chat where the user's existing permissions allow it
- Class/section discussions where applicable
- Club discussions where applicable
- Real-time message delivery
- Message timestamps
- Message status
- Online/offline presence
- Typing indicator
- Unread message count
- Read status
- Reply to a message
- Delete a message where permitted
- Search conversations
- Search messages where supported
- Pin important messages
- Notifications for new messages
- Proper empty states
- Loading states
- Error states

Users must only be able to access conversations they are actually members of.

A user must NEVER be able to retrieve another private conversation by modifying an ID in a request.

For group conversations:

- Members can see messages only while they are members.
- Adding/removing members must follow permissions.
- The system should record relevant membership changes.
- If a user leaves a group, they should no longer receive new private group messages unless the existing business rules explicitly allow historical access.

The chat UI should feel modern and natural:

- Conversation list
- Search
- Chat window
- Message bubbles
- Reply interaction
- Typing indicator
- Online indicator
- Attachment option if the existing file-upload system supports it
- Unread indicators
- Notification integration

Do not create fake messages or hardcoded conversations.

All messages must be stored and retrieved from the real application database.

==================================================
3. ATTENDANCE MANAGEMENT
==================================================

Implement a complete and accurate attendance system.

The most important requirement is ACCURACY.

Attendance percentage must be calculated using:

Present Periods / Total Conducted Periods × 100

Do NOT calculate overall attendance by simply averaging subject percentages.

Example:

Student has:

Subject A:
45 present / 50 conducted

Subject B:
20 present / 30 conducted

Overall attendance must be:

65 / 80 × 100

not:

(90% + 66.67%) / 2

The system must maintain actual attendance records.

STUDENT VIEW:

Students should be able to see:

- Overall attendance
- Subject-wise attendance
- Daily attendance
- Weekly attendance
- Monthly attendance
- Semester attendance
- Present periods
- Absent periods
- Total conducted periods
- Attendance percentage
- Subjects where attendance is below 75%
- Attendance trend where useful

Students should not be able to modify their own attendance.

FACULTY VIEW:

Faculty should be able to:

- View assigned subjects
- View assigned classes/sections
- Select date
- Select period
- Select subject
- Mark students present/absent
- View existing attendance
- Correct attendance when permitted
- See subject attendance statistics

CLASS MENTOR VIEW:

Class mentors should be able to:

- View attendance for their assigned section
- View students below 75%
- View subject-wise attendance
- View attendance trends
- Review attendance correction requests

HOD VIEW:

HOD should be able to:

- View department attendance
- View section attendance
- View subject attendance
- View students below required attendance
- View faculty/subject attendance information according to permissions

PRINCIPAL / ADMIN VIEW:

Authorized administrators should be able to view college-level attendance analytics.

ATTENDANCE CORRECTION:

Students may request an attendance correction.

The request should contain:

- Student
- Subject
- Date
- Period
- Existing attendance status
- Requested status
- Reason
- Request timestamp

Faculty or the appropriate authorized person can:

- Approve
- Reject

The system should record:

- Original status
- New status
- Who approved/rejected it
- Timestamp
- Reason
- Previous and updated values

Do not silently overwrite historical attendance.

Attendance calculations should update automatically after an approved correction.

Prevent:

- Duplicate attendance records
- Unauthorized attendance editing
- Attendance modification by students
- Invalid subject/student combinations
- Marking attendance for a class the faculty member is not assigned to

==================================================
4. GATE PASS MANAGEMENT
==================================================

Create a proper digital gate-pass system.

The purpose is to manage student campus exit and return accurately.

STUDENT:

A student should be able to:

- Create a gate-pass request
- Select reason
- Select expected exit time
- Select expected return time
- Add required description
- Submit the request
- View request status
- View approval history
- View active gate passes
- View previous gate-pass history

APPROVAL:

Use the existing user roles and permissions.

The appropriate authorized staff should be able to:

- Review request
- Approve
- Reject
- Add rejection reason where applicable
- View student information relevant to the request

When approved, the system should generate a secure gate-pass verification code/QR.

The QR/code must:

- Be generated by the backend
- Be difficult to guess
- Be tied to the specific gate pass
- Have an expiry time
- Be single-use where appropriate
- Be revocable
- Not expose sensitive student information directly inside the QR
- Be validated by the backend

SECURITY GUARD:

Security staff should have a gate verification screen where they can:

- Scan QR
- Or enter the verification code
- Verify whether the pass is valid
- See only the information required for gate verification
- Confirm student exit
- Record actual exit time
- Confirm student return
- Record actual return time

The system must prevent:

- Reusing expired passes
- Reusing a completed pass
- Using a revoked pass
- Using another student's pass
- Forged QR codes
- Client-side-only verification

The backend must perform the final verification.

GATE DASHBOARD:

Authorized staff should be able to see:

- Students currently inside
- Students currently outside
- Today's exits
- Today's returns
- Pending gate passes
- Approved passes
- Rejected passes
- Expired passes
- Gate-pass history

Show actual exit and return timestamps.

Do not rely only on expected return time to determine whether a student is inside or outside.

The student's current campus status should be based on recorded gate events.

==================================================
5. ADVANCED ANALYTICS
==================================================

Add meaningful analytics using REAL application data.

Do not create fake charts just to fill the dashboard.

Analytics should respect role-based access.

STUDENT ANALYTICS:

Students can see their own:

- Attendance
- Attendance trends
- Event participation
- Club participation
- Gate-pass history
- Academic/activity information that they are authorized to view

FACULTY ANALYTICS:

Faculty can see authorized:

- Subject attendance
- Section attendance
- Attendance trends
- Students below attendance threshold
- Class participation where available

CLASS MENTOR:

Show:

- Section attendance
- Students below 75%
- Attendance trends
- Attendance distribution
- Gate-pass activity where authorized

HOD:

Show department-level:

- Overall attendance
- Subject-wise attendance
- Section comparison
- Attendance trends
- Students below threshold
- Event participation where available
- Club participation where available

PRINCIPAL / ADMIN:

Show college-level analytics such as:

- Overall attendance
- Department attendance
- Attendance trends
- Student participation
- Event registrations
- Club activity
- Gate-pass activity
- Campus engagement

GATE ANALYTICS:

Show:

- Total exits
- Total returns
- Students currently outside
- Average time outside
- Gate-pass approval activity
- Daily/weekly/monthly trends

The analytics should support useful time filters where appropriate:

- Today
- This week
- This month
- Current semester

Use the existing chart library and existing Vexon design system.

Charts should have:

- Correct labels
- Useful tooltips
- Empty states
- Loading states
- Error states
- Proper date/time handling

Do not expose analytics that the current user is not authorized to see.

==================================================
6. LOST & FOUND
==================================================

Add a Lost & Found feature for campus users.

Students/staff should be able to report:

LOST ITEM:

- Item name
- Category
- Description
- Photo
- Last known location
- Date/time
- Additional details
- Contact method according to privacy rules

FOUND ITEM:

- Item name
- Category
- Description
- Photo
- Found location
- Date/time
- Additional details

Users should be able to:

- Browse lost items
- Browse found items
- Search items
- Filter by category
- Filter by location
- Filter by date
- View item details
- Report an item
- Update their own report where permitted
- Mark an item as resolved/found

Matching should help users find possible matches based on information such as:

- Item category
- Item name
- Location
- Date
- Description

Do not automatically claim that two items are definitely the same.

Use wording such as:

- Possible match
- Potential match
- Needs verification

The actual ownership should be confirmed by the appropriate person.

ADMIN / SECURITY:

Authorized staff should be able to:

- Review reports
- Verify found items
- Manage inappropriate reports
- Update status
- Mark items as returned
- Record resolution
- View history

Possible statuses:

- Lost
- Found
- Possible Match
- Under Verification
- Returned
- Closed

Do not expose unnecessary personal information publicly.

==================================================
7. SMART TIMETABLE
==================================================

Add a smart timetable feature connected to the actual academic data.

STUDENT VIEW:

Students should see:

- Today's timetable
- Weekly timetable
- Subject
- Faculty
- Room
- Period
- Start time
- End time
- Section/class
- Current/next class

The timetable should make it easy to understand:

- Current class
- Next class
- Remaining classes today

FACULTY VIEW:

Faculty should see:

- Today's schedule
- Weekly schedule
- Subject
- Room
- Section
- Period
- Start/end time

AUTHORIZED ADMIN/HOD USERS:

Should be able to manage timetable information according to their permissions.

The timetable should connect correctly with:

- Subject
- Faculty
- Class/section
- Room
- Attendance

For example, when a faculty member marks attendance, the system should use the correct scheduled subject/class/period rather than allowing arbitrary combinations.

Handle:

- Different working days
- Different periods
- Break periods
- Holidays where existing academic calendar functionality supports them
- Semester-specific timetable
- Section-specific timetable
- Faculty-specific timetable

Provide:

- Daily view
- Weekly view
- Mobile-friendly timetable
- Current class indicator
- Next class indicator

Do not hardcode a timetable into the frontend.

Timetable data must come from the database.

==================================================
UI / UX REQUIREMENTS
==================================================

All new features must match the existing Vexon UI.

Do not create a completely different design.

Maintain the existing:

- Colors
- Typography
- Glassmorphism style
- Cards
- Buttons
- Navigation
- Spacing
- Responsive behavior
- Dark/light theme if already implemented

Use smooth and professional interactions.

Every feature must include proper:

- Loading states
- Empty states
- Error states
- Success messages
- Confirmation dialogs where necessary
- Form validation
- Mobile responsiveness

Avoid unnecessary animations that make the application slow.

==================================================
DATA ACCURACY & SECURITY
==================================================

This is extremely important.

Do not use:

- Hardcoded attendance
- Hardcoded analytics
- Fake chat messages
- Fake gate-pass verification
- Fake timetable data
- Fake lost-and-found matches

Everything should work using the existing Vexon database and APIs.

Every backend request must verify:

1. User authentication
2. User authorization
3. Resource ownership/access
4. Input validity
5. Business rules

A user must never gain access to another user's information by changing an ID, URL parameter, request body, or API request.

Protect against:

- NoSQL injection
- XSS
- Brute-force attacks
- Unauthorized API access
- IDOR/BOLA
- Invalid file uploads
- Rate-limit abuse
- Unauthorized role escalation

Never trust role information sent from the frontend.

The backend must determine the user's actual permissions.

==================================================
EXISTING PROJECT RULE
==================================================

Do not rebuild Vexon.

Do not delete working functionality.

Do not replace the existing authentication system unless it is actually broken.

Do not replace the existing database.

Do not introduce PostgreSQL, MySQL, SQLite, or another primary database.

MongoDB remains the primary application database.

Do not add unrelated features.

Do not create placeholder implementations that appear finished but do not actually work.

If an existing component/model/API already provides part of a requested feature, extend it instead of creating a duplicate.

If an existing feature conflicts with the requirements above, make the smallest safe change necessary to bring it into compliance.

After implementation, verify that:

- Existing features still work
- Login works correctly
- Chat works in real time
- Attendance calculations are accurate
- Attendance permissions are correct
- Gate-pass verification is secure
- Analytics use real data
- Lost & Found works end-to-end
- Timetable uses real academic data
- Unauthorized users cannot access restricted information
- The application works on desktop and mobile

Build these features as REAL, WORKING Vexon functionality, not mockups or demonstrations.

Most importantly: inspect the existing code first, understand it, preserve what already works, and then implement these requested features cleanly and completely.