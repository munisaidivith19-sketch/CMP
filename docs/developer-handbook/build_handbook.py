#!/usr/bin/env python3
"""
VEXON Developer Handbook - PDF generator.

Turns the editable Markdown sources in ./src/*.md into A4 PDFs in this folder,
using ReportLab only (no network, no other dependency).

    python build_handbook.py              # build every guide
    python build_handbook.py 03 06        # build only guides whose file starts with 03 / 06

Supported Markdown subset (keep the sources inside it):

    ---                      front matter at the very top (title, subtitle, number, audience)
    # Chapter                -> TOC level 1, PDF bookmark
    ## Section               -> TOC level 2, PDF bookmark
    ### Sub-section
    paragraphs, **bold**, *italic*, `code`, [text](url)
    - bullets / 1. numbered (one nested level, 2-space indent), - [ ] checkboxes
    | pipe | tables |
    ```lang ... ```          code block (js, jsx, kotlin, swift, bash, json, text)
    ```flow ... ```          vertical flowchart: one box per line; a line "-> label" labels the next arrow
    ```layers ... ```        architecture rows: boxes separated by " | ", rows joined by arrows
    > [!WARNING] text        callouts: WARNING, KEY, MISTAKE, NOTE, EXERCISE, STATUS, TIP
    [[NOTES 6]]              six ruled lines for handwritten answers
    \\pagebreak              force a new page
"""
from __future__ import annotations

import datetime as _dt
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    XPreformatted,
)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
OUT = HERE
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

PAGE_W, PAGE_H = A4
MARGIN_L = MARGIN_R = 20 * mm
MARGIN_T = 22 * mm
MARGIN_B = 20 * mm
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R

# ── Palette ──────────────────────────────────────────────────────────────
INK = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
BRAND = colors.HexColor("#4338ca")
BRAND_DARK = colors.HexColor("#312e81")
BRAND_SOFT = colors.HexColor("#eef2ff")
RULE = colors.HexColor("#d1d5db")
CODE_BG = colors.HexColor("#f6f8fa")
CODE_BORDER = colors.HexColor("#d0d7de")

CALLOUTS = {
    "WARNING": ("Warning", colors.HexColor("#b91c1c"), colors.HexColor("#fef2f2")),
    "KEY": ("Key idea", colors.HexColor("#4338ca"), colors.HexColor("#eef2ff")),
    "MISTAKE": ("Common mistake", colors.HexColor("#b45309"), colors.HexColor("#fffbeb")),
    "NOTE": ("Note", colors.HexColor("#0369a1"), colors.HexColor("#f0f9ff")),
    "EXERCISE": ("Exercise", colors.HexColor("#047857"), colors.HexColor("#ecfdf5")),
    "STATUS": ("Evidence status", colors.HexColor("#6d28d9"), colors.HexColor("#f5f3ff")),
    "TIP": ("Tip", colors.HexColor("#0f766e"), colors.HexColor("#f0fdfa")),
}


