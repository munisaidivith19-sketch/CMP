import { APPROVED_DATASETS } from '../../../data/aiDatasets.js';

/**
 * Source 3 — approved datasets / structured resources.
 *
 * Only entries from the reviewed catalog in data/aiDatasets.js are ever
 * offered; nothing is downloaded from the internet. The model receives the
 * catalog description (not the data itself) so it can point students to a
 * relevant, approved dataset and cite it honestly.
 */

export const type = 'dataset';

const tokens = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9+#.-]{2,}/g) || []);

export async function retrieve({ query, limit = 2 }) {
  const lower = String(query || '').toLowerCase();
  const q = tokens(lower);
  if (!q.size) return [];
  return APPROVED_DATASETS.map((d) => ({
    d,
    score: d.keywords.filter((k) => (k.includes(' ') ? lower.includes(k) : q.has(k))).length,
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d }) => ({
      text: `${d.name} (${d.publisher}): ${d.description}`,
      source: { type: 'dataset', title: d.name, url: d.url, publisher: d.publisher },
    }));
}
