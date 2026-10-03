import { DEFAULT_PRIVACY, PRIVACY_FIELDS } from '../constants.js';
import { sameId } from './permissions.js';
import MentorshipRequest from '../models/MentorshipRequest.js';

/**
 * Applies field-level privacy settings to an alumni profile.
 * - public: visible to all authenticated users
 * - mentees: visible to accepted/completed mentees + staff
 * - staff: visible to admin, HOD (own dept), principal, dean, chairman, ao
 * - hidden: visible only to the profile owner (and admin)
 *
 * Never leaks `privacy` object, `rejectionReason`, or raw contacts to unauthorized viewers.
 */
export function applyPrivacy(profileDoc, viewer, { isMentee = false } = {}) {
  if (!profileDoc) return null;
  const profile = profileDoc.toObject ? profileDoc.toObject() : JSON.parse(JSON.stringify(profileDoc));

  const owner = viewer && sameId(profile.user?._id || profile.user, viewer._id || viewer);
  const staff = ['admin', 'hod', 'principal', 'dean', 'chairman', 'ao'].includes(viewer?.role);
  const hodOk = viewer?.role !== 'hod' || (profile.user?.department && profile.user.department === viewer.department);

  const canView = (level) => {
    if (owner || viewer?.role === 'admin') return true;
    if (level === 'public') return true;
    if (level === 'mentees') return isMentee || (staff && hodOk);
    if (level === 'staff') return staff && hodOk;
    return false;
  };

  for (const field of PRIVACY_FIELDS) {
    const level = profile.privacy?.[field] || DEFAULT_PRIVACY[field] || 'public';
    const allowed = canView(level);

    if (field === 'email' || field === 'phone') {
      if (!allowed && profile.user && typeof profile.user === 'object') {
        delete profile.user[field];
      }
    } else if (!allowed) {
      profile[field] = undefined;
    }
  }

  // Hide internal settings from non-owners (unless admin)
  if (!owner && viewer?.role !== 'admin') {
    delete profile.privacy;
    delete profile.rejectionReason;
  }

  profile.privacyApplied = true;
  return profile;
}

/**
 * Batch applies privacy across an array of alumni profiles, resolving
 * mentee status in a single query to eliminate N+1 query overhead.
 */
export async function batchApplyPrivacy(profiles, viewer) {
  if (!profiles || !profiles.length) return [];
  if (!viewer) return profiles.map((p) => applyPrivacy(p, null));

  const alumniUserIds = profiles.map((p) => p.user?._id || p.user).filter(Boolean);

  let menteeSet = new Set();
  if (['student', 'club_admin'].includes(viewer.role)) {
    const acceptedRequests = await MentorshipRequest.find({
      student: viewer._id,
      alumni: { $in: alumniUserIds },
      status: { $in: ['accepted', 'completed'] },
    }).distinct('alumni');
    menteeSet = new Set(acceptedRequests.map(String));
  }

  return profiles.map((p) => {
    const aId = String(p.user?._id || p.user);
    return applyPrivacy(p, viewer, { isMentee: menteeSet.has(aId) });
  });
}
