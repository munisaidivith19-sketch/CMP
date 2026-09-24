You are working on my existing project called VEXON.

IMPORTANT:
This is NOT a new project.
Do NOT rebuild the project from scratch.
Do NOT replace the existing architecture.
Do NOT create a separate backend.
Do NOT create a separate database.
Do NOT remove working features.
Do NOT rewrite working modules unnecessarily.

First inspect the entire existing repository carefully and understand what is already implemented.

The uploaded/current project is the actual source of truth.

==================================================
PROJECT GOAL
==================================================

Vexon is a college community platform for:

- Students
- Faculty
- Club Administrators
- System Administrators

The current project already contains a working web application and a backend with many implemented modules.

I now need you to COMPLETE the missing/incomplete functionality and then prepare the project so the same backend can support an Android application.

The final system should work as:

Web App
+
Android App
+
Same Backend
+
Same MongoDB Database
+
Real-time synchronization using Socket.IO

==================================================
VERY IMPORTANT — TECHNOLOGY RESTRICTION
==================================================

Use ONLY the technology stack already used in this project and the technology stack specified by the original project requirements.

Do NOT introduce a completely different technology stack.

Use:

FRONTEND:
- React.js
- Vite
- HTML5
- CSS3
- Tailwind CSS
- JavaScript
- Redux Toolkit
- RTK Query where already used
- React Router
- Axios
- React Hook Form
- Socket.IO Client
- Recharts
- lucide-react where already used

BACKEND:
- Node.js
- Express.js
- REST APIs
- Socket.IO
- Multer
- Express middleware
- express-validator

DATABASE:
- MongoDB
- Mongoose
- MongoDB aggregation pipelines
- MongoDB indexes

AUTHENTICATION / SECURITY:
- JWT
- bcrypt.js
- RBAC
- Input validation
- API authorization
- Rate limiting
- CORS
- Secure file upload validation
- Existing security middleware

Do NOT replace MongoDB with PostgreSQL, MySQL, Firebase, Supabase, SQL Server, etc.

Do NOT replace Node/Express with Django, Laravel, Spring, FastAPI, NestJS, etc.

Do NOT replace React with Angular, Vue, Flutter, etc.

Do NOT introduce Redis, Firebase database, Supabase database, or another primary database.

For the Android application, use React Native with Expo because the requirement is to provide an Android APK while keeping the existing JavaScript/React ecosystem.

The Android application must use the SAME existing backend and SAME MongoDB database.

==================================================
FIRST TASK — INSPECT BEFORE MODIFYING
==================================================

Before writing code:

1. Inspect the complete repository.
2. Inspect package.json files.
3. Inspect frontend routes.
4. Inspect backend routes.
5. Inspect controllers.
6. Inspect services.
7. Inspect models.
8. Inspect middleware.
9. Inspect Socket.IO implementation.
10. Inspect authentication.
11. Inspect Redux/RTK Query implementation.
12. Inspect existing pages/components.
13. Inspect existing database schemas.
14. Inspect existing API endpoints.
15. Identify which features are already fully working.
16. Identify which features are partially implemented.
17. Identify which backend features exist but have no frontend UI.
18. Identify broken or disconnected features.
19. Check whether existing Socket.IO events are actually connected to the frontend.
20. Check for duplicate implementations before creating anything new.

DO NOT start by creating a new architecture.

DO NOT delete working code simply because you would design it differently.

Extend the existing implementation.

==================================================
CURRENT PROJECT STATUS
==================================================

The current project already contains working or partially working functionality including:

- Login
- Registration
- Dashboard
- Student profiles
- Announcements
- Clubs
- Club membership
- Events
- Event registration
- Discussions
- Discussion replies/upvotes
- Notifications
- Search
- Admin management
- Reports/moderation
- File uploads
- Analytics
- JWT authentication
- RBAC
- Socket.IO
- MongoDB/Mongoose
- Backend modules for Chat
- Backend modules for Attendance
- Backend modules for Timetable
- Backend modules for Gate Pass
- Backend modules for Lost & Found
- Backend analytics functionality

Some of these backend features may not yet have complete frontend screens or complete user flows.

Your job is to connect and complete them instead of rebuilding them.

==================================================
FEATURES TO COMPLETE
==================================================

Complete these missing/incomplete features:

1. CHAT
2. ATTENDANCE
3. SMART TIMETABLE
4. DIGITAL GATE PASS
5. LOST & FOUND
6. ADVANCED ANALYTICS
7. ACCOUNT SECURITY
8. REAL-TIME SYNCHRONIZATION
9. ANDROID APPLICATION

