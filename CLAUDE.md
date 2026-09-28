# VEXON/JNN — FIX USER CREATION AND ACADEMIC ASSIGNMENT SYSTEM

I need you to fix the existing user creation and academic-scope architecture.

This is NOT just a UI change.

The problem is that user creation currently does not properly store **which year and section a faculty member handles**, and the Timetable currently filters by Department + Section + Semester without showing/using Year.

The academic assignment must become a shared source of truth and must correctly reflect across:

* People
* Attendance
* Chat
* Timetable
* Study Materials
* Marks/Examinations

Do NOT rewrite the application.

First inspect the existing repository and understand the current User model, Department/Program/Section models, Timetable model, Attendance model, Chat logic, Study Materials scope logic, and existing RBAC.

Reuse existing models and relationships wherever possible.

---

# 1. CORE ACADEMIC STRUCTURE

The canonical class identity should be:

```text
Department
+ Program/Course
+ Academic Year
+ Section
+ Semester
```

Example:

```text
CSE
Cyber Security
3rd Year
Section A
Semester 5
```

Do not identify a class only by:

```text
Department + Section
```

because Section A can exist in multiple years.

---

# 2. USER CREATION — FACULTY

Update the Create Login/User Creation form.

When role = Faculty, show:

```text
FULL NAME
EMPLOYEE ID
DEPARTMENT
YEAR(S) HANDLING
SECTION(S) HANDLING
COLLEGE EMAIL
MOBILE
PASSWORD
```

The current screenshot has Department and Section, but it does not properly capture Year Handling.

Add:

### Year Handling

Options:

```text
1st Year
2nd Year
3rd Year
4th Year
```

This must support MULTIPLE selections.

Example:

```text
Year(s) Handling
☑ 2nd Year
☑ 3rd Year
```

Do not assume a faculty member handles only one year.

---

# 3. SECTION HANDLING

Section handling must also support multiple assignments.

Example:

```text
Section(s) Handling

☑ A
☑ B
```

However, do NOT create ambiguous global section permissions.

The actual faculty teaching assignment must preserve the relationship:

```text
Department
+
Program
+
Year
+
Section
+
Semester
+
Subject
```

Example:

```text
Faculty:
Dr. Ravi

Assignments:

CSE
Cyber Security
2nd Year
Section A

CSE
Cyber Security
3rd Year
Section A

CSE
Cyber Security
3rd Year
Section B
```

If the existing system already has a timetable/teaching-assignment model, reuse it rather than duplicating assignments in the User document.

---

# 4. IMPORTANT — DO NOT STORE ONLY LOOSE STRINGS

Do NOT solve this by simply adding:

```js
year: "3rd Year",
section: "A"
```

and then separately maintaining unrelated values in other modules.

Academic relationships must have a canonical representation.

Prefer references/IDs where the existing schema supports them:

```text
departmentId
programId
year
sectionId
semester
facultyId
subjectId
```

MongoDB supports reference-based relationships for normalized data and recommends considering references when related entities are queried independently or relationships become complex.

---

# 5. STUDENT USER CREATION

When creating a Student, require:

```text
Department
Program/Course
Year
Section
Semester
```

Example:

```text
Department:
CSE (Cyber Security)

Program:
Cyber Security

Year:
3rd Year

Section:
A

Semester:
5th Semester
```

A student belongs to exactly one active academic class assignment at a time.

Do not allow a student to manipulate their academic scope from the frontend.

The backend must derive academic identity from the authenticated user record.

---

# 6. FACULTY VS STUDENT

Do NOT treat faculty and student academic assignments identically.

### Student

One active placement:

```text
Department
Program
Year
Section
Semester
```

### Faculty

Can have multiple teaching assignments:

```text
Faculty
   ↓
Teaching Assignments
   ├── Year 2 / Section A / Subject X
   ├── Year 3 / Section A / Subject Y
   └── Year 3 / Section B / Subject Y
```

The subject-specific assignment should remain the authoritative permission for:

* Attendance
* Marks
* Study Material upload/edit
* Timetable teaching assignment

---

