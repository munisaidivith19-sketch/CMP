import { Linking, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

/**
 * Lightweight Markdown for Study Assistant answers on mobile: headings,
 * bullet/numbered lists, fenced code, **bold**, *italic*, `code`, http(s)
 * links and [S1] citation tags. Plain Text nodes only — nothing is ever
 * evaluated as markup.
 */

const base = { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.ink };

function inline(text, key = 'i') {
  const out = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\))|(\[S\d+\])/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const id = `${key}-${k++}`;
    if (m[1]) out.push(<Text key={id} style={{ fontFamily: 'monospace', backgroundColor: colors.primarySoft, color: colors.primary600 }}>{m[1].slice(1, -1)}</Text>);
    else if (m[2]) out.push(<Text key={id} style={{ fontFamily: fonts.bold }}>{inline(m[2].slice(2, -2), id)}</Text>);
    else if (m[3]) out.push(<Text key={id} style={{ fontStyle: 'italic' }}>{m[3].slice(1, -1)}</Text>);
    else if (m[4]) out.push(<Text key={id} style={{ color: colors.primary, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(m[6])}>{m[5]}</Text>);
    else if (m[7]) out.push(<Text key={id} style={{ fontSize: 10, fontFamily: fonts.bold, color: colors.primary }}> {m[7].slice(1, -1)}</Text>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function MarkdownText({ text = '' }) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      blocks.push(
        <View key={blocks.length} style={{ backgroundColor: '#101B2D', borderRadius: 12, padding: 10 }}>
          <Text style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 18, color: '#E2E8F0' }}>{body.join('\n')}</Text>
        </View>
      );
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<Text key={blocks.length} style={[base, { fontFamily: fonts.extrabold, fontSize: 15 }]}>{inline(h[1], `h${i}`)}</Text>);
      i += 1;
      continue;
    }
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const bullet = /\d/.test(li[1]) ? li[1] : '•';
      blocks.push(
        <View key={blocks.length} style={{ flexDirection: 'row', gap: 6, paddingLeft: Math.min(/^\s*/.exec(line)[0].length, 6) * 4 }}>
          <Text style={[base, { color: colors.primary, fontFamily: fonts.bold }]}>{bullet}</Text>
          <Text style={[base, { flex: 1 }]}>{inline(li[2], `l${i}`)}</Text>
        </View>
      );
      i += 1;
      continue;
    }
    // Tables are shown as their rows (readable, no horizontal layout on phones);
    // separator rows like |---|---| and horizontal rules are dropped.
    if (/^[\s|:*-]+$/.test(line) && line.includes('-')) {
      i += 1;
      continue;
    }
    blocks.push(<Text key={blocks.length} style={base}>{inline(line.replace(/^\s*>\s?/, ''), `p${i}`)}</Text>);
    i += 1;
  }
  return <View style={{ gap: 6 }}>{blocks}</View>;
}
