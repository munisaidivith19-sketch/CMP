/**
 * A very small PDF 1.4 writer — just enough for the Attendance reports, with
 * no new dependency. Text uses the two PDF base-14 Helvetica fonts, so no font
 * file is embedded and the output opens in every reader.
 *
 * The document streams straight to the HTTP response as a Buffer; nothing is
 * ever written to disk, so there are no temporary report files to secure or
 * clean up (and no user-controlled filesystem path anywhere).
 */

// Glyph widths (units per 1000) for ASCII 32–126, used for column fitting.
const W_REG = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// A few characters the app's own data commonly contains, folded to ASCII so
// the base-14 encoding never produces a wrong glyph.
const FOLD = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '-', '·': '-', '₹': 'Rs.', '…': '...' };

/** Fold to printable ASCII — the one encoding the base-14 fonts handle safely. */
export function asciiSafe(value) {
  return String(value ?? '')
    .replace(/[–—‘’“”•·₹…]/g, (c) => FOLD[c])
    .replace(/[^\x20-\x7e]/g, '?');
}

const widthOf = (text, size, bold) => {
  const table = bold ? W_BOLD : W_REG;
  let total = 0;
  for (const ch of text) total += table[ch.charCodeAt(0) - 32] ?? 556;
  return (total * size) / 1000;
};

/** Escape a string for a PDF literal string object. */
const pdfString = (s) => asciiSafe(s).replace(/([\\()])/g, '\\$1');

/** Cut `text` to `maxWidth`, adding an ellipsis when it had to be shortened. */
export function fit(text, maxWidth, size, bold = false) {
  const s = asciiSafe(text);
  if (widthOf(s, size, bold) <= maxWidth) return s;
  let out = '';
  for (const ch of s) {
    if (widthOf(`${out}${ch}...`, size, bold) > maxWidth) break;
    out += ch;
  }
  return `${out}...`;
}

