/**
 * Who may see which bus. Used by every transport API AND by the Socket.IO
 * room checks, so the map and the live stream can never disagree.
 *
 * - Roles outside TRANSPORT_VIEW_ROLES (alumni, COE, Office): nothing.
 * - Students: every active bus when the institution sets
 *   TRANSPORT_STUDENT_VISIBILITY=all (default); with `assigned`, only the
 *   route / bus on their transport assignment.
 * - Staff with transport access: every active bus.
 * The account is re-read from the database, so a deactivated user loses
 * access at once — including on an already-open socket.
 */
import Bus from '../../models/Bus.js';
import TransportAssignment from '../../models/TransportAssignment.js';
import User from '../../models/User.js';
import { TRANSPORT_MANAGE_ROLES, TRANSPORT_VIEW_ROLES } from '../../constants.js';
import { transportConfig } from './config.js';

const STUDENTS = ['student', 'club_admin'];

/** { all: true } | { routes, buses } | null (no access). */
export async function viewerScope(userOrId) {
  const user = userOrId?.role ? userOrId : await User.findById(userOrId).select('role isActive stayType').lean();
  if (!user || user.isActive === false || !TRANSPORT_VIEW_ROLES.includes(user.role)) return null;
  if (STUDENTS.includes(user.role)) {
    // Bus tracking is for day scholars only. Re-read the stay type from the
    // database so a hosteler (or a student with none recorded) never gets
    // access, on the REST API or an already-open socket.
    const fresh = await User.findById(user._id).select('stayType').lean();
    if (fresh?.stayType !== 'day_scholar') return null;
  }
  if (STUDENTS.includes(user.role) && transportConfig().studentVisibility === 'assigned') {
    const a = await TransportAssignment.findOne({ user: user._id }).select('route bus').lean();
    return { routes: a?.route ? [String(a.route)] : [], buses: a?.bus ? [String(a.bus)] : [] };
  }
  return { all: true };
}

/** Mongo filter over Bus for a scope (active buses only for non-managers). */
export function busFilter(scope, user) {
  const manage = TRANSPORT_MANAGE_ROLES.includes(user?.role);
  const base = manage ? {} : { isActive: true };
  if (!scope) return { _id: null };
  if (scope.all) return base;
  return { ...base, $or: [{ _id: { $in: scope.buses } }, { route: { $in: scope.routes } }] };
}

export function scopeAllows(scope, bus) {
  if (!scope || !bus) return false;
  if (scope.all) return true;
  return scope.buses.includes(String(bus._id)) || (bus.route && scope.routes.includes(String(bus.route._id || bus.route)));
}

export async function canViewBus(user, busId) {
  const scope = await viewerScope(user);
  if (!scope) return false;
  const bus = await Bus.findById(busId).select('route isActive').lean();
  if (!bus || (!bus.isActive && !TRANSPORT_MANAGE_ROLES.includes(user.role))) return false;
  return scopeAllows(scope, bus);
}