# 7. TIMETABLE UI — FIX CURRENT ISSUE

The current Timetable filter is:

```text
Department
Section
Semester
```

Change it to:

```text
Department
Year
Section
Semester
```

UI:

```text
┌───────────────────────────────────────────────────────────┐
│ Department │ Year │ Section │ Semester │ View Class       │
└───────────────────────────────────────────────────────────┘
```

Example:

```text
Department:
CSE (Cyber Security)

Year:
3rd Year

Section:
A

Semester:
5th Semester

[ View Class ]
```

Do not display a timetable without Year in its class context.

---

# 8. TIMETABLE DATA MODEL

Every timetable entry must be associated with:

```text
departmentId
programId
year
sectionId
semester
weekday
period
startTime
endTime
subjectId
facultyId
room
```

Example:

```text
{
  departmentId: "...",
  programId: "...",
  year: 3,
  sectionId: "...",
  semester: 5,
  weekday: "Monday",
  period: 1,
  subjectId: "...",
  facultyId: "...",
  room: "AAB-204"
}
```

Use the existing model structure where possible.

Do not duplicate unnecessary department/section data if the existing database already has references.

---

# 9. TIMETABLE FILTERING

The backend must filter using:

```text
departmentId
+
year
+
sectionId
+
semester
```

Not only:

```text
departmentId + sectionId
```

Example:

```text
GET timetable

department = CSE
year = 3
section = A
semester = 5
```

must return only:

```text
CSE → 3rd Year → Section A → Semester 5
```

It must not return:

```text
CSE → 1st Year → Section A
CSE → 2nd Year → Section A
CSE → 4th Year → Section A
```

---

# 10. FACULTY TIMETABLE

A faculty member should see the timetable entries assigned to their authenticated `facultyId`.

Example:

```text
My Teaching Timetable

Monday

8:30 - 9:15
Artificial Intelligence
3rd Year
Section A
CSE Cyber Security

9:15 - 10:00
Computer Networks
2nd Year
Section B
CSE Cyber Security
```

The faculty timetable must show:

```text
Year
Section
Semester
Subject
Department
Program
Room
Day
Period
Time
```

---

# 11. PEOPLE MODULE

Update People filtering.

### Student

Student appears under:

```text
Department
Program
Year
Section
```

### Faculty

Faculty should be visible according to their actual authorized academic assignments.

For example:

```text
Faculty X

Teaching:
CSE
2nd Year
Section A

CSE
3rd Year
Section A
```

Do not expose faculty to unrelated students/classes merely because the faculty belongs to the same department.

Use the existing RBAC rules and academic scope logic.

---

# 12. ATTENDANCE

Attendance MUST use the same canonical class identity.

An attendance session must identify:

```text
departmentId
programId
year
sectionId
semester
subjectId
facultyId
timetableId
date
period
```

Example:

```text
CSE
Cyber Security
3rd Year
Section A
Semester 5
Computer Networks
Faculty X
Monday Period 2
```

The faculty must only be allowed to take attendance if they are actually assigned to that:

```text
subject + class
```

Do not authorize attendance merely because:

```text
faculty.departmentId === class.departmentId
```

---

# 13. ATTENDANCE FILTERS

Update attendance screens so that class selection contains:

```text
Department
Year
Section
Semester
Subject
```

Example:

```text
Department:
CSE

Year:
3rd Year

Section:
A

Semester:
5

Subject:
Computer Networks
```

Attendance must never accidentally combine students from:

```text
2nd Year Section A
```

with:

```text
3rd Year Section A
```

---

# 14. CHAT

Review the existing chat user/class/section filtering.

Academic scope must not leak into chat incorrectly.

If the current chat supports class/section groups, groups should identify:

```text
Department
Program
Year
Section
Semester
```

Example:

```text
CSE Cyber Security
3rd Year
Section A
Semester 5
```

A student in:

```text
3rd Year Section A
```

must not automatically appear in or access:

```text
2nd Year Section A
```

just because the section name is the same.

Faculty class/group access must be based on actual teaching assignment.

---