==================================================
1. REAL-TIME CHAT
==================================================

Complete the chat feature using the existing Socket.IO implementation.

Requirements:

- Student to student chat
- Student to faculty chat
- Faculty to faculty chat where permitted
- Private conversations
- Group conversations where supported by existing backend
- Conversation list
- Message history
- Send message
- Receive message in real time
- Online/offline status
- Typing indicator
- Read status
- Unread message count
- Reply to message
- Message timestamps
- Search conversations/messages if existing backend supports it
- Chat notifications
- Proper authorization

When User A sends a message:

User B should receive it immediately through Socket.IO without refreshing the page.

Persist messages in MongoDB.

Do not use frontend-only temporary messages as the final implementation.

Do not expose conversations to unauthorized users.

==================================================
2. ATTENDANCE MANAGEMENT
==================================================

Complete the frontend and backend integration for attendance.

Student:

- Overall attendance
- Subject-wise attendance
- Daily attendance
- Weekly attendance
- Monthly attendance
- Semester attendance
- Present/absent counts
- Attendance percentage
- Attendance history
- Low attendance warning
- Attendance correction request

Faculty:

- Select class/section
- Select subject
- Select date
- Select period
- Mark attendance
- Update attendance only when authorized
- View attendance history
- Submit/correct attendance where permitted

Class Mentor/HOD/Admin:

- Appropriate attendance views based on existing RBAC
- Class/section analytics
- Student attendance monitoring
- Low attendance students
- Correction request approval/rejection

IMPORTANT:

Attendance percentage must be calculated using:

total present periods / total conducted periods × 100

Do NOT calculate overall attendance by averaging subject percentages.

Prevent duplicate attendance records.

Prevent unauthorized modification.

Maintain an audit/history where the existing backend supports it.

When attendance is updated, connected users should receive the relevant real-time update using Socket.IO where appropriate.

==================================================
3. SMART TIMETABLE
==================================================

Complete the timetable feature.

Student view:

- Today
- Weekly timetable
- Subject
- Faculty
- Room
- Section
- Period
- Start time
- End time
- Current class
- Next class

Faculty view:

- Daily timetable
- Weekly timetable
- Assigned subjects
- Sections
- Rooms
- Periods

Admin:

- Manage timetable data
- Create/update/delete timetable entries
- Prevent obvious scheduling conflicts where existing architecture allows

IMPORTANT:

Timetable must use real database data.

Do NOT hard-code timetable information.

Attendance should use the correct subject/faculty/class/period information from the timetable where appropriate.

==================================================
4. DIGITAL GATE PASS
==================================================

Complete the gate pass frontend and backend flow.

Student:

- Create gate pass request
- Reason
- Destination/details according to existing model
- Requested exit time
- Expected return time
- View status
- View history
- Cancel request where allowed

Authorized faculty/admin/security role:

- View pending requests
- Approve
- Reject
- View details
- Verify gate pass

Gate verification:

- Use the existing backend approach if available.
- Generate a secure backend-controlled QR/code.
- Do NOT put sensitive student information directly into the QR code.
- QR/code must be tied to the gate pass record.
- It must be difficult to guess.
- It must support expiry/revocation.
- It must not be reusable after being consumed if the existing business logic requires single-use behavior.

Record:

- Approval time
- Exit time
- Return time
- Verification time
- Current status
- Current inside/outside state where supported

Student should receive real-time status changes through Socket.IO.

==================================================
5. LOST & FOUND
==================================================

Complete Lost & Found.

Users should be able to:

- Report lost item
- Report found item
- Upload image
- Add title
- Description
- Category
- Location
- Date/time
- Contact/recovery information according to existing design

Provide:

- Search
- Filters
- Lost items
- Found items
- Status
- Possible match
- Under verification
- Returned
- Closed

Possible matching should be presented only as a possible match.

Do NOT claim ownership automatically.

Admin/security/authorized users should be able to manage reports.

Use the existing file-upload system.

Validate uploaded files securely.

==================================================
6. ADVANCED ANALYTICS
==================================================

Complete the analytics dashboards using REAL MongoDB data.

Do NOT use fake hard-coded numbers.

Student analytics:

- Attendance
- Event participation
- Club participation
- Activity history
- Engagement trends

Faculty/class/section analytics:

- Attendance trends
- Student participation
- Event participation where authorized