# ── Fonts ────────────────────────────────────────────────────────────────
def _register_fonts():
    """Prefer a Unicode TTF family; fall back to ReportLab's bundled Vera, then core fonts."""
    import reportlab

    rl_fonts = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
    win = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    families = [
        ("Body", [os.path.join(win, f) for f in ("segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "segoeuiz.ttf")]),
        ("Body", [os.path.join(win, f) for f in ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf")]),
        ("Body", ["/usr/share/fonts/truetype/dejavu/" + f for f in ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf")]),
        ("Body", [os.path.join(rl_fonts, f) for f in ("Vera.ttf", "VeraBd.ttf", "VeraIt.ttf", "VeraBI.ttf")]),
    ]
    monos = [
        [os.path.join(win, f) for f in ("consola.ttf", "consolab.ttf")],
        ["/usr/share/fonts/truetype/dejavu/" + f for f in ("DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf")],
    ]
    body = None
    for _, files in families:
        if all(os.path.exists(f) for f in files):
            names = ("Body", "Body-Bold", "Body-Italic", "Body-BoldItalic")
            for n, f in zip(names, files):
                pdfmetrics.registerFont(TTFont(n, f))
            pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body-Italic", boldItalic="Body-BoldItalic")
            body = "Body"
            break
    mono = None
    for files in monos:
        if all(os.path.exists(f) for f in files):
            pdfmetrics.registerFont(TTFont("Mono", files[0]))
            pdfmetrics.registerFont(TTFont("Mono-Bold", files[1]))
            pdfmetrics.registerFontFamily("Mono", normal="Mono", bold="Mono-Bold", italic="Mono", boldItalic="Mono-Bold")
            mono = "Mono"
            break
    return (body or "Helvetica"), (mono or "Courier")


BODY, MONO = _register_fonts()
BODY_B = BODY + "-Bold" if BODY == "Body" else "Helvetica-Bold"
BODY_I = BODY + "-Italic" if BODY == "Body" else "Helvetica-Oblique"
MONO_B = MONO + "-Bold" if MONO == "Mono" else "Courier-Bold"

_FALLBACK_CHARS = {
    "\u2192": "->", "\u2190": "<-", "\u2194": "<->", "\u21d2": "=>", "\u2193": "v", "\u2191": "^",
    "\u2713": "[x]", "\u2714": "[x]", "\u2717": "[ ]", "\u2610": "[ ]", "\u2611": "[x]",
    "\u2265": ">=", "\u2264": "<=", "\u2260": "!=", "\u2248": "~", "\u00d7": "x",
    "\u2026": "...", "\u2022": "-", "\u2014": "-", "\u2013": "-", "\u2018": "'", "\u2019": "'",
    "\u201c": '"', "\u201d": '"', "\u2502": "|", "\u251c": "|", "\u2514": "`", "\u2500": "-",
}


def _glyphs(fontname):
    try:
        face = pdfmetrics.getFont(fontname).face
        return set(face.charToGlyph.keys())
    except Exception:  # core Type-1 font: Latin-1 only
        return set(range(256))


_BODY_GLYPHS = _glyphs(BODY)
_MONO_GLYPHS = _glyphs(MONO)


def safe_text(s: str, mono: bool = False) -> str:
    """Replace characters the chosen font cannot draw (no tofu boxes in the PDF)."""
    have = _MONO_GLYPHS if mono else _BODY_GLYPHS
    out = []
    for ch in s:
        if ord(ch) < 128 or ord(ch) in have:
            out.append(ch)
        else:
            out.append(_FALLBACK_CHARS.get(ch, "?"))
    return "".join(out)


# ── Styles ───────────────────────────────────────────────────────────────
def S(name, **kw):
    base = dict(fontName=BODY, bulletFontName=BODY, fontSize=10, leading=14.2, textColor=INK, spaceAfter=5)
    base.update(kw)
    return ParagraphStyle(name, **base)


ST = {
    "body": S("body"),
    # Headings are bound to what follows by bind_headings(), not keepWithNext:
    # keepWithNext would push a heading AND a long table to the next page together.
    "h1": S("H1", fontName=BODY_B, fontSize=19, leading=24, textColor=BRAND_DARK, spaceBefore=4, spaceAfter=10),
    "h2": S("H2", fontName=BODY_B, fontSize=14, leading=18, textColor=BRAND, spaceBefore=12, spaceAfter=6),
    "h3": S("H3", fontName=BODY_B, fontSize=11.5, leading=15, textColor=INK, spaceBefore=8, spaceAfter=4),
    "bullet": S("bullet", spaceAfter=2.5),
    "cell": S("cell", fontSize=8.6, leading=11.2, spaceAfter=0),
    "cellh": S("cellh", fontName=BODY_B, fontSize=8.6, leading=11.2, spaceAfter=0, textColor=colors.white),
    "callout": S("callout", fontSize=9.6, leading=13.4, spaceAfter=0),
    "calloutT": S("calloutT", fontName=BODY_B, fontSize=9.6, leading=13, spaceAfter=2),
    "code": ParagraphStyle("code", fontName=MONO, fontSize=7.9, leading=10.2, textColor=INK),
    "toc1": S("toc1", fontName=BODY_B, fontSize=10.5, leading=15, leftIndent=0, spaceAfter=1),
    "toc2": S("toc2", fontSize=9.4, leading=12.5, leftIndent=14, textColor=colors.HexColor("#374151"), spaceAfter=0),
    "small": S("small", fontSize=8.5, leading=11, textColor=MUTED),
}

# ── Inline Markdown → ReportLab paragraph markup ────────────────────────
_CODE_COLOR = "#9a3412"


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _wrap_code_span(raw: str, max_w: float, size: float) -> str:
    """Escape a code span; if it is wider than `max_w`, break it after '/' or ',' with <br/>.

    ReportLab only breaks lines at spaces, and any break character it accepts is drawn
    as a space, so long paths in narrow table cells are pre-broken here instead.
    """
    if not max_w or pdfmetrics.stringWidth(raw, MONO, size) <= max_w:
        return _esc(raw)
    lines, cur = [], ""
    for seg in re.split(r"(?<=[/,.\-])", raw):
        if cur and pdfmetrics.stringWidth(cur + seg, MONO, size) > max_w:
            lines.append(cur)
            cur = seg
        else:
            cur += seg
    lines.append(cur)
    return "<br/>".join(_esc(l) for l in lines)


def inline(md: str, max_code_w: float = 0, size: float = 10, code_color: str = _CODE_COLOR) -> str:
    """Markdown inline -> ReportLab markup. `max_code_w` pre-wraps long code paths (table cells)."""
    md = safe_text(md)
    spans = []

    def keep(markup):
        spans.append(markup)
        return f"\x00{len(spans) - 1}\x00"

    def code(m):
        txt = _wrap_code_span(safe_text(m.group(1), mono=True), max_code_w, size)
        return keep(f'<font face="{MONO}" color="{code_color}">{txt}</font>')

    # inline code first: its content is literal
    md = re.sub(r"`([^`]+)`", code, md)

    def link(m):
        text, url = m.group(1), m.group(2)
        if url.startswith("http://") or url.startswith("https://"):
            return keep(f'<a href="{_esc(url)}" color="#1d4ed8">{_esc(text)}</a>')
        if url == text:
            return keep(f'<font face="{MONO}" color="{_CODE_COLOR}">{_esc(text)}</font>')
        return keep(f'{_esc(text)} (<font face="{MONO}" color="{_CODE_COLOR}">{_esc(url)}</font>)')

    md = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, md)
    md = _esc(md)
    md = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", md)
    md = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", md)
    md = re.sub(r"\x00(\d+)\x00", lambda m: spans[int(m.group(1))], md)
    return md


# ── Code highlighting ───────────────────────────────────────────────────
KEYWORDS = {
    "js": "import export from default const let var function return if else for of in while async await new class extends try catch finally throw typeof instanceof true false null undefined switch case break continue",
    "kotlin": "package import fun val var class object data private public internal override suspend return if else when for while try catch finally throw true false null is in as companion enum sealed interface by lazy",
    "swift": "import struct class enum protocol func var let return if else guard for in while do try catch throw throws async await actor true false nil self init private public static",
    "bash": "cd npm node git export if then fi for do done echo cp mkdir python",
    "json": "true false null",
}
KEYWORDS["jsx"] = KEYWORDS["js"]
KEYWORDS["javascript"] = KEYWORDS["js"]
KEYWORDS["mjs"] = KEYWORDS["js"]
KEYWORDS["sh"] = KEYWORDS["bash"]
KEYWORDS["powershell"] = KEYWORDS["bash"]
KEYWORDS["kt"] = KEYWORDS["kotlin"]

_TOKEN = re.compile(
    r"(?P<comment>//[^\n]*|/\*.*?\*/|(?<![\w$])#(?![!{\[])[^\n]*)"
    r"|(?P<string>'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`)"
    r"|(?P<word>[A-Za-z_$][\w$]*)"
    r"|(?P<num>\b\d+(?:\.\d+)?\b)"
)


def highlight(code: str, lang: str) -> str:
    kws = set(KEYWORDS.get(lang, "").split())
    hash_comments = lang in ("bash", "sh", "powershell", "yaml", "yml", "python", "py", "text", "")
    out, pos = [], 0
    for m in _TOKEN.finditer(code):
        out.append(_esc(code[pos:m.start()]))
        tok = m.group(0)
        kind = m.lastgroup
        if kind == "comment" and tok.startswith("#") and not hash_comments:
            out.append(_esc(tok[0]))
            pos = m.start() + 1
            continue
        if kind == "comment":
            out.append(f'<font color="#6a737d">{_esc(tok)}</font>')
        elif kind == "string" and lang not in ("text", ""):
            out.append(f'<font color="#0a7f3f">{_esc(tok)}</font>')
        elif kind == "word" and tok in kws:
            out.append(f'<font color="#7c3aed"><b>{_esc(tok)}</b></font>')
        elif kind == "num" and lang not in ("text", ""):
            out.append(f'<font color="#b45309">{_esc(tok)}</font>')
        else:
            out.append(_esc(tok))
        pos = m.end()
    out.append(_esc(code[pos:]))
    return "".join(out)


def wrap_code(code: str, width: int) -> str:
    lines = []
    for line in code.split("\n"):
        line = line.replace("\t", "    ")
        while len(line) > width:
            cut = line.rfind(" ", int(width * 0.6), width)
            cut = cut if cut > 0 else width
            lines.append(line[:cut])
            line = "    " + line[cut:].lstrip()
        lines.append(line)
    return "\n".join(lines)


def code_block(code: str, lang: str):
    code = safe_text(code.rstrip("\n"), mono=True)
    char_w = pdfmetrics.stringWidth("M", MONO, ST["code"].fontSize)
    width = int((CONTENT_W - 16) / char_w) - 1
    code = wrap_code(code, width)
    label = lang if lang and lang not in ("text",) else ""
    pre = XPreformatted(highlight(code, lang.lower()), ST["code"])
    rows = [[pre]]
    style = [
        ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
        ("BOX", (0, 0), (-1, -1), 0.6, CODE_BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    if label:
        rows.insert(0, [Paragraph(f'<font face="{MONO}" size="7" color="#57606a">{_esc(label)}</font>', ST["cell"])])
        style += [("TOPPADDING", (0, 0), (-1, 0), 3), ("BOTTOMPADDING", (0, 0), (-1, 0), 0), ("TOPPADDING", (0, 1), (-1, 1), 2)]
    t = Table(rows, colWidths=[CONTENT_W])
    t.setStyle(TableStyle(style))
    return [t, Spacer(1, 6)]


# ── Diagrams ─────────────────────────────────────────────────────────────
class FlowDiagram(Flowable):
    """Vertical chain of boxes joined by arrows (with optional arrow labels)."""

    def __init__(self, steps, labels):
        super().__init__()
        self.steps, self.labels = steps, labels
        self.box_w = CONTENT_W * 0.72
        self.font, self.size, self.lead = BODY, 8.8, 11.2
        self.gap = 22
        self._layout()

    def _layout(self):
        self.boxes = []
        for s in self.steps:
            lines = simpleSplit(s, self.font, self.size, self.box_w - 16)
            self.boxes.append((lines, len(lines) * self.lead + 10))
        self.height = sum(h for _, h in self.boxes) + self.gap * (len(self.boxes) - 1) + 4
        self.width = CONTENT_W

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        x = (CONTENT_W - self.box_w) / 2
        y = self.height - 2
        for i, (lines, h) in enumerate(self.boxes):
            y -= h
            first = i == 0
            c.setFillColor(BRAND_SOFT if not first else colors.HexColor("#e0e7ff"))
            c.setStrokeColor(BRAND)
            c.setLineWidth(0.8)
            c.roundRect(x, y, self.box_w, h, 5, stroke=1, fill=1)
            c.setFillColor(INK)
            c.setFont(self.font, self.size)
            ty = y + h - 5 - self.size
            for ln in lines:
                c.drawCentredString(x + self.box_w / 2, ty, ln)
                ty -= self.lead
            if i < len(self.boxes) - 1:
                ax = x + self.box_w / 2
                c.setStrokeColor(MUTED)
                c.setFillColor(MUTED)
                c.line(ax, y - 1, ax, y - self.gap + 5)
                p = c.beginPath()
                p.moveTo(ax - 3.5, y - self.gap + 6)
                p.lineTo(ax + 3.5, y - self.gap + 6)
                p.lineTo(ax, y - self.gap + 1)
                p.close()
                c.drawPath(p, fill=1, stroke=0)
                lab = self.labels.get(i)
                if lab:
                    c.setFont(BODY_I, 7.8)
                    c.setFillColor(colors.HexColor("#4b5563"))
                    c.drawString(ax + 7, y - self.gap / 2 - 3, lab)
                y -= self.gap


class LayerDiagram(Flowable):
    """Rows of boxes (" | " separated) connected by downward arrows."""

    def __init__(self, rows, labels):
        super().__init__()
        self.rows, self.labels = rows, labels
        self.font, self.size, self.lead = BODY, 8.4, 10.6
        self.hgap, self.vgap = 8, 24
        self._layout()

    def _layout(self):
        self.layout = []
        for row in self.rows:
            n = len(row)
            w = (CONTENT_W - self.hgap * (n - 1)) / n
            cells = []
            for t in row:
                # "Title;;detail" -> bold title line(s) followed by regular detail line(s)
                lines = []
                for k, piece in enumerate(t.split(";;")):
                    fnt = BODY_B if k == 0 else self.font
                    lines += [(k == 0, ln) for ln in simpleSplit(piece.strip(), fnt, self.size, w - 10)]
                cells.append(lines)
            h = max(len(c) for c in cells) * self.lead + 10
            self.layout.append((w, cells, h))
        self.height = sum(h for *_, h in self.layout) + self.vgap * (len(self.layout) - 1) + 4
        self.width = CONTENT_W

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        y = self.height - 2
        fills = [colors.HexColor("#e0e7ff"), colors.HexColor("#ede9fe"), colors.HexColor("#ecfdf5"), colors.HexColor("#fff7ed"), colors.HexColor("#f0f9ff")]
        for r, (w, cells, h) in enumerate(self.layout):
            y -= h
            for i, lines in enumerate(cells):
                x = i * (w + self.hgap)
                c.setFillColor(fills[r % len(fills)])
                c.setStrokeColor(BRAND)
                c.setLineWidth(0.7)
                c.roundRect(x, y, w, h, 5, stroke=1, fill=1)
                c.setFillColor(INK)
                ty = y + h - 5 - self.size
                for is_title, ln in lines:
                    c.setFont(BODY_B if is_title else self.font, self.size)
                    c.drawCentredString(x + w / 2, ty, ln)
                    ty -= self.lead
            if r < len(self.layout) - 1:
                ax = CONTENT_W / 2
                c.setStrokeColor(MUTED)
                c.setFillColor(MUTED)
                c.line(ax, y - 1, ax, y - self.vgap + 5)
                p = c.beginPath()
                p.moveTo(ax - 3.5, y - self.vgap + 6)
                p.lineTo(ax + 3.5, y - self.vgap + 6)
                p.lineTo(ax, y - self.vgap + 1)
                p.close()
                c.drawPath(p, fill=1, stroke=0)
                lab = self.labels.get(r)
                if lab:
                    c.setFont(BODY_I, 7.8)
                    c.setFillColor(colors.HexColor("#4b5563"))
                    c.drawString(ax + 7, y - self.vgap / 2 - 3, lab)
                y -= self.vgap


def diagram(kind, body):
    lines = [safe_text(l.strip()) for l in body.strip("\n").split("\n") if l.strip()]
    items, labels = [], {}
    for l in lines:
        if l.startswith("->"):
            labels[len(items) - 1] = l[2:].strip()
        else:
            items.append([p.strip() for p in l.split(" | ")] if kind == "layers" else l)
    d = LayerDiagram(items, labels) if kind == "layers" else FlowDiagram(items, labels)
    # no leading spacer: a heading's keepWithNext must bind to the diagram itself
    return [d, Spacer(1, 8)]


class NoteLines(Flowable):
    def __init__(self, n):
        super().__init__()
        self.n = n
        self.height = n * 20 + 4
        self.width = CONTENT_W

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setStrokeColor(RULE)
        c.setLineWidth(0.5)
        for i in range(self.n):
            y = self.height - (i + 1) * 20
            c.line(0, y, CONTENT_W, y)


# ── Block parsing ────────────────────────────────────────────────────────
def _measure(cell: str, size: float = 8.6):
    """(longest plain word, longest code segment, whole single-line width) of a cell, in points."""
    parts = re.split(r"(`[^`]+`)", safe_text(cell))
    words, codes, total = [0.0], [0.0], 0.0
    for p in parts:
        if p.startswith("`") and p.endswith("`") and len(p) > 1:
            txt = p[1:-1]
            total += pdfmetrics.stringWidth(txt, MONO, size)
            codes += [pdfmetrics.stringWidth(t, MONO, size) for t in re.split(r"(?<=[/,.\-])|\s+", txt) if t]
        else:
            txt = re.sub(r"\*\*|\*|\[|\]\([^)]*\)", "", p)
            total += pdfmetrics.stringWidth(txt, BODY_B, size)
            words += [pdfmetrics.stringWidth(t, BODY_B, size) for t in txt.split() if t]
    return max(words), max(codes), total


def column_widths(rows, ncol, pad=11, size=8.6):
    """Column widths for a table.

    Plain words are never split, so each column gets at least its longest plain word
    (a hard minimum). Code segments may be split by ReportLab if space is short, so
    they only raise a soft minimum. Spare width goes to columns with more content.
    """
    hard, soft, nats = [0.0] * ncol, [0.0] * ncol, [0.0] * ncol
    for r in rows:
        for c in range(ncol):
            pw, cw, tw = _measure(r[c], size)
            hard[c] = max(hard[c], pw + pad)
            soft[c] = max(soft[c], pw + pad, cw + pad)
            nats[c] = max(nats[c], tw + pad)
    cap = CONTENT_W * 0.42
    hard = [min(h, cap) for h in hard]
    mins = [min(max(s, h), cap) for s, h in zip(soft, hard)]
    nats = [max(n, m) for n, m in zip(nats, mins)]
    if sum(nats) <= CONTENT_W:
        scale = CONTENT_W / sum(nats)
        return [n * scale for n in nats]
    if sum(mins) >= CONTENT_W:
        # shrink only the code-driven excess; plain-word minimums stay intact
        if sum(hard) < CONTENT_W:
            excess = [m - h for m, h in zip(mins, hard)]
            room = CONTENT_W - sum(hard)
            te = sum(excess) or 1
            return [h + room * e / te for h, e in zip(hard, excess)]
        scale = CONTENT_W / sum(hard)
        return [h * scale for h in hard]
    spare = CONTENT_W - sum(mins)
    want = [n - m for n, m in zip(nats, mins)]
    # dampen very long columns so short ones still get a fair share
    want = [w ** 0.75 for w in want]
    tw = sum(want) or 1
    return [m + spare * w / tw for m, w in zip(mins, want)]


def table_flowable(rows):
    header, body = rows[0], rows[1:]
    ncol = len(header)
    body = [r + [""] * (ncol - len(r)) if len(r) < ncol else r[:ncol] for r in body]
    dense = ncol >= 5
    size = 7.8 if dense else 8.6
    cell = ParagraphStyle("cellD", parent=ST["cell"], fontSize=size, leading=size * 1.3) if dense else ST["cell"]
    cellh = ParagraphStyle("cellhD", parent=ST["cellh"], fontSize=size, leading=size * 1.3) if dense else ST["cellh"]
    widths = column_widths([header] + body, ncol, size=size)
    inner = [w - 9 for w in widths]  # cell width minus left/right padding
    data = [[Paragraph(inline(h, inner[c], size, code_color="#ffffff"), cellh) for c, h in enumerate(header)]]
    data += [[Paragraph(inline(x, inner[c], size), cell) for c, x in enumerate(r)] for r in body]
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), BRAND),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 4.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4.5),
        ("TOPPADDING", (0, 0), (-1, -1), 3.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.6),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f9fafb")))
    t.setStyle(TableStyle(style))
    return [t, Spacer(1, 8)]


def callout_flowable(kind, text):
    title, edge, bg = CALLOUTS.get(kind, CALLOUTS["NOTE"])
    paras = [Paragraph(title, ParagraphStyle("ct", parent=ST["calloutT"], textColor=edge))]
    for chunk in text.split("\n\n"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if all(l.strip().startswith(("- ", "* ")) for l in chunk.split("\n")):
            for l in chunk.split("\n"):
                paras.append(Paragraph(inline(l.strip()[2:]), ParagraphStyle("cb", parent=ST["callout"], leftIndent=10, bulletIndent=0), bulletText=BULLET))
        else:
            paras.append(Paragraph(inline(chunk.replace("\n", " ")), ST["callout"]))
    t = Table([[paras]], colWidths=[CONTENT_W])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("LINEBEFORE", (0, 0), (0, -1), 3, edge),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return [t, Spacer(1, 8)]


BULLET = "\u2022" if 0x2022 in _BODY_GLYPHS else "-"


def list_flowables(items):
    out = []
    for kind, level, marker, text in items:
        indent = 14 + level * 14
        style = ParagraphStyle("li", parent=ST["bullet"], leftIndent=indent, bulletIndent=indent - 11)
        if kind == "check":
            out.append(Paragraph(inline(text), ParagraphStyle("chk", parent=style, leftIndent=indent + 6), bulletText="\u2610" if 0x2610 in _BODY_GLYPHS else "[ ]"))
        elif kind == "ol":
            out.append(Paragraph(inline(text), style, bulletText=f"{marker}."))
        else:
            out.append(Paragraph(inline(text), style, bulletText=BULLET if level == 0 else "\u2013" if 0x2013 in _BODY_GLYPHS else "-"))
    out.append(Spacer(1, 4))
    return out


def parse_front_matter(text):
    meta = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        for line in text[3:end].strip().split("\n"):
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        text = text[end + 4:]
    return meta, text


def md_to_flowables(text):
    lines = text.split("\n")
    out = []
    i = 0
    para = []

    def flush_para():
        if para:
            out.append(Paragraph(inline(" ".join(p.strip() for p in para)), ST["body"]))
            para.clear()

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("```"):
            flush_para()
            lang = stripped[3:].strip()
            buf = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            body = "\n".join(buf)
            if lang in ("flow", "layers"):
                out.extend(diagram(lang, body))
            else:
                out.extend(code_block(body, lang))
            continue
        if stripped == "\\pagebreak":
            flush_para()
            out.append(PageBreak())
            i += 1
            continue
        m = re.match(r"\[\[NOTES (\d+)\]\]", stripped)
        if m:
            flush_para()
            out.append(NoteLines(int(m.group(1))))
            out.append(Spacer(1, 6))
            i += 1
            continue
        if not stripped:
            flush_para()
            i += 1
            continue
        if stripped == "---":
            flush_para()
            out.append(Spacer(1, 4))
            t = Table([[""]], colWidths=[CONTENT_W], rowHeights=[1])
            t.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, -1), 0.6, RULE)]))
            out.extend([t, Spacer(1, 6)])
            i += 1
            continue
        h = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if h:
            flush_para()
            level = len(h.group(1))
            text_ = h.group(2).strip()
            out.append(CondPageBreak({1: 55 * mm, 2: 40 * mm, 3: 28 * mm}[level]))
            p = Paragraph(inline(text_), ST[f"h{level}"])
            p._toc_level = level  # noqa: SLF001
            p._toc_text = safe_text(re.sub(r"[`*]", "", text_))  # noqa: SLF001
            out.append(p)
            i += 1
            continue
        if stripped.startswith(">"):
            flush_para()
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            first = buf[0].strip() if buf else ""
            m = re.match(r"\[!(\w+)\]\s*(.*)", first)
            kind = "NOTE"
            if m:
                kind = m.group(1).upper()
                buf[0] = m.group(2)
            out.extend(callout_flowable(kind, "\n".join(buf).strip()))
            continue
        if stripped.startswith("|"):
            flush_para()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                row = lines[i].strip().strip("|")
                cells = [c.strip() for c in re.split(r"(?<!\\)\|", row)]
                cells = [c.replace("\\|", "|") for c in cells]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                    rows.append(cells)
                i += 1
            if rows:
                out.extend(table_flowable(rows))
            continue
        lm = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if lm:
            flush_para()
            items = []
            while i < len(lines):
                lm = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", lines[i])
                if not lm:
                    # continuation line of the previous item
                    if lines[i].strip() and lines[i].startswith("  ") and items and not lines[i].strip().startswith(("|", ">", "```", "#")):
                        k, lv, mk, tx = items[-1]
                        items[-1] = (k, lv, mk, tx + " " + lines[i].strip())
                        i += 1
                        continue
                    break
                level = 1 if len(lm.group(1)) >= 2 else 0
                marker = lm.group(2)
                txt = lm.group(3)
                if txt.startswith("[ ] ") or txt.startswith("[x] "):
                    items.append(("check", level, "", txt[4:]))
                elif marker[0].isdigit():
                    items.append(("ol", level, marker[:-1], txt))
                else:
                    items.append(("ul", level, "", txt))
                i += 1
            out.extend(list_flowables(items))
            continue
        para.append(line)
        i += 1
    flush_para()
    return bind_headings(out)


def _unsplittable(f):
    """Diagrams, code blocks and callouts (single-row tables) cannot break across pages."""
    if isinstance(f, (FlowDiagram, LayerDiagram, NoteLines)):
        return True
    return isinstance(f, Table) and len(getattr(f, "_cellvalues", [])) <= 2


def bind_headings(flows):
    """Keep a heading on the same page as a following diagram, code block or callout.

    Long tables, lists and paragraphs can split, so for them the CondPageBreak placed
    before every heading is enough to stop a heading being stranded at a page foot.
    """
    out, i = [], 0
    while i < len(flows):
        f = flows[i]
        if getattr(f, "_toc_level", None):
            j = i + 1
            while j < len(flows) and isinstance(flows[j], Spacer):
                j += 1
            if j < len(flows) and _unsplittable(flows[j]):
                out.append(KeepTogether(flows[i : j + 1]))
                i = j + 1
                continue
        out.append(f)
        i += 1
    return out


# ── Document template ───────────────────────────────────────────────────
@dataclass
class DocInfo:
    title: str
    subtitle: str
    number: str
    audience: str
    generated: str
    commit: str
    extra: dict = field(default_factory=dict)


class HandbookDoc(BaseDocTemplate):
    def __init__(self, filename, info: DocInfo, with_toc: bool):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=MARGIN_L,
            rightMargin=MARGIN_R,
            topMargin=MARGIN_T,
            bottomMargin=MARGIN_B,
            title=f"{info.number} {info.title}",
            author="VEXON Developer Handbook (generated from the repository)",
            subject=info.subtitle,
            creator="docs/developer-handbook/build_handbook.py (ReportLab)",
        )
        self.info = info
        self.with_toc = with_toc
        frame = Frame(MARGIN_L, MARGIN_B, CONTENT_W, PAGE_H - MARGIN_T - MARGIN_B, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates(
            [
                PageTemplate(id="cover", frames=[frame], onPage=self._cover),
                PageTemplate(id="body", frames=[frame], onPage=self._page),
            ]
        )
        self._bm = 0

    def beforeDocument(self):
        # multiBuild renders several passes; bookmark keys must be identical in
        # each one or the table of contents never settles.
        self._bm = 0

    def afterFlowable(self, flowable):
        level = getattr(flowable, "_toc_level", None)
        if level in (1, 2):
            text = flowable._toc_text  # noqa: SLF001
            key = f"bm{self._bm}"
            self._bm += 1
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=level - 1, closed=level > 1)
            self.notify("TOCEntry", (level - 1, text, self.page, key))

    def _cover(self, c, _doc):
        info = self.info
        c.saveState()
        c.setFillColor(BRAND_DARK)
        c.rect(0, PAGE_H - 118 * mm, PAGE_W, 118 * mm, stroke=0, fill=1)
        c.setFillColor(BRAND)
        c.rect(0, PAGE_H - 122 * mm, PAGE_W, 4 * mm, stroke=0, fill=1)
        c.setFillColor(colors.HexColor("#c7d2fe"))
        c.setFont(BODY_B, 11)
        c.drawString(MARGIN_L, PAGE_H - 30 * mm, safe_text(f"VEXON DEVELOPER HANDBOOK  \u00b7  GUIDE {info.number}"))
        c.setFillColor(colors.white)
        y = PAGE_H - 52 * mm
        for ln in simpleSplit(safe_text(info.title), BODY_B, 28, CONTENT_W):
            c.setFont(BODY_B, 28)
            c.drawString(MARGIN_L, y, ln)
            y -= 34
        c.setFont(BODY, 13)
        c.setFillColor(colors.HexColor("#e0e7ff"))
        for ln in simpleSplit(safe_text(info.subtitle), BODY, 13, CONTENT_W):
            c.drawString(MARGIN_L, y - 4, ln)
            y -= 18
        c.setFillColor(INK)
        y = PAGE_H - 140 * mm
        rows = [
            ("Written for", info.audience),
            ("Project", "VEXON / CampusConnect (repository: this folder's parent project)"),
            ("Evidence", "Generated from a direct inspection of the repository source code"),
            ("Repository state", info.commit),
            ("Generated", info.generated),
            ("Rebuild", "python docs/developer-handbook/build_handbook.py"),
        ]
        for k, v in rows:
            c.setFont(BODY_B, 10)
            c.setFillColor(BRAND)
            c.drawString(MARGIN_L, y, safe_text(k))
            c.setFont(BODY, 10)
            c.setFillColor(INK)
            for ln in simpleSplit(safe_text(v), BODY, 10, CONTENT_W - 42 * mm):
                c.drawString(MARGIN_L + 42 * mm, y, ln)
                y -= 14
            y -= 6
        c.setStrokeColor(RULE)
        c.line(MARGIN_L, 34 * mm, PAGE_W - MARGIN_R, 34 * mm)
        c.setFont(BODY, 8.5)
        c.setFillColor(MUTED)
        note = (
            "Accuracy rule: every statement about VEXON in this guide is based on files in the repository. "
            "Anything that could not be confirmed is labelled 'unverified', 'planned' or 'hypothetical'. "
            "No secrets, passwords or real student data are reproduced."
        )
        yy = 28 * mm
        for ln in simpleSplit(safe_text(note), BODY, 8.5, CONTENT_W):
            c.drawString(MARGIN_L, yy, ln)
            yy -= 11
        c.restoreState()

    def _page(self, c, doc):
        c.saveState()
        c.setStrokeColor(RULE)
        c.setLineWidth(0.5)
        c.line(MARGIN_L, PAGE_H - 13 * mm, PAGE_W - MARGIN_R, PAGE_H - 13 * mm)
        c.setFont(BODY, 8)
        c.setFillColor(MUTED)
        c.drawString(MARGIN_L, PAGE_H - 11 * mm, safe_text(f"VEXON Developer Handbook \u00b7 Guide {self.info.number}"))
        c.drawRightString(PAGE_W - MARGIN_R, PAGE_H - 11 * mm, safe_text(self.info.title))
        c.line(MARGIN_L, 13 * mm, PAGE_W - MARGIN_R, 13 * mm)
        c.drawString(MARGIN_L, 9 * mm, safe_text(f"Source: docs/developer-handbook/src/{self.info.extra.get('src', '')}"))
        c.drawRightString(PAGE_W - MARGIN_R, 9 * mm, f"Page {doc.page}")
        c.restoreState()


