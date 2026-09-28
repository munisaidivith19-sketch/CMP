VEXON — LINK TIMETABLE AND ATTENDANCE WITH PERIOD-BASED TIME CONTROL

Modify the existing Vexon project.

IMPORTANT:
Do not replace the existing technology stack.
Do not rewrite unrelated modules.
Do not break the existing Timetable or Attendance functionality.

The goal is to make Timetable the source of truth for class schedule while keeping historical attendance records immutable and accurate.

==================================================
1. CORE ARCHITECTURE
==================================================

The Attendance module must be linked to the existing Timetable module.

Timetable determines:

- Department
- Program/Course
- Academic Year
- Section
- Semester
- Weekday
- Period number
- Start time
- End time
- Subject
- Subject code
- Faculty

Attendance must use this timetable information when creating an attendance session.

Do NOT maintain a separate manually configured timetable inside Attendance.

Relationship:

Timetable
    ↓
Attendance Session
    ↓
Student Attendance Records

==================================================
2. EXACT CLASS IDENTITY
==================================================

Attendance must always be associated with the exact:

- Department
- Program/Course
- Academic Year
- Section
- Semester
- Timetable entry
- Period
- Date

Example:

CSE
Cyber Security
3rd Year
Section A
Semester 1
Monday
Period 1

must not be mixed with:

CSE
Cyber Security
3rd Year
Section B

or:

CSE
AI & DS
3rd Year
Section A

or another department.

Reuse the existing project models and IDs.

Do not create duplicate academic models.

==================================================
3. TIMETABLE IS THE SCHEDULE SOURCE
==================================================

When a timetable entry is changed by an authorized HOD/Admin, future attendance must automatically use the updated timetable information.

Example:

Old timetable:

Monday
Period 1
09:00 - 09:50
Network Security
CS301
Dr. Ravi

Changed to:

Monday
Period 1
09:10 - 10:00
Network Security
CS301
Dr. Ravi

Future attendance must use:

09:10 - 10:00

Do not require the user to manually update Attendance separately.

==================================================
4. DO NOT MODIFY HISTORICAL ATTENDANCE
==================================================

This is extremely important.

When attendance is taken, save a snapshot of the timetable information used for that attendance session.

Attendance should retain:

- timetableId
- date
- periodNumber
- startTimeSnapshot
- endTimeSnapshot
- subjectId where available
- subjectNameSnapshot
- subjectCodeSnapshot
- facultyId
- facultyNameSnapshot where appropriate
- departmentId
- programId
- year
- sectionId
- semester

If the timetable is changed later, historical attendance must NOT change.

Example:

September 28 attendance:

09:00 - 09:50
Network Security
Dr. Ravi

Later timetable becomes:

09:10 - 10:00

September 28 attendance must still remain:

09:00 - 09:50

Do not rewrite historical attendance when timetable data changes.

==================================================
5. FACULTY ATTENDANCE TIME RESTRICTION
==================================================

A faculty member can take attendance only while their assigned timetable period is active.

Example timetable:

Period 1
09:00 - 09:50

Faculty attendance availability:

08:59
NOT AVAILABLE

09:00
AVAILABLE

09:25
AVAILABLE

09:49
AVAILABLE

09:50
CLOSED

09:51
CLOSED

The backend must perform this validation.

Use the server-side current time.

Do not trust a start/end time sent by the frontend.

==================================================
6. FACULTY CAN ONLY TAKE ATTENDANCE FOR ASSIGNED CLASS
==================================================

The authenticated faculty member must match the timetable's facultyId.

The backend must verify:

authenticatedFacultyId
    ===
timetable.facultyId

The faculty must also belong to the correct timetable entry/class context.

A faculty member must not be able to manipulate an API request and take attendance for another faculty member's class.

==================================================
7. FACULTY ATTENDANCE UI
==================================================

The Faculty Attendance screen should show today's currently available timetable periods.

Example:

MY CLASSES

09:00 AM - 09:50 AM
Network Security
CS301
CSE
Cyber Security
3rd Year
Section A

[ TAKE ATTENDANCE ]

After the period ends:

09:00 AM - 09:50 AM
Network Security
CS301

PERIOD COMPLETED

[ ATTENDANCE CLOSED ]

Do not allow the faculty to reopen it from the frontend.

==================================================
8. CURRENT PERIOD CALCULATION
==================================================

The backend must determine:

