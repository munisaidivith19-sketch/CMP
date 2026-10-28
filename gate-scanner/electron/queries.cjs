'use strict';
// History / attempts query strings, built in the main process from a fixed
// set of keys so the page can never reach any other endpoint or parameter.

const RANGES = ['today', 'yesterday', 'week', 'month', 'custom'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function historyQuery(params = {}, { outcome = false } = {}) {
  const q = new URLSearchParams();
  const p = params && typeof params === 'object' ? params : {};
  q.set('range', RANGES.includes(p.range) ? p.range : 'today');
  if (p.range === 'custom') {
    if (DAY.test(String(p.from || ''))) q.set('from', p.from);
    if (DAY.test(String(p.to || ''))) q.set('to', p.to);
  }
  if (p.type === 'in' || p.type === 'out') q.set('type', p.type);
  if (outcome && ['success', 'rejected', 'duplicate'].includes(p.outcome)) q.set('outcome', p.outcome);
  const search = typeof p.q === 'string' ? p.q.trim().slice(0, 64) : '';
  if (search) q.set('q', search);
  const page = Number(p.page);
  q.set('page', String(Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1));
  const limit = Number(p.limit);
  q.set('limit', String(Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 25));
  return q.toString();
}

module.exports = { historyQuery };