/** Greedy word wrap into lines no wider than `maxWidth`. */
export function wrap(text, maxWidth, size, bold = false) {
  const words = asciiSafe(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && widthOf(candidate, size, bold) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const A4 = { width: 595.28, height: 841.89 };

/**
 * A paginated A4 document. Content is appended top-down; every writer checks
 * the remaining space first and starts a new page when it runs out, so a
 * report of any length lays out without the caller tracking coordinates.
 */
export class PdfDocument {
  constructor({ title = 'Report', margin = 42, footer = '' } = {}) {
    this.title = title;
    this.margin = margin;
    this.footer = footer;
    this.pages = [];
    this.ops = null;
    this.y = 0;
    this.repeatOnBreak = null;
    this.addPage();
  }

  get contentWidth() {
    return A4.width - this.margin * 2;
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = A4.height - this.margin;
  }

  /** Space left above the footer area. */
  get remaining() {
    return this.y - (this.margin + 24);
  }

  /** Start a new page when `needed` points of vertical space are not left. */
  ensure(needed) {
    if (this.remaining >= needed) return false;
    this.addPage();
    if (this.repeatOnBreak) this.repeatOnBreak();
    return true;
  }

  gap(points = 8) {
    this.y -= points;
  }

  /** One line of text at the current position. */
  line(text, { size = 10, bold = false, x = null, color = null, indent = 0 } = {}) {
    this.ensure(size + 4);
    this.y -= size + 2;
    this.draw(text, { size, bold, x: (x ?? this.margin) + indent, y: this.y, color });
    return this;
  }

  /** Text at an absolute position (no layout, no page break). */
  draw(text, { size = 10, bold = false, x = 0, y = 0, color = null } = {}) {
    const font = bold ? '/F2' : '/F1';
    const paint = color ? `${color.join(' ')} rg\n` : '0 0 0 rg\n';
    this.ops.push(`BT\n${paint}${font} ${size} Tf\n1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(${pdfString(text)}) Tj\nET`);
    return this;
  }

  /** Right-aligned text at an absolute position. */
  drawRight(text, { size = 10, bold = false, right = 0, y = 0, color = null } = {}) {
    const s = asciiSafe(text);
    return this.draw(s, { size, bold, x: right - widthOf(s, size, bold), y, color });
  }

  rect(x, y, w, h, color) {
    this.ops.push(`${color.join(' ')} rg\n${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    return this;
  }

  hr({ color = [0.78, 0.78, 0.82], thickness = 0.6 } = {}) {
    this.ensure(6);
    this.y -= 4;
    this.rect(this.margin, this.y, this.contentWidth, thickness, color);
    this.y -= 2;
    return this;
  }

  /** Wrapped paragraph. */
  paragraph(text, { size = 10, bold = false, indent = 0 } = {}) {
    for (const l of wrap(text, this.contentWidth - indent, size, bold)) this.line(l, { size, bold, indent });
    return this;
  }

  /** A `Label: value` row list, two per line where they fit. */
  facts(pairs, { size = 9.5 } = {}) {
    const usable = pairs.filter(([, v]) => v !== undefined && v !== null && v !== '');
    const colWidth = this.contentWidth / 2;
    for (let i = 0; i < usable.length; i += 2) {
      this.ensure(size + 5);
      this.y -= size + 3;
      usable.slice(i, i + 2).forEach(([label, value], col) => {
        const x = this.margin + col * colWidth;
        const labelText = `${asciiSafe(label)}: `;
        this.draw(labelText, { size, bold: true, x, y: this.y });
        this.draw(fit(value, colWidth - widthOf(labelText, size, true) - 10, size), {
          size,
          x: x + widthOf(labelText, size, true),
          y: this.y,
        });
      });
    }
    return this;
  }

  /** Section title with a rule under it. */
  section(text, { size = 11.5 } = {}) {
    this.ensure(size + 18);
    this.gap(10);
    this.line(text, { size, bold: true });
    this.hr();
    this.gap(2);
    return this;
  }

  /**
   * A table. `columns` is [{ header, width (share of content width), align }].
   * The header row repeats automatically on every page the table spills onto.
   */
  table({ columns, rows, size = 9, headerSize = 8.5, zebra = true }) {
    const totalShare = columns.reduce((a, c) => a + (c.width || 1), 0);
    const widths = columns.map((c) => ((c.width || 1) / totalShare) * this.contentWidth);
    const xs = [];
    widths.reduce((x, w) => {
      xs.push(x);
      return x + w;
    }, this.margin);
    const rowHeight = size + 7;

    const header = () => {
      this.ensure(rowHeight + 4);
      this.y -= rowHeight;
      this.rect(this.margin, this.y - 2, this.contentWidth, rowHeight, [0.93, 0.93, 0.96]);
      columns.forEach((c, i) => {
        const text = fit(c.header, widths[i] - 8, headerSize, true);
        if (c.align === 'right') this.drawRight(text, { size: headerSize, bold: true, right: xs[i] + widths[i] - 4, y: this.y + 2 });
        else this.draw(text, { size: headerSize, bold: true, x: xs[i] + 4, y: this.y + 2 });
      });
    };

    const previous = this.repeatOnBreak;
    header();
    this.repeatOnBreak = header;

    rows.forEach((row, index) => {
      this.ensure(rowHeight);
      this.y -= rowHeight;
      if (zebra && index % 2 === 1) this.rect(this.margin, this.y - 2, this.contentWidth, rowHeight, [0.97, 0.97, 0.98]);
      columns.forEach((c, i) => {
        const text = fit(row[i], widths[i] - 8, size, Boolean(c.bold));
        if (c.align === 'right') this.drawRight(text, { size, bold: Boolean(c.bold), right: xs[i] + widths[i] - 4, y: this.y + 2 });
        else this.draw(text, { size, bold: Boolean(c.bold), x: xs[i] + 4, y: this.y + 2 });
      });
    });

    this.repeatOnBreak = previous;
    return this;
  }

  /** Serialise to a PDF byte buffer. */
  toBuffer() {
    // Page footers: "Page n of m" plus the caller's footer line.
    this.pages.forEach((ops, i) => {
      const y = this.margin - 6;
      const label = `Page ${i + 1} of ${this.pages.length}`;
      const saved = this.ops;
      this.ops = ops;
      this.rect(this.margin, y + 14, this.contentWidth, 0.5, [0.85, 0.85, 0.88]);
      if (this.footer) this.draw(fit(this.footer, this.contentWidth - 120, 8), { size: 8, x: this.margin, y, color: [0.42, 0.42, 0.48] });
      this.drawRight(label, { size: 8, right: A4.width - this.margin, y, color: [0.42, 0.42, 0.48] });
      this.ops = saved;
    });

    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length; // 1-based object number
    };

    const catalogNo = add(null); // reserved, filled in below
    const pagesNo = add(null);
    const fontReg = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const pageNos = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const contentNo = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      pageNos.push(
        add(
          `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${A4.width.toFixed(2)} ${A4.height.toFixed(2)}] ` +
            `/Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentNo} 0 R >>`
        )
      );
    }

    objects[catalogNo - 1] = `<< /Type /Catalog /Pages ${pagesNo} 0 R >>`;
    objects[pagesNo - 1] =
      `<< /Type /Pages /Count ${pageNos.length} /Kids [${pageNos.map((n) => `${n} 0 R`).join(' ')}] >>`;

    let out = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out +=
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R ` +
      `/Info << /Title (${pdfString(this.title)}) /Producer (VEXON) >> >>\nstartxref\n${xref}\n%%EOF\n`;

    return Buffer.from(out, 'latin1');
  }
}

/**
 * A safe download filename: only the characters a filename needs, so a
 * user-supplied value can never steer a path or inject header syntax.
 */
export const safeFilename = (name) =>
  asciiSafe(name).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '').slice(0, 120) || 'report.pdf';
