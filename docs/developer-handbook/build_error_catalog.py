#!/usr/bin/env python3
"""
Build Guide 11 (Error Messages and Troubleshooting) from two pieces:

  src/parts/11_error_guide_main.md   hand-written explanations (EDIT THIS)
  + an Appendix generated from the source code:
      - every `new ApiError(status, 'message')` in server/src
      - every `.withMessage('...')` form rule in server/src/routes
      - every rate-limit message in server/src/middleware/rateLimit.js

and writes src/11_Error_Messages_Troubleshooting_Guide.md (do not edit that file by
hand; it is regenerated). Then build the PDF as usual:

    python docs/developer-handbook/build_error_catalog.py
    python docs/developer-handbook/build_handbook.py 11
"""
from __future__ import annotations

import collections
import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SERVER = os.path.join(REPO, "server", "src")
MAIN = os.path.join(HERE, "src", "parts", "11_error_guide_main.md")
OUT = os.path.join(HERE, "src", "11_Error_Messages_Troubleshooting_Guide.md")

# A JS string literal ('...', "..." or `...`); named groups so it can be embedded anywhere.
STR = r"(?P<q>['\"`])(?P<msg>(?:\\.|(?!(?P=q)).)*)(?P=q)"
API_ERROR = re.compile(r"ApiError\(\s*(?P<status>\d{3})\s*,\s*" + STR, re.S)
WITH_MSG = re.compile(r"withMessage\(\s*" + STR, re.S)
LIMIT_MSG = re.compile(r"export const (?P<name>\w+)\s*=\s*rateLimit\(\{(?:(?!export const).)*?message:\s*json\(\s*" + STR, re.S)
SECTION = re.compile(r"//\s*──+\s*(.+?)\s*─")

MODULES = [
    ("Sign-in, sessions and accounts", ("authController", "accountController", "middleware/auth.js", "loginSecurity", "tokens.js", "sessionIdle")),
    ("Security checks", ("middleware/security.js", "coeGuard", "http.js")),
    ("Users, people and admin", ("userController", "adminController", "adminRoleAssignmentController", "peopleScope", "securityController")),
    ("Gate pass, OTP and return to campus", ("gatePass", "otp/", "OutpassOtp")),
    ("Attendance, OD and leave", ("attendance", "odLeave", "staffAttendance", "facultyPresence")),
    ("Staff early exit and period cover", ("staffController",)),
    ("Timetable, subjects and academic scope", ("timetable", "academicScope", "syncSubjects")),
    ("Exams", ("exam",)),
    ("Holidays and dates", ("holiday", "dates.js")),
    ("Study materials and AI assistant", ("studyMaterial", "services/ai/", "aiController")),
    ("Chat", ("chat",)),
    ("Complaints", ("complaint",)),
    ("SOS", ("sos",)),
    ("Bus tracking", ("transport",)),
    ("Announcements, clubs, events and discussions", ("announcement", "club", "eventController", "discussion", "reportController", "moderation")),
    ("Achievements", ("achievement",)),
    ("Lost and found", ("lostFound",)),
    ("Hostel, analytics, dashboard and search", ("hostel", "analytics", "dashboard", "search")),
    ("Notifications and push", ("notification", "push", "fcm", "devices")),
    ("Uploads and files", ("storage", "upload")),
    ("Alumni network and mentorship", ("alumni", "mentorship")),
]


def module_of(rel: str) -> str:
    for name, keys in MODULES:
        if any(k in rel for k in keys):
            return name
    return "Other"


def clean(msg: str) -> str:
    msg = " ".join(msg.split())
    msg = re.sub(r"\$\{[^}]*\}", "[value]", msg)       # template placeholders
    msg = msg.replace("\\'", "'").replace('\\"', '"')
    msg = msg.replace("|", "/").replace("`", "'").replace("*", "")
    return msg


def scan_api_errors():
    rows = collections.OrderedDict()
    for path in sorted(glob.glob(os.path.join(SERVER, "**", "*.js"), recursive=True)):
        rel = os.path.relpath(path, REPO).replace(os.sep, "/")
        text = open(path, encoding="utf-8").read()
        for m in API_ERROR.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            key = (module_of(rel), m.group("status"), clean(m.group("msg")))
            rows.setdefault(key, []).append(f"{rel.replace('server/src/', '')}:{line}")
    return rows


