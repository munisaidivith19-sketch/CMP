/**
 * A very small Word (.docx) writer — just enough for tabular reports, with no
 * new dependency: WordprocessingML parts zipped with Node's own zlib.
 *
 * Like utils/pdf.js the document is built in memory and sent as a Buffer;
 * nothing is written to disk. All text is XML-escaped, so user data (subject,
 * faculty, room names) can never inject markup.
 */
import { crc32, deflateRawSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';

/* ── ZIP (deflate, no encryption, no zip64 — reports are small) ── */

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** files: [{ name, data: Buffer|string }] → a ZIP archive Buffer. */
export function zip(files, now = new Date()) {
  const { time, date } = dosDateTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const packed = deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/* ── WordprocessingML helpers ── */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Escape text for XML and drop characters XML 1.0 forbids. */
export function xmlText(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const hex = (rgb) => (Array.isArray(rgb) ? rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase() : rgb);

/** One run of text. size in points. */
export function run(text, { bold = false, size = 10, color = null, italic = false } = {}) {
  const props = [
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>',
    bold ? '<w:b/>' : '',
    italic ? '<w:i/>' : '',
    color ? `<w:color w:val="${hex(color)}"/>` : '',
    `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`,
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;
}

/** A paragraph of runs (or one plain string). */
export function paragraph(content, { align = 'left', after = 80, before = 0, keepNext = false, ...runOpts } = {}) {
  const runs = Array.isArray(content) ? content.join('') : run(content, runOpts);
  const jc = align === 'left' ? '' : `<w:jc w:val="${align === 'center' ? 'center' : 'right'}"/>`;
  return `<w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}<w:spacing w:before="${before}" w:after="${after}"/>${jc}</w:pPr>${runs}</w:p>`;
}

/**
 * A table. columns: [{ header, width (share) }]; rows: cells, each a string,
 * an array of lines ({ text, bold, size, color } or strings), or
 * { lines, bg }. widthTwips is the usable page width.
 */
export function table({ columns, rows, widthTwips, size = 9, headerBg = 'E8E8F2' }) {
  const total = columns.reduce((a, c) => a + (c.width || 1), 0);
  const widths = columns.map((c) => Math.floor(((c.width || 1) / total) * widthTwips));
  const border = '<w:top w:val="single" w:sz="4" w:color="B8B8C8"/><w:left w:val="single" w:sz="4" w:color="B8B8C8"/><w:bottom w:val="single" w:sz="4" w:color="B8B8C8"/><w:right w:val="single" w:sz="4" w:color="B8B8C8"/><w:insideH w:val="single" w:sz="4" w:color="B8B8C8"/><w:insideV w:val="single" w:sz="4" w:color="B8B8C8"/>';
  const linesOf = (cell) => {
    if (cell == null) return [{ text: '' }];
    const list = typeof cell === 'object' && !Array.isArray(cell) && cell.lines ? cell.lines : Array.isArray(cell) ? cell : String(cell).split('\n');
    return list.map((l) => (typeof l === 'object' ? l : { text: String(l) }));
  };
  const cellXml = (cell, i, { header = false } = {}) => {
    const bg = header ? headerBg : typeof cell === 'object' && !Array.isArray(cell) && cell?.bg ? hex(cell.bg) : null;
    const paras = linesOf(cell)
      .map((l, k) => {
        const opts = {
          bold: header || Boolean(l.bold),
          size: l.size ? l.size + 1 : k === 0 ? size : size - 0.5,
          color: l.color || (k === 0 || header ? null : [0.3, 0.3, 0.38]),
        };
        return paragraph([run(l.text, opts)], { after: 0 });
      })
      .join('');
    return `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>` : ''}<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/></w:tcMar></w:tcPr>${paras || paragraph('', { after: 0 })}</w:tc>`;
  };
  const headerRow = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${columns.map((c, i) => cellXml(c.header, i, { header: true })).join('')}</w:tr>`;
  const body = rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cellXml(c, i)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${headerRow}${body}</w:tbl>`;
}

/* ── The college logo (same asset as the PDF reports) ── */

const LOGO_URLS = [new URL('../assets/pdf-logo.png', import.meta.url), new URL('../../../client/public/pdf-logo.png', import.meta.url)];
let logoCache;
function loadLogo() {
  if (logoCache !== undefined) return logoCache;
  logoCache = null;
  for (const u of LOGO_URLS) {
    try {
      if (!existsSync(u)) continue;
      const data = readFileSync(u);
      if (data.readUInt32BE(0) !== 0x89504e47) continue; // PNG
      logoCache = { data, width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
      break;
    } catch {
      // next candidate
    }
  }
  return logoCache;
}

/** The logo as a centred paragraph scaled into maxWidth x maxHeight points ('' when unavailable). */
export function logoParagraph({ maxWidth = 210, maxHeight = 46 } = {}) {
  const img = loadLogo();
  if (!img) return '';
  const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
  const cx = Math.round(img.width * scale * 12700); // points → EMU
  const cy = Math.round(img.height * scale * 12700);
  const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="College logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  return `<w:p><w:pPr><w:spacing w:after="80"/><w:jc w:val="center"/></w:pPr>${drawing}</w:p>`;
}

/**
 * A complete .docx file. `body` is WordprocessingML (paragraphs, tables).
 * A4, landscape optional; margins in twips (720 = 0.5 inch).
 */
export function buildDocx({ body, title = 'Report', landscape = false, margin = 720, footer = '' }) {
  const [w, h] = landscape ? [16838, 11906] : [11906, 16838];
  const hasLogo = body.includes('r:embed="rIdLogo"') && loadLogo();
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const footerRef = footer ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : '';
  const document = `${XML_HEAD}<w:document ${ns}><w:body>${body}<w:sectPr>${footerRef}<w:pgSz w:w="${w}" w:h="${h}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const footerXml = `${XML_HEAD}<w:ftr ${ns}>${paragraph(footer, { align: 'center', size: 7.5, color: [0.45, 0.45, 0.5], after: 0 })}</w:ftr>`;
  const rels = [
    hasLogo ? '<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' : '',
    footer ? '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : '',
  ].join('');
  const files = [
    {
      name: '[Content_Types].xml',
      data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${footer ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: 'docProps/core.xml',
      data: `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(title)}</dc:title><dc:creator>JNN Campus App</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`,
    },
    { name: 'word/document.xml', data: document },
    { name: 'word/_rels/document.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>` },
  ];
  if (footer) files.push({ name: 'word/footer1.xml', data: footerXml });
  if (hasLogo) files.push({ name: 'word/media/logo.png', data: loadLogo().data });
  return zip(files);
}

/** Usable width in twips for an A4 page with the given margin. */
export const contentTwips = ({ landscape = false, margin = 720 } = {}) => (landscape ? 16838 : 11906) - 2 * margin;
