// Pure notification-link mapping (no React Native imports, so it can be unit-tested with node).

/** Web screens that have no mobile equivalent: tapping the notification just marks it read. */
const WEB_ONLY = ['/admin/reports', '/admin/clubs', '/admin/users', '/admin/activity', '/admin/security', '/admin/academics', '/admin/attendance', '/admin/complaints', '/dev/otp'];

/**
 * The app route for a notification link. Links are shared with the web app;
 * most map 1:1, a few web tabs live on their own mobile screen, and web-only
 * pages (or anything that is not an in-app path) return null.
 */
export function mobileRoute(link) {
  if (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//')) return null;
  const [path, query = ''] = link.split('?');
  const tab = new URLSearchParams(query).get('tab');
  if (path === '/attendance' && tab === 'od-leave') return '/od-leave';
  if (WEB_ONLY.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return link;
}
