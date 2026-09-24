import { broadcast } from '../config/socket.js';

// First path segment → realtime entity name.
const ENTITIES = { announcements: 'announcement', events: 'event', clubs: 'club', discussions: 'discussion' };
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * After a successful write to announcements / events / clubs / discussions,
 * tell every connected client (web and Android) that the data changed so they
 * refetch through the REST API — which still applies each user's visibility
 * rules. Only the entity name, id and action are sent, never content.
 */
export function realtimeChanges(req, res, next) {
  if (!WRITE_METHODS.has(req.method)) return next();
  const [, first, id] = req.path.split('/');
  const entity = ENTITIES[first];
  if (!entity) return next();

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    broadcast(`${entity}:changed`, {
      entity,
      id: id && /^[a-f\d]{24}$/i.test(id) ? id : null,
      action: req.method === 'POST' && !id ? 'created' : req.method === 'DELETE' && req.path.split('/').length === 3 ? 'deleted' : 'updated',
      by: String(req.user?._id || ''),
    });
  });
  return next();
}
