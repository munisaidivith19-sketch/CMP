#!/usr/bin/env python3
"""
Validate the generated VEXON handbook PDFs.

    python validate_handbook.py

Checks, for every src/*.md:
  1. the matching PDF exists, is non-empty and opens (PyPDF2, else pdftotext);
  2. page count and pages with (almost) no text;
  3. every chapter/section heading in the Markdown appears in the PDF text;
  4. no secrets or personal data (patterns below) in the Markdown or the PDF text;
  5. every repository path / file name cited in `code` spans exists in the repository.

Writes VALIDATION_REPORT.md next to this script and exits 1 if anything failed.
"""
from __future__ import annotations

import datetime as _dt
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SKIP_DIRS = {"node_modules", ".git", "build", "dist", ".gradle", ".build", ".idea", "uploads"}

SECRET_PATTERNS = [
    ("MongoDB URI with credentials", re.compile(r"mongodb(?:\+srv)?://[^\s/:@]+:[^\s/@]+@")),
    ("Groq API key", re.compile(r"gsk_[A-Za-z0-9]{16,}")),
    ("AWS access key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("Private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("JWT-looking token", re.compile(r"eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}")),
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_-]{30,}")),
    ("Seed/demo password", re.compile(r"Password@123")),
    ("Personal email address", re.compile(r"[A-Za-z0-9._%+-]+@(?:gmail|yahoo|outlook|hotmail)\.com", re.I)),
    ("Indian mobile number", re.compile(r"(?<![\d.])(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)")),
]


# Files the guides name on purpose although they are NOT in the repository:
# either documented as absent (tsconfig.json) or created locally and never committed.
INTENTIONALLY_ABSENT = {
    "tsconfig.json": "documented as not existing (VEXON uses no TypeScript)",
    "google-services.json": "Firebase config created locally for push builds; never committed",
    "local.properties": "Android SDK path file created locally; git-ignored",
    "mobile-kotlin/local.properties": "Android SDK path file created locally; git-ignored",
}


def file_index():
    names, paths = set(), set()
    for root, dirs, files in os.walk(REPO):
        rel_root = os.path.relpath(root, REPO).replace("\\", "/")
        for d in dirs:
            if d in SKIP_DIRS:  # record that the folder exists, without walking inside it
                paths.add((d if rel_root == "." else f"{rel_root}/{d}") + "/")
                names.add(d + "/")
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        if rel_root != ".":
            paths.add(rel_root + "/")
            names.add(os.path.basename(root) + "/")
        for f in files:
            rel = f if rel_root == "." else f"{rel_root}/{f}"
            paths.add(rel)
            names.add(f)
    return names, paths