def scan_validation():
    rows = collections.OrderedDict()
    for path in sorted(glob.glob(os.path.join(SERVER, "routes", "*.js"))):
        rel = os.path.relpath(path, REPO).replace(os.sep, "/")
        lines = open(path, encoding="utf-8").read().split("\n")
        section = "General rules"
        for i, ln in enumerate(lines, 1):
            s = SECTION.search(ln)
            if s:
                section = s.group(1).strip()
            for m in WITH_MSG.finditer(ln):
                key = (section, clean(m.group("msg")))
                rows.setdefault(key, []).append(f"{os.path.basename(rel)}:{i}")
    return rows


def scan_limits():
    path = os.path.join(SERVER, "middleware", "rateLimit.js")
    text = open(path, encoding="utf-8").read()
    return [(m.group("name"), clean(m.group("msg"))) for m in LIMIT_MSG.finditer(text)]


def table(header, rows):
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out) + "\n"


def main():
    main_md = open(MAIN, encoding="utf-8").read().rstrip() + "\n"
    api = scan_api_errors()
    val = scan_validation()
    lim = scan_limits()

    parts = [main_md, "\n\\pagebreak\n", "# Appendix A: every server error message\n"]
    parts.append(
        f"Generated from the source code by `build_error_catalog.py`: **{len(api)} distinct messages**. "
        "`[value]` marks a part that changes (a number, a name, a time). The code column is the HTTP status; "
        "the meaning of each code is in \"Decode any error in 30 seconds\". Source is the file under `server/src/` and the line number.\n"
    )
    by_mod = collections.OrderedDict((name, []) for name, _ in MODULES)
    by_mod["Other"] = []
    for (mod, status, msg), where in api.items():
        src = ", ".join(where[:3]) + (f" (+{len(where) - 3})" if len(where) > 3 else "")
        by_mod[mod].append((status, msg, src))
    for mod, rows in by_mod.items():
        if not rows:
            continue
        rows.sort(key=lambda r: (r[0], r[1].lower()))
        parts.append(f"## {mod}\n")
        parts.append(table(["Code", "Message", "Source"], [[s, m, f"`{w}`"] for s, m, w in rows]))

    parts.append("\n# Appendix B: form validation messages\n")
    parts.append(
        f"These **{len(val)} messages** come from the request rules in `server/src/routes/` and always arrive with status **422**. "
        "They name the field to fix. Grouped by the section of the routes file they belong to.\n"
    )
    by_sec = collections.OrderedDict()
    for (sec, msg), where in val.items():
        by_sec.setdefault(sec, []).append((msg, ", ".join(where[:3]) + (f" (+{len(where) - 3})" if len(where) > 3 else "")))
    rows = []
    for sec, items in by_sec.items():
        for msg, where in items:
            rows.append([sec, msg, f"`{where}`"])
    parts.append(table(["Area", "Message", "Source"], rows))

    parts.append("\n# Appendix C: rate-limit messages (status 429)\n")
    parts.append("Sent by `server/src/middleware/rateLimit.js` when one address or user makes too many requests in a short time. The user only needs to wait.\n")
    parts.append(table(["Limiter", "Message"], [[f"`{n}`", m] for n, m in lim]))

    parts.append("\n# Source references\n")
    parts.append(
        "`server/src/utils/http.js` (ApiError) · `server/src/middleware/error.js` · `server/src/middleware/validate.js` · "
        "`server/src/middleware/rateLimit.js` · `server/src/routes/index.js` · `client/src/utils/format.js` · "
        "`client/src/pages/transport/myLocation.js` · `client/src/utils/returnLocation.js` · "
        "`mobile-kotlin/app/src/main/java/com/vexon/campus/core/Http.kt` · `docs/developer-handbook/build_error_catalog.py`\n"
    )
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))
    print(f"wrote {os.path.relpath(OUT, REPO)}: {len(api)} server messages, {len(val)} validation messages, {len(lim)} rate-limit messages")


if __name__ == "__main__":
    main()
