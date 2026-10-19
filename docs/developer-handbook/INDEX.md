# VEXON Developer Handbook — Index

A permanent learning and maintenance library for VEXON, generated on 16 October 2026 from a direct inspection of this repository. Every PDF is built from an editable Markdown source in [`src/`](src/) by [`build_handbook.py`](build_handbook.py) (Python + ReportLab), and checked by [`validate_handbook.py`](validate_handbook.py), which writes [`VALIDATION_REPORT.md`](VALIDATION_REPORT.md).

## Suggested reading order

1. **10 — Master Reference**: open this first; the map of everything.
2. **01 — Project Overview**: architecture, security model, apps.
3. **09 — 30-Day Workbook**: start Day 1 the same day; Days 1–8 assume Claude Code is still available (until 24 October 2026).
4. **02 — JavaScript / React** and **03 — Node / Express**: the two halves of the code you will read most.
5. **04 — Database**: data, backups, PostgreSQL plan.
6. **05 — Feature by Feature**: keep open while working on a module.
7. **06 — Debugging** and **07 — Testing, Git, Safe Changes**: before your first independent fix.
8. **08 — Deployment**: before touching production.
9. **11 — Error Messages**: keep it handy; look up any message a user reports (Ctrl+F in the PDF).

## The guides

| # | PDF | Source (edit this) | Purpose |
|---|---|---|---|
| 01 | [01_VEXON_Project_Overview.pdf](01_VEXON_Project_Overview.pdf) | [src/01_VEXON_Project_Overview.md](src/01_VEXON_Project_Overview.md) | What VEXON is; repository map; architecture and data-flow diagrams; how web, backend, database, sockets, Android and iOS fit together; dependencies; startup; glossary; self-check questions |
| 02 | [02_JavaScript_TypeScript_React_Guide.pdf](02_JavaScript_TypeScript_React_Guide.pdf) | [src/02_JavaScript_TypeScript_React_Guide.md](src/02_JavaScript_TypeScript_React_Guide.md) | JavaScript and React as used in `client/` (TypeScript status: not used); routing and guards; Redux Toolkit / RTK Query; forms; loading and error states; tracing a click to an API call; exercises |
| 03 | [03_Node_Express_Backend_Guide.pdf](03_Node_Express_Backend_Guide.pdf) | [src/03_Node_Express_Backend_Guide.md](src/03_Node_Express_Backend_Guide.md) | Startup and configuration; middleware chain; routes → controllers → services → models; status codes; auth; validation and errors; uploads; integrations; Socket.IO; tracing failed requests; adding an endpoint safely |
| 04 | [04_Database_MongoDB_PostgreSQL_Guide.pdf](04_Database_MongoDB_PostgreSQL_Guide.pdf) | [src/04_Database_MongoDB_PostgreSQL_Guide.md](src/04_Database_MongoDB_PostgreSQL_Guide.md) | MongoDB/Mongoose as implemented (59 models); CRUD and aggregation examples; indexes and TTLs; DB errors; backup and restore; safe inspection; PostgreSQL migration **plan** (not implemented) |
| 05 | [05_VEXON_Feature_By_Feature_Guide.pdf](05_VEXON_Feature_By_Feature_Guide.pdf) | [src/05_VEXON_Feature_By_Feature_Guide.md](src/05_VEXON_Feature_By_Feature_Guide.md) | Evidence-based module status table; per-module roles, files, routes, models, events, security rules, tests and gaps; workflow walkthroughs |
| 06 | [06_Debugging_and_Error_Recovery_Guide.pdf](06_Debugging_and_Error_Recovery_Guide.pdf) | [src/06_Debugging_and_Error_Recovery_Guide.md](src/06_Debugging_and_Error_Recovery_Guide.md) | Debugging loop; DevTools; status codes; stack traces; common errors; config, socket and Android problems; layer decision tree; evaluating AI fixes; troubleshooting table; checklist; incident template |
| 07 | [07_Testing_Git_and_Safe_Code_Changes.pdf](07_Testing_Git_and_Safe_Code_Changes.pdf) | [src/07_Testing_Git_and_Safe_Code_Changes.md](src/07_Testing_Git_and_Safe_Code_Changes.md) | Git habits and rollback; reviewing Claude Code changes; every test suite and **this audit's actual results**; writing regression tests; permission matrices; pre-release checklist |
| 08 | [08_Deployment_and_Production_Maintenance.pdf](08_Deployment_and_Production_Maintenance.pdf) | [src/08_Deployment_and_Production_Maintenance.md](src/08_Deployment_and_Production_Maintenance.md) | Local vs Render deployment (`render.yaml`); environment variable names; HTTPS/proxy/cookies; logs and health; backups; rollback; go-live security checks; VPS migration plan |
| 09 | [09_VEXON_30_Day_Learning_Workbook.pdf](09_VEXON_30_Day_Learning_Workbook.pdf) | [src/09_VEXON_30_Day_Learning_Workbook.md](src/09_VEXON_30_Day_Learning_Workbook.md) | 30-day plan; detailed Days 1–8 with "Ask Claude" tutor prompts; space for notes; self-assessment; final task; rubric |
| 11 | [11_Error_Messages_Troubleshooting_Guide.pdf](11_Error_Messages_Troubleshooting_Guide.pdf) | [src/parts/11_error_guide_main.md](src/parts/11_error_guide_main.md) (edit this) → generated [src/11_Error_Messages_Troubleshooting_Guide.md](src/11_Error_Messages_Troubleshooting_Guide.md) | What every error message means and what to do: status-code decoder; ~120 common messages by situation (sign-in, permissions, connection, forms, uploads, gate pass/OTP, attendance, exams, complaints, chat, bus/location, AI, Android) with user and developer actions; appendices listing **all** server messages, form-validation messages and rate-limit messages with file:line |
| 10 | [10_VEXON_Developer_Handbook.pdf](10_VEXON_Developer_Handbook.pdf) | [src/10_VEXON_Developer_Handbook.md](src/10_VEXON_Developer_Handbook.md) | Master reference: architecture summary, folder map, commands, config locations, entry points, decision tree, checklists, known issues |

## Other files in this folder

| File | What it is |
|---|---|
| [`build_handbook.py`](build_handbook.py) | Rebuilds every PDF: `python docs/developer-handbook/build_handbook.py` (or pass `03 06` to build only those). Needs Python 3 + `reportlab` |
| [`build_error_catalog.py`](build_error_catalog.py) | Regenerates Guide 11's source from `src/parts/11_error_guide_main.md` plus a catalogue scanned from the server code. Run it, then `build_handbook.py 11`, whenever error messages change |
| [`validate_handbook.py`](validate_handbook.py) | Re-checks every PDF (opens, page counts, headings present, no secrets/PII patterns, cited repository paths exist) |
| [`VALIDATION_REPORT.md`](VALIDATION_REPORT.md) | Output of the last validation run |
| [`PROJECT_STATUS.md`](PROJECT_STATUS.md) | What was inspected, documented, tested and left unverified during this audit |

## Keeping the handbook true

When the code changes, edit the matching `src/*.md`, rebuild, and re-validate. The validator fails if a guide cites a file that no longer exists — a cheap early warning that the documentation has drifted from the code.