Club analytics:

- Members
- Events
- Participation
- Engagement

Admin analytics:

- Total students
- Active users
- Events
- Event registrations
- Clubs
- Club membership
- Discussions
- Attendance trends
- Engagement trends
- Other metrics already supported by the existing backend

Provide useful filters:

- Daily
- Weekly
- Monthly
- Semester
- Date range

Use the existing Recharts implementation where appropriate.

Use MongoDB aggregation pipelines for calculations where appropriate.

Do not expose data to roles that should not see it.

==================================================
7. ACCOUNT SECURITY
==================================================

Complete the existing authentication/security UX without replacing the existing authentication system.

Add/fix where missing:

- Forgot password
- Password reset
- Password change
- Session management
- Active sessions/devices
- Login history
- Secure logout
- Logout other sessions where supported
- Account security page
- Proper protected routes
- Role-based frontend access
- Backend authorization

Password reset:

- Must be short-lived
- Must be single-use
- Must not be logged
- Must be rate-limited
- Avoid account enumeration
- Invalidate/reset appropriately

Never put secrets or private credentials in frontend source code.

Never trust frontend role checks alone.

Backend authorization must always be enforced.

==================================================
8. REAL-TIME SYNCHRONIZATION
==================================================

This is extremely important.

Use the existing Socket.IO implementation.

Web and Android must be able to receive real-time changes from the same backend.

Real-time functionality should cover where appropriate:

- Chat messages
- Typing status
- Online/offline status
- Read status
- Notifications
- New announcements
- Event updates
- Club updates
- Gate pass status
- Attendance updates
- Relevant discussion updates
- Other existing real-time functionality

Use REST APIs for normal CRUD/data fetching.

Use Socket.IO for live updates.

Do not replace REST APIs with Socket.IO unnecessarily.

Use MongoDB as the persistent source of truth.

The flow must remain:

Web/Mobile
→ REST API or Socket.IO
→ Node/Express backend
→ authorization/validation
→ MongoDB
→ Socket.IO event to authorized connected clients

==================================================
9. ANDROID APPLICATION
==================================================

After understanding the existing web/backend implementation, create an Android application using:

React Native + Expo

Do NOT create another backend.

Do NOT create another database.

Do NOT duplicate the application's business logic unnecessarily.

The mobile application must connect to the EXISTING Vexon backend.

Use the same:

- Authentication
- REST APIs
- Socket.IO server
- MongoDB data
- User roles
- Permissions
- Notifications/business logic

The Android application should include the major student-facing features:

- Login
- Dashboard
- Profile
- Announcements
- Notifications
- Clubs
- Club membership
- Events
- Event registration
- Discussions
- Chat
- Attendance
- Timetable
- Gate pass
- Lost & Found
- Search
- Relevant settings/account security

Create mobile-appropriate UI rather than simply shrinking the desktop UI.

Use the existing Vexon design language.

The app should be capable of being built into an Android APK.

==================================================
MOBILE REAL-TIME REQUIREMENT
==================================================

The Android app must connect to the same Socket.IO server.

Example:

Student A on Web
        ↓
Socket.IO
        ↓
Vexon Backend
        ↓
MongoDB
        ↓
Socket.IO
        ↓
Student B on Android

Changes made from the web should appear on Android.

Changes made from Android should appear on the web.

Do not create a separate mobile database.

==================================================
PUSH NOTIFICATIONS
==================================================

If the existing project already has a notification infrastructure, extend it.

For Android notifications, use the appropriate notification mechanism supported by the chosen React Native/Expo implementation, while keeping the backend notification logic centralized.

Important events such as:

- New message
- Gate pass approval
- Important announcement
- Event update
- Relevant notification

should be capable of notifying mobile users.

Do not duplicate notification business logic between web and mobile.

==================================================
UI/UX REQUIREMENTS
==================================================

Do not redesign the entire project.

Maintain the existing Vexon visual style.

Keep:

- Existing color system
- Existing glassmorphism style
- Existing cards
- Existing navigation style
- Existing typography
- Existing buttons
- Existing spacing conventions
- Existing responsive behavior

For missing screens, design them so they look like they belong to the current Vexon application.

Every new page must have:

- Loading state
- Empty state
- Error state
- Success feedback
- Proper validation
- Responsive layout
- Accessible controls

Do not create generic ugly CRUD tables everywhere.

Use appropriate cards, tabs, charts, modals, drawers and mobile layouts where the existing design supports them.

