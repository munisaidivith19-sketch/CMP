import * as studyMaterials from './studyMaterialSource.js';
import * as datasets from './datasetSource.js';

/**
 * Pluggable retrieval providers for the Study Assistant. Each provider
 * exports `type` and `retrieve({ user, query, limit })` returning
 * [{ text, source }]. To add a new resource provider, implement that shape
 * and register it here. (Web research is not a provider here — it runs inside
 * Groq via the browser_search tool; see groqService.js.)
 */
export const PROVIDERS = [studyMaterials, datasets];

/**
 * Run every allowed provider in parallel. One provider failing never sinks
 * the others; failures are reported so the answer can say so honestly.
 */
export async function gatherContext({ user, query, allow = {}, limits = {} }) {
  const enabled = PROVIDERS.filter((p) => allow[p.type] !== false);
  const settled = await Promise.allSettled(enabled.map((p) => p.retrieve({ user, query, limit: limits[p.type] })));
  const items = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else {
      failed.push(enabled[i].type);
      console.warn(`[ai] ${enabled[i].type} retrieval failed: ${r.reason?.name || 'error'}`);
    }
  });
  return { items, failed };
}