- Current date
- Current server time
- Current weekday
- Faculty
- Timetable entry
- Start time
- End time

Then determine whether the period is:

UPCOMING
ACTIVE
COMPLETED

Example:

Before start:
UPCOMING

During:
ACTIVE

After end:
COMPLETED

Faculty can take attendance only when:

status === ACTIVE

==================================================
9. HOD ATTENDANCE EDIT RULE
==================================================

HOD can edit attendance only for the CURRENT DATE.

If today is:

28 September 2026

HOD can edit:

28 September 2026

HOD cannot edit:

27 September 2026
26 September 2026
25 September 2026

etc.

This must be enforced on the backend.

Do not rely only on disabling the Edit button.

If HOD directly calls the attendance update API for a previous date, return:

403 Forbidden

or the project's existing authorization response.

==================================================
10. ADMIN ATTENDANCE EDIT RULE
==================================================

Admin has NO date/time restriction for editing attendance.

Admin can edit attendance for:

- Today
- Yesterday
- Previous dates
- Previous weeks
- Previous months
- Previous semesters

subject to the existing admin authorization rules.

Do not apply the HOD date restriction to Admin.

==================================================
11. ATTENDANCE PERMISSION MATRIX
==================================================

Maintain this behavior:

Faculty:
- Can take attendance only for their assigned active timetable period.
- Cannot take attendance after the period ends.
- Cannot take attendance for another faculty's class.
- Cannot bypass time restriction through API.

HOD:
- Can manage attendance according to existing HOD permissions.
- Can edit attendance only for today's date.
- Cannot edit previous dates.

Admin:
- Can manage attendance according to existing Admin permissions.
- Can edit attendance for any date.
- No date-based editing restriction.

Student:
- Can view their attendance only.
- Cannot modify attendance.

==================================================
12. TIMETABLE EDITING
==================================================

Only:

HOD
Admin

can edit timetable.

HOD:
- Own department only.

Admin:
- Entire college.

Timetable editing includes:

- Period number
- Start time
- End time
- Subject
- Subject code
- Faculty
- Room
- Department
- Program
- Year
- Section
- Day

Use the existing timetable permission system.

==================================================
13. ADD EDIT OPTION TO TIMETABLE
==================================================

In HOD and Admin Timetable management, each period should have:

[EDIT]
[DELETE]

The Edit Period modal should allow changing:

- Subject
- Subject code
- Faculty
- Day
- Period
- Start time
- End time
- Room

Validate all changes.

Do not allow overlapping periods for the same class.

Do not allow the same faculty to be assigned to overlapping periods unless the existing application explicitly supports shared classes.

==================================================
14. TIMETABLE CHANGE → FUTURE ATTENDANCE
==================================================

If HOD/Admin changes:

Subject
Faculty
Period
Start time
End time
Day
Department
Program
Year
Section

future attendance must use the new timetable.

Do not require manually changing Attendance.

However, attendance sessions that already occurred must preserve their original snapshot.

==================================================
15. ATTENDANCE SESSION SNAPSHOT
==================================================

When a faculty starts attendance for a timetable period, create/record an attendance session containing:

- timetableId
- attendanceDate
- periodNumber
- startTimeSnapshot
- endTimeSnapshot
- subjectId
- subjectNameSnapshot
- subjectCodeSnapshot
- facultyId
- departmentId
- programId
- year
- sectionId
- semester
- createdAt

This protects historical records from future timetable changes.

==================================================
16. IMPORTANT EDGE CASE
==================================================

If a timetable is edited while an attendance session is already active:

Do not silently change the active attendance session.

The attendance session should retain the timetable snapshot that was used when the attendance session was created.

The timetable change should affect future attendance sessions.

==================================================
17. ATTENDANCE DATE VALIDATION
==================================================

For HOD edit operations:

Only allow:

attendanceDate === today's date

Use the application's configured timezone.

Do not compare dates incorrectly using UTC if the application is intended to operate in the college's local timezone.

Normalize the date consistently on the backend.

==================================================
18. API SECURITY
==================================================

Inspect all existing attendance APIs.

Do not rely only on frontend restrictions.

Backend must enforce:

Faculty:
- Correct facultyId
- Correct timetableId
- Active period
- Correct date
- Correct class

HOD:
- Own department
- Today's date for editing

Admin:
- College-wide permissions
- No date restriction

Student:
- Read-only own attendance

Test direct API manipulation.