def repo_state():
    try:
        sha = subprocess.run(["git", "-C", REPO, "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=10).stdout.strip()
        branch = subprocess.run(["git", "-C", REPO, "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, timeout=10).stdout.strip()
        dirty = subprocess.run(["git", "-C", REPO, "status", "--porcelain"], capture_output=True, text=True, timeout=20).stdout
        n = len([l for l in dirty.splitlines() if l.strip()])
        if sha:
            return f"branch {branch}, commit {sha}" + (f", plus {n} uncommitted working-tree change(s)" if n else "")
    except Exception:
        pass
    return "unknown (git not available)"


def build(md_path, commit, generated):
    with open(md_path, encoding="utf-8") as f:
        meta, body = parse_front_matter(f.read())
    name = os.path.splitext(os.path.basename(md_path))[0]
    info = DocInfo(
        title=meta.get("title", name),
        subtitle=meta.get("subtitle", ""),
        number=meta.get("number", name[:2]),
        audience=meta.get("audience", "A student developer maintaining VEXON"),
        generated=generated,
        commit=commit,
        extra={"src": os.path.basename(md_path)},
    )
    with_toc = meta.get("toc", "yes").lower() != "no"
    pdf_path = os.path.join(OUT, name + ".pdf")
    doc = HandbookDoc(pdf_path, info, with_toc)
    story = [NextPageTemplate("body"), PageBreak()]
    if with_toc:
        toc = TableOfContents()
        toc.levelStyles = [ST["toc1"], ST["toc2"]]
        toc.dotsMinLevel = 0
        story += [Paragraph("Contents", ST["h1"]), toc, PageBreak()]
    story += md_to_flowables(body)
    doc.multiBuild(story)
    return pdf_path


def main(argv):
    if not os.path.isdir(SRC):
        sys.exit(f"Missing source folder: {SRC}")
    files = sorted(f for f in os.listdir(SRC) if f.endswith(".md"))
    if argv:
        files = [f for f in files if any(f.startswith(a) for a in argv)]
    commit = repo_state()
    generated = _dt.datetime.now().strftime("%d %B %Y, %H:%M")
    print(f"Fonts: body={BODY} mono={MONO}")
    for f in files:
        path = build(os.path.join(SRC, f), commit, generated)
        print(f"built {os.path.relpath(path, REPO)}")


if __name__ == "__main__":
    main(sys.argv[1:])