==================================================
DATA REQUIREMENTS
==================================================

Do NOT use fake/mock data in production functionality.

Use:

Frontend
→ Existing API
→ Backend
→ MongoDB

If test data is needed for development, keep it clearly separated from production logic.

Do not hard-code analytics.

Do not hard-code users.

Do not hard-code attendance.

Do not hard-code timetable.

Do not hard-code gate passes.

Do not hard-code chat messages.

==================================================
SECURITY REQUIREMENTS
==================================================

Maintain and improve the existing security implementation.

Use:

- JWT
- bcrypt.js
- RBAC
- Backend authorization
- Input validation
- Rate limiting
- CORS
- Helmet if already present
- NoSQL/operator injection protection
- Secure file upload validation
- File size/type restrictions
- Secure authentication flows
- Audit logging where already supported
- Secure Socket.IO authentication
- Authorization for Socket.IO rooms/events

Do not trust user IDs, roles, or permissions supplied by the frontend.

Every protected API must verify the authenticated user.

Every protected Socket.IO event must verify authentication and authorization.

==================================================
SOCKET.IO SECURITY
==================================================

Do not allow users to simply join arbitrary rooms.

Verify:

- User identity
- Conversation membership
- Role
- Permission
- Resource ownership/access

before allowing private Socket.IO communication.

Never broadcast private messages or private student information to unauthorized users.

==================================================
API QUALITY
==================================================

Before creating a new endpoint:

1. Check whether the endpoint already exists.
2. Reuse it if it is correct.
3. Fix it if it is incomplete.
4. Only create a new endpoint if necessary.

Do not create duplicate APIs.

Keep existing API naming conventions.

Keep existing response formats where possible.

Do not break existing frontend calls.

==================================================
DATABASE
==================================================

Continue using MongoDB + Mongoose.

Before creating a new model:

1. Check whether a suitable model already exists.
2. Reuse existing schemas where possible.
3. Extend existing schemas carefully.
4. Avoid duplicate collections/models.

Use appropriate indexes for frequently queried fields.

Use aggregation for analytics.

Maintain data consistency.

==================================================
IMPORTANT IMPLEMENTATION RULE
==================================================

Do not implement everything blindly in one huge rewrite.

Work feature by feature.

Recommended order:

1. Inspect repository
2. Fix/complete authentication/security
3. Complete Chat
4. Complete Attendance
5. Complete Timetable
6. Complete Gate Pass
7. Complete Lost & Found
8. Complete Advanced Analytics
9. Verify Socket.IO real-time synchronization
10. Build React Native + Expo Android app
11. Connect Android to existing APIs
12. Connect Android to Socket.IO
13. Test Web ↔ Android synchronization
14. Fix UI/UX issues
15. Run final security checks
16. Run build/tests

==================================================
TESTING
==================================================

After implementing each feature:

- Test backend endpoints
- Test frontend integration
- Test authorization
- Test invalid input
- Test loading states
- Test empty states
- Test errors
- Test real-time updates
- Test multiple users where applicable

For Socket.IO:

Test at least:

Browser → Browser
Browser → Android
Android → Browser

For example:

1. Login User A on browser.
2. Login User B on Android.
3. User A sends a chat message.
4. Verify User B receives it immediately.
5. Verify MongoDB contains the message.
6. Refresh both applications.
7. Verify message history is still correct.

Repeat similar tests for relevant real-time features.

==================================================
ANDROID BUILD
==================================================

Configure the React Native/Expo application so it can produce an Android build.

The final goal is:

Vexon Android APK

The APK must connect to the deployed/backend server rather than localhost when used on a physical device.

Do not hard-code localhost as the production API URL.

Use an environment/configuration approach consistent with the existing project.

==================================================
FINAL REQUIREMENT
==================================================

At the end, provide a concise implementation report containing:

1. Features already present before changes
2. Features completed
3. Features fixed
4. Backend changes
5. Frontend changes
6. Socket.IO changes
7. Android application changes
8. Database/model changes
9. Security improvements
10. Remaining issues, if any
11. Commands required to run web
12. Commands required to run backend
13. Commands required to run Android
14. Command/process used to generate APK

IMPORTANT:

Do not claim something is completed if it is not actually working.

Do not hide build errors.

Do not replace working code unnecessarily.

Do not remove existing features.

Do not create unrelated features.

Do not add features outside the Vexon scope.

The goal is to take the CURRENT Vexon project and turn it into a complete, working web + Android college community platform while preserving the existing implementation.