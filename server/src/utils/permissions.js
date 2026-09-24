import { MODERATOR_ROLES } from '../constants.js';

const idOf = (v) => (v && v._id ? v._id : v);

/** Compare two ids / populated docs safely. */
export const sameId = (a, b) => Boolean(a && b && String(idOf(a)) === String(idOf(b)));

export const isModerator = (user) => MODERATOR_ROLES.includes(user?.role);

export function canManageClub(user, club) {
  if (!user || !club) return false;
  if (user.role === 'admin') return true;
  if (club.admins?.some((a) => sameId(a, user))) return true;
  return sameId(club.facultyAdvisor, user);
}

export function canManageEvent(user, event, club) {
  if (!user || !event) return false;
  if (user.role === 'admin') return true;
  if (sameId(event.organizer, user)) return true;
  return club ? canManageClub(user, club) : false;
}