def pdf_text(path):
    """Return (pages, [text per page]) using PyPDF2 when available, else pdftotext."""
    try:
        from PyPDF2 import PdfReader  # type: ignore

        reader = PdfReader(path)
        texts = [(p.extract_text() or "") for p in reader.pages]
        return len(reader.pages), texts
    except ImportError:
        pass
    exe = shutil.which("pdftotext")
    if not exe:
        raise RuntimeError("Neither PyPDF2 nor pdftotext is available to read PDFs")
    out = subprocess.run([exe, "-layout", path, "-"], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    pages = out.split("\f")
    if pages and not pages[-1].strip():
        pages = pages[:-1]
    return len(pages), pages


def norm(s):
    return re.sub(r"[^a-z0-9]+", "", s.lower())


PATH_RE = re.compile(r"`([^`\s]+)`")
FILE_EXT = re.compile(r"\.(js|jsx|mjs|kt|kts|swift|md|json|yaml|yml|toml|pdf|properties|xml|sh|ps1|bat|py|html|css)$")
TOP = ("server/", "client/", "mobile-kotlin/", "mobile-ios/", "mobile/", "docs/", "scripts/", ".github/", "core/", "screens/", "ui/", "nav/", "push/", "transport/", "pages/", "controllers/", "models/", "utils/", "services/", "middleware/", "config/", "routes/", "tests/", "app/", "seed/", "src/")


def cited_paths(md):
    out = set()
    for m in PATH_RE.finditer(md):
        tok = m.group(1).strip().rstrip(".,;:)")
        tok = re.sub(r":\d+$", "", tok)  # file:line citations (Guide 11 catalogue)
        if any(ch in tok for ch in "<>*{}$=(") or tok.startswith(("http", "/api", "/", "-", "--")):
            continue
        if re.fullmatch(r"\.[a-z]+", tok):  # a bare extension such as `.js`, not a path
            continue
        if "/" in tok and (tok.startswith(TOP) or FILE_EXT.search(tok)):
            out.add(tok)
        elif FILE_EXT.search(tok) and re.fullmatch(r"[\w.-]+", tok):
            out.add(tok)
    return out


def path_exists(tok, names, paths):
    t = tok.rstrip("/")
    if tok in paths or t in paths or (t + "/") in paths:
        return True
    if "/" not in t:
        return t in names or (t + "/") in names
    # relative fragment such as models/User.js or core/Http.kt: match a suffix
    return any(p.endswith("/" + t) or p.endswith("/" + t + "/") or p == t for p in paths)


def main():
    names, paths = file_index()
    mds = sorted(f for f in os.listdir(SRC) if f.endswith(".md"))
    report, failed = [], False
    report.append("# Handbook validation report\n")
    report.append(f"Generated {_dt.datetime.now():%d %B %Y %H:%M} by `validate_handbook.py`.\n")
    report.append("| Guide | PDF size | Pages | Headings found | Near-empty pages | Secret / PII hits | Missing cited paths | Result |")
    report.append("|---|---|---|---|---|---|---|---|")
    details = []
    for md_name in mds:
        base = os.path.splitext(md_name)[0]
        md = open(os.path.join(SRC, md_name), encoding="utf-8").read()
        pdf = os.path.join(HERE, base + ".pdf")
        problems = []
        if not os.path.exists(pdf) or os.path.getsize(pdf) == 0:
            report.append(f"| {base} | missing | - | - | - | - | - | FAIL |")
            failed = True
            continue
        size_kb = os.path.getsize(pdf) / 1024
        try:
            n_pages, texts = pdf_text(pdf)
        except Exception as exc:  # noqa: BLE001
            report.append(f"| {base} | {size_kb:.0f} KB | unreadable | - | - | - | - | FAIL |")
            details.append(f"- **{base}**: could not open PDF: {exc}")
            failed = True
            continue
        full = norm(" ".join(texts))
        headings = [re.sub(r"[`*]", "", h).strip() for h in re.findall(r"^#{1,2}\s+(.+)$", md, re.M)]
        missing_h = [h for h in headings if norm(h) not in full]
        empty = [i + 1 for i, t in enumerate(texts) if len(t.strip()) < 40]
        hits = []
        for label, rx in SECRET_PATTERNS:
            for where, text in (("markdown", md), ("pdf", " ".join(texts))):
                for m in rx.finditer(text):
                    hits.append(f"{label} in {where}: `{m.group(0)[:12]}...`")
        cites = cited_paths(md)
        handbook_files = set(os.listdir(HERE))  # INDEX.md, PROJECT_STATUS.md live next to the PDFs
        absent_ok = sorted(c for c in cites if c in INTENTIONALLY_ABSENT)
        missing_p = sorted(
            c for c in cites if c not in INTENTIONALLY_ABSENT and c not in handbook_files and not path_exists(c, names, paths)
        )
        if absent_ok:
            details.append(f"- {base}: cited on purpose although not in the repository: " + "; ".join(f"`{c}` ({INTENTIONALLY_ABSENT[c]})" for c in absent_ok))
        ok = not missing_h and not hits and not missing_p and n_pages >= 3
        failed |= not ok
        report.append(
            f"| {base} | {size_kb:.0f} KB | {n_pages} | {len(headings) - len(missing_h)}/{len(headings)} | "
            f"{', '.join(map(str, empty)) or 'none'} | {len(hits)} | {len(missing_p)} of {len(cites)} | {'PASS' if ok else 'FAIL'} |"
        )
        if missing_h:
            details.append(f"- **{base}** headings not found in PDF text: " + "; ".join(missing_h))
        if hits:
            details.append(f"- **{base}** secret/PII pattern hits: " + "; ".join(sorted(set(hits))))
        if missing_p:
            details.append(f"- **{base}** cited paths not found in repository: " + ", ".join(f"`{p}`" for p in missing_p))
    report.append("")
    report.append("Near-empty pages are listed for review. Contents pages and handwritten-notes pages are expected to carry little text and do not fail validation.\n")
    report.append("## Details\n")
    report.extend(details or ["No problems found."])
    report.append("")
    with open(os.path.join(HERE, "VALIDATION_REPORT.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report))
    print("\n".join(report))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