==================================================
19. DATABASE INDEXING
==================================================

Inspect the existing Attendance and Timetable schemas.

Add appropriate indexes if missing.

Attendance should efficiently query by:

- studentId
- timetableId
- attendanceDate
- facultyId
- departmentId
- sectionId
- periodNumber

Timetable should efficiently query by:

- departmentId
- programId
- year
- sectionId
- dayOfWeek
- periodNumber
- facultyId

Do not create unnecessary duplicate indexes.

==================================================
20. ATTENDANCE UI
==================================================

Attendance should display timetable information rather than asking faculty to manually enter:

- Subject
- Period
- Start time
- End time
- Section

Example:

MONDAY — PERIOD 1

09:00 AM - 09:50 AM
Network Security
CS301
Cyber Security
3rd Year
Section A

[TAKE ATTENDANCE]

The faculty should select the timetable period rather than manually typing the schedule.

==================================================
21. HOD ATTENDANCE EDIT UI
==================================================

For HOD:

Today's attendance records can show:

[EDIT ATTENDANCE]

For previous dates:

[LOCKED]

Example:

TODAY
28 September 2026
[EDIT]

27 September 2026
LOCKED

26 September 2026
LOCKED

The backend must enforce the same rule.

==================================================
22. ADMIN ATTENDANCE EDIT UI
==================================================

Admin should have:

[EDIT ATTENDANCE]

for historical records as well.

There should be no date-based UI restriction for Admin.

==================================================
23. AUDIT LOGGING
==================================================

Every HOD/Admin attendance modification must be logged using the existing audit logging system.

Record:

- actorId
- actorRole
- attendanceId/sessionId
- date
- previous value
- new value
- action
- timestamp

Examples:

ATTENDANCE_EDITED

TIMETABLE_CHANGED

ATTENDANCE_SESSION_CREATED

==================================================
24. TESTING

Test the following.

TIMETABLE:

[ ] HOD can edit own department timetable.
[ ] HOD cannot edit another department.
[ ] Admin can edit all timetables.
[ ] Future attendance uses changed timetable.
[ ] Historical attendance remains unchanged.
[ ] Period overlaps are rejected.
[ ] Faculty conflicts are rejected.

FACULTY ATTENDANCE:

[ ] Faculty can take attendance during active period.
[ ] Faculty cannot take attendance before period.
[ ] Faculty cannot take attendance after period.
[ ] Faculty cannot take another faculty's attendance.
[ ] Direct API manipulation cannot bypass time restriction.

HOD:

[ ] HOD can edit today's attendance.
[ ] HOD cannot edit yesterday's attendance.
[ ] HOD cannot edit older attendance.
[ ] Direct API request for old attendance returns 403.
[ ] HOD can only edit attendance within authorized department.

ADMIN:

[ ] Admin can edit today's attendance.
[ ] Admin can edit yesterday's attendance.
[ ] Admin can edit older attendance.
[ ] Admin has no date-based edit restriction.

STUDENT:

[ ] Student can view only their own class/section attendance.
[ ] Student cannot modify attendance.

==================================================
25. FINAL EXPECTED FLOW

TIMETABLE:

HOD/Admin
    ↓
Create/Edit Timetable
    ↓
Department
Program
Year
Section
Day
Period
Start
End
Subject
Faculty
    ↓
Save

                ↓

ATTENDANCE:

Faculty Login
    ↓
Today's Timetable
    ↓
Find assigned active period
    ↓
Check current time
    ↓
If ACTIVE
    ↓
Allow Attendance

If COMPLETED
    ↓
Attendance Closed

                ↓

HOD:

Today's Attendance
    ↓
Can Edit

Previous Date
    ↓
Locked

                ↓

ADMIN:

Any Date
    ↓
Can Edit

==================================================
FINAL REQUIREMENT
==================================================

Make Timetable the source of truth for the current/future class schedule.

Link Attendance to the exact timetable entry.

Do NOT dynamically rewrite historical attendance when the timetable changes.

Faculty attendance must be time-controlled by the timetable's start/end time.

HOD can edit attendance only for the current date.

Admin has no date restriction for attendance editing.

All restrictions must be enforced by the backend, not just the frontend.

Reuse the existing Vexon models, authentication, RBAC, APIs, Socket.IO, notifications, audit logging, and UI components wherever possible.

Before coding, inspect the existing Timetable and Attendance implementation and adapt this design to the actual models and routes already present in the project.