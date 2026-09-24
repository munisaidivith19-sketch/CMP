import Club from '../models/Club.js';
import User from '../models/User.js';
import { isModerator } from './permissions.js';

/** Mongo filter for announcements a user may see. */
export function announcementVisibility(user) {
  if (isModerator(user)) return {};
  const or = [
    { 'audience.scope': 'all' },
    { author: user._id },
    { 'audience.scope': 'club', 'audience.club': { $in: user.clubs || [] } },
  ];
  if (user.department) or.push({ 'audience.scope': 'department', 'audience.department': user.department });
  if (user.year) or.push({ 'audience.scope': 'year', 'audience.year': user.year });
  return { $or: or };
}

/** Resolve the user ids that belong to an announcement audience. */
export async function audienceUserIds(audience = {}) {
  const base = { isActive: true };
  switch (audience.scope) {
    case 'department':
      return User.find({ ...base, department: audience.department }).distinct('_id');
    case 'year':
      return User.find({ ...base, year: audience.year }).distinct('_id');
    case 'club': {
      const club = await Club.findById(audience.club).select('members admins').lean();
      return club ? [...club.members, ...club.admins] : [];
    }
    default:
      return User.find(base).distinct('_id');
  }
}