# 15. STUDY MATERIALS

Study Materials already use academic scope.

Ensure the same canonical scope is used:

```text
Department
Program
Year
Semester
Section
Subject
```

Faculty upload/edit permission remains:

```text
Faculty must currently teach that subject/class.
```

The new User Creation assignment must integrate with the existing Study Materials authorization.

Do NOT create a second permission system.

---

# 16. MARKS / EXAMINATION MODULE

The Marks module should also use:

```text
Department
Program
Year
Section
Semester
Subject
Exam
Faculty
```

Exam types:

```text
Internal Assessment Test 1
Internal Assessment Test 2
Model Examination
Semester Examination
```

Subject-handling faculty can enter marks only for their assigned:

```text
Subject + Year + Section + Semester
```

The Exam Cell can manage college-wide examination/marks administration.

HOD access remains department-scoped.

Admin remains college-wide according to existing RBAC.

---

# 17. SECTION/YEAR CONSISTENCY

Do not allow invalid combinations.

Example:

If:

```text
Department = CSE
Year = 3rd
```

the Section dropdown should show only valid sections configured for that academic class.

Do not allow:

```text
Department CSE
Year 3
Section Z
```

if Section Z does not exist.

---

# 18. SEMESTER CONSISTENCY

Do not blindly infer semester from year unless the existing application already has a defined rule.

Inspect the existing academic-year/semester implementation first.

If the application uses:

```text
1st Year → Semester 1/2
2nd Year → Semester 3/4
3rd Year → Semester 5/6
4th Year → Semester 7/8
```

enforce that relationship consistently.

If the existing college configuration supports a different academic structure, use the existing configuration rather than hardcoding assumptions.

---

# 19. BACKEND SECURITY

The frontend must never be trusted for:

```text
facultyId
studentId
departmentId
year
sectionId
semester
```

The backend must derive the authenticated user's identity and validate their academic scope.

For faculty:

```text
authenticated facultyId
        ↓
teaching assignment
        ↓
authorized class/subject
```

For student:

```text
authenticated studentId
        ↓
active academic placement
        ↓
authorized class
```

---

# 20. EXISTING DATA MIGRATION

This is extremely important.

There may already be users, timetable entries, attendance records, chat groups, and study materials without the new Year field.

Do NOT simply break old records.

Inspect existing data.

Create a safe migration/backfill strategy.

Before changing existing records:

1. Identify records missing Year.
2. Determine whether Year can be safely derived from existing data.
3. If it cannot be determined safely, flag the record for admin correction.
4. Do not guess academic year.
5. Preserve historical attendance and timetable data.

---

# 21. HISTORICAL ATTENDANCE

Do NOT rewrite historical attendance simply because a student's current Year/Section changes.

Historical attendance must preserve the class context that existed when the attendance session was created.

For example:

```text
Attendance Session
Year: 3
Section: A
Semester: 5
Date: ...
```

must remain unchanged even if the student later moves to another academic year.

---

# 22. UI REQUIREMENTS

Update the Create User form.

For Faculty:

```text
FULL NAME
EMPLOYEE ID

DEPARTMENT
PROGRAM

YEAR(S) HANDLING
[ 1st Year ] [ 2nd Year ] [ 3rd Year ] [ 4th Year ]

SECTION(S) HANDLING
[ A ] [ B ] [ C ]

COLLEGE EMAIL
MOBILE
PASSWORD
```

Prefer a clean multi-select/dropdown UI rather than four large buttons.

For Student:

```text
FULL NAME
STUDENT ID

DEPARTMENT
PROGRAM
YEAR
SECTION
SEMESTER

COLLEGE EMAIL
MOBILE
PASSWORD
```

Keep the existing premium/glassmorphism design.

---

# 23. VALIDATION

Backend validation must reject:

* missing Year
* invalid Year
* invalid Section
* invalid Semester
* invalid Department/Program relationship
* faculty assignment outside allowed academic structure
* duplicate assignment
* unauthorized academic scope

Return clear validation errors.

---

# 24. INDEXES

Review MongoDB indexes for the new query patterns.

Common queries will be:

```text
departmentId + year + sectionId + semester
```

and:

```text
facultyId + year + sectionId + semester
```

and:

```text
studentId
```

and:

```text
subjectId + year + sectionId + semester
```

Add appropriate compound indexes after inspecting the existing indexes.

MongoDB recommends creating indexes around common query patterns and considering workload when designing the schema.

---

# 25. IMPORTANT — SINGLE SOURCE OF TRUTH

Do not independently maintain academic scope in:

```text
People
Attendance
Chat
Timetable
Study Materials
Marks
```

They must all use the same underlying academic relationships.

Conceptually:

```text
                    ACADEMIC STRUCTURE
                           │
             ┌─────────────┼─────────────┐
             │             │             │
          Student       Faculty       Teaching
          Placement     Account       Assignment
             │             │             │
             └─────────────┼─────────────┘
                           │
                           ▼
                 Department + Program
                 + Year + Section
                 + Semester
                           │
       ┌──────────┬────────┼────────┬──────────┐
       ▼          ▼        ▼        ▼          ▼
    People    Timetable Attendance Chat   Study Materials
                                             │
                                             ▼
                                           Marks
```

This is the most important architectural requirement.

---

# 26. TESTING

Add/update tests for:

### User Creation

* Student requires Year
* Student requires Section
* Student requires Semester
* Faculty can have multiple years
* Faculty can have multiple sections
* Faculty assignments are stored correctly
* invalid combinations rejected

### Timetable

* Year appears in UI
* Department + Year + Section + Semester filters correctly
* 3rd Year Section A does not show 2nd Year Section A
* Faculty sees only assigned timetable entries

### Attendance

* Correct Year/Section students appear
* faculty cannot take attendance for another class
* same section name across different years remains separated

### People

* correct students appear under correct academic scope
* faculty assignment visibility works

### Chat

* class chat respects Year + Section + Semester
* unauthorized class access returns 403

### Study Materials

* material access respects Year + Section + Semester
* faculty assignment remains authoritative

### Marks

* faculty can enter marks only for assigned subject/class
* Exam Cell has appropriate college-wide examination access
* HOD remains department-scoped

### Security

Test ID tampering:

```text
studentId
departmentId
year
sectionId
semester
facultyId
```

The backend must ignore/reject unauthorized values.

---

# 27. DO NOT BREAK EXISTING FEATURES

Before finishing, verify:

* Authentication
* RBAC
* People
* Timetable
* Attendance
* Chat
* Study Materials
* Complaints
* Gate Pass
* Marks
* Exam Cell
* Notifications
* Mobile navigation
* Web navigation

Run all existing server tests.

Run web production build.

Run mobile Android build/export.

---

# 28. FINAL ACCEPTANCE CRITERIA

The implementation is complete only when:

* [ ] Faculty creation has Year(s) Handling.
* [ ] Faculty creation has Section(s) Handling.
* [ ] Multiple faculty assignments are supported.
* [ ] Student creation has Year.
* [ ] Student creation has Section.
* [ ] Student creation has Semester.
* [ ] Timetable displays Department + Year + Section + Semester.
* [ ] Timetable backend filters by Year.
* [ ] Attendance uses Year + Section + Semester.
* [ ] People respects Year + Section.
* [ ] Chat respects Year + Section + Semester.
* [ ] Study Materials respects the same academic scope.
* [ ] Marks respects the same academic scope.
* [ ] Faculty permissions are based on actual teaching assignments.
* [ ] No frontend-supplied academic ID can bypass authorization.
* [ ] Historical attendance is preserved.
* [ ] Existing functionality is not broken.
* [ ] Tests pass.
* [ ] Web build passes.
* [ ] Mobile build passes.

Before making large changes, inspect the repository and report:

1. Current user schema
2. Current timetable schema
3. Current attendance schema
4. Current chat scope
5. Current Study Material scope
6. Current marks schema
7. Existing Department/Program/Section models
8. Exact files that need modification
9. Whether a migration is required

Then implement the changes using the existing architecture rather than creating duplicate systems.
