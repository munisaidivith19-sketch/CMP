import { Fragment } from 'react';

/**
 * Small, dependency-free Markdown renderer for assistant answers. Builds
 * React elements only (no innerHTML), so model output can never inject
 * markup/scripts. Supports headings, paragraphs, bullet/numbered lists,
 * fenced code, tables, blockquotes, **bold**, *italic*, `code`, safe
 * http(s) links, and [S1]-style citation tags.
 */

const SAFE_URL = /^https?:\/\//i;

function inline(text, keyBase = 'i') {
  const out = [];
  // Order matters: code first so its contents aren't formatted.
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[([^\]\n]+)\]\(([^)\s]+)\))|(\[S\d+\])/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[1]) out.push(<code key={key} className="rounded-md bg-primary-500/10 px-1.5 py-0.5 font-mono text-[0.85em] text-primary-700 dark:text-primary-200">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key} className="font-bold">{inline(m[2].slice(2, -2), key)}</strong>);
    else if (m[3]) out.push(<em key={key}>{inline(m[3].slice(1, -1), key)}</em>);
    else if (m[4]) {
      out.push(
        SAFE_URL.test(m[6]) ? (
          <a key={key} href={m[6]} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-primary-600 underline decoration-primary-300 underline-offset-2 hover:text-primary-500 dark:text-primary-300">
            {m[5]}
          </a>
        ) : (
          m[5]
        )
      );
    } else if (m[7]) {
      out.push(
        <sup key={key} className="mx-0.5 rounded bg-primary-500/15 px-1 text-[0.65rem] font-bold text-primary-600 dark:text-primary-300" title="Source cited below">
          {m[7].slice(1, -1)}
        </sup>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export default function Markdown({ text = '' }) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code (also renders an unterminated fence while streaming)
    const fence = /^\s*```\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      blocks.push(
        <div key={blocks.length} className="overflow-hidden rounded-2xl border border-white/10 bg-[#1b1d3a] text-slate-100">
          {fence[1] && <div className="border-b border-white/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400">{fence[1]}</div>}
          <pre className="overflow-x-auto p-3 text-xs leading-relaxed"><code>{body.join('\n')}</code></pre>
        </div>
      );
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const size = heading[1].length <= 2 ? 'text-base' : 'text-sm';
      blocks.push(<p key={blocks.length} className={`${size} font-extrabold tracking-tight`}>{inline(heading[2], `h${i}`)}</p>);
      i += 1;
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={blocks.length} className="overflow-x-auto rounded-2xl border border-white/70 dark:border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="bg-primary-500/10">
              <tr>{head.map((h, j) => <th key={j} className="px-3 py-2 font-bold">{inline(h, `th${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-white/60 dark:border-white/10">
                  {r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{inline(c, `td${ri}-${j}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Lists
    const listRe = /^\s*([-*•]|\d+[.)])\s+(.*)$/;
    if (listRe.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && listRe.test(lines[i])) {
        const [, , content] = listRe.exec(lines[i]);
        const indent = /^\s*/.exec(lines[i])[0].length;
        items.push({ content, indent });
        i += 1;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={blocks.length} className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5 marker:text-primary-400`}>
          {items.map((it, j) => (
            <li key={j} style={it.indent >= 2 ? { marginLeft: Math.min(it.indent, 8) * 6 } : undefined}>{inline(it.content, `li${i}-${j}`)}</li>
          ))}
        </Tag>
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={blocks.length} className="border-l-4 border-primary-300 pl-3 italic muted">{inline(quote.join(' '), `q${i}`)}</blockquote>);
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={blocks.length} className="divider" />);
      i += 1;
      continue;
    }

    // Paragraph: consecutive plain lines
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s|>)/.test(lines[i]) && !(lines[i].includes('|') && isTableSep(lines[i + 1] || ''))) {
      para.push(lines[i++]);
    }
    if (!para.length) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={blocks.length}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `p${i}-${j}`)}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div className="space-y-2.5 break-words text-sm leading-relaxed">{blocks}</div>;
}
