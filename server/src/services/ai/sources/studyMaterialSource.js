import StudyMaterial from '../../../models/StudyMaterial.js';
import StudyMaterialChunk from '../../../models/StudyMaterialChunk.js';
import { materialReadFilter } from '../../../utils/studyMaterialScope.js';
import { indexMaterial, needsIndex } from '../pdfIndexer.js';

/**
 * Source 1 — JNN Study Materials (RAG).
 *
 * Authorization boundary: the set of material ids the AUTHENTICATED user may
 * read, computed with the exact same filter as the Study Materials list
 * endpoint. Chunk search is restricted to those ids, and every hit is checked
 * against the set again before it can enter the model's context.
 */

const MAX_ACCESSIBLE = 2000;
const LAZY_INDEX_PER_REQUEST = 3;
const LAZY_INDEX_WAIT_MS = 8000;
const MIN_SCORE = 0.6;

export const type = 'study_material';

export async function retrieve({ user, query, limit = 6 }) {
  const search = String(query || '').slice(0, 400);
  if (!search.trim()) return [];

  const accessible = await StudyMaterial.find(materialReadFilter(user))
    .select('_id title file aiIndex subjectCode')
    .sort({ createdAt: -1 })
    .limit(MAX_ACCESSIBLE)
    .lean();
  if (!accessible.length) return [];

  // Materials uploaded before the assistant existed get indexed on first use.
  const stale = accessible.filter(needsIndex).slice(0, LAZY_INDEX_PER_REQUEST);
  if (stale.length) {
    let timer;
    await Promise.race([
      Promise.all(stale.map((m) => indexMaterial(m._id))),
      new Promise((r) => {
        timer = setTimeout(r, LAZY_INDEX_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  const byId = new Map(accessible.map((m) => [String(m._id), m]));
  const hits = await StudyMaterialChunk.find(
    { $text: { $search: search }, material: { $in: [...byId.keys()] } },
    { score: { $meta: 'textScore' }, material: 1, page: 1, text: 1 }
  )
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit * 4)
    .lean();

  const perPage = new Map();
  const out = [];
  for (const h of hits) {
    const material = byId.get(String(h.material));
    if (!material || h.score < MIN_SCORE) continue; // defense in depth: never outside the user's scope
    const key = `${h.material}|${h.page}`;
    if ((perPage.get(key) || 0) >= 2) continue;
    perPage.set(key, (perPage.get(key) || 0) + 1);
    out.push({
      text: h.text,
      source: {
        type: 'study_material',
        title: material.file?.name || material.title,
        publisher: [material.title, material.subjectCode].filter(Boolean).join(' · ') || undefined,
        page: Number.isInteger(h.page) ? h.page : undefined,
        url: material.file?.url || undefined,
        materialId: material._id,
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}
