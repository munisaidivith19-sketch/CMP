import { DEFAULT_PRIVACY, PRIVACY_FIELDS } from '../constants.js';
import { sameId } from './permissions.js';
import MentorshipRequest from '../models/MentorshipRequest.js';
import AlumniProfile from '../models/AlumniProfile.js';

/**
 * User fields populated onto alumni-network records (mentorship requests and
 * sessions, jobs, applications, events, RSVPs). Contact fields are populated
 * only so redactParties can decide per viewer; roll / employee numbers are
 * never populated here at all.
 */
export const PARTY_USER_FIELDS = 'name role department year avatar email phone';
const PARTY_CONTACT_FIELDS = ['email', 'phone', 'rollNo', 'employeeId'];
// Internal college staff who may see a campus member's contact details.
const INTERNAL_STAFF = ['admin', 'faculty', 'hod', 'principal', 'dean', 'chairman', 'ao'];
const PRIVACY_STAFF = ['admin', 'hod', 'principal', 'dean', 'chairman', 'ao'];

/** The field-level rule of applyPrivacy, for one privacy level. */
function levelAllows(level, viewer, ownerDepartment, isMentee) {
  if (viewer?.role === 'admin') return true;
  const staff = PRIVACY_STAFF.includes(viewer?.role);
  const hodOk = viewer?.role !== 'hod' || (ownerDepartment && ownerDepartment === viewer.department);
  if (level === 'public') return true;
  if (level === 'mentees') return isMentee || (staff && hodOk);
  if (level === 'staff') return staff && hodOk;
  return false;
}

/**
 * Remove contact details from the users populated at `paths` of `data` (one
 * record or an array, documents or plain objects) that `viewer` may not see:
 *
 * - a campus member (student, staff) shown to someone outside the college
 *   staff — an alumnus or another student — never carries email, phone,
 *   roll number or employee ID;
 * - an alumnus's email / phone follow that alumnus's own privacy settings
 *   (public / mentees / staff / hidden), exactly as in the directory.
 *
 * The viewer always sees their own record in full. Returns plain objects.
 */
export async function redactParties(data, viewer, paths) {
  const list = (Array.isArray(data) ? data : [data]).map((d) => (d && typeof d.toObject === 'function' ? d.toObject() : d));
  const users = [];
  for (const item of list) {
    if (!item) continue;
    for (const p of paths) {
      const u = item[p];
      if (u && typeof u === 'object' && u._id) users.push(u);
    }
  }

  const alumniIds = [...new Set(users.filter((u) => u.role === 'alumni' && !sameId(u._id, viewer?._id)).map((u) => String(u._id)))];
  let privacy = new Map();
  let mentorOf = new Set();
  if (alumniIds.length) {
    const [profiles, accepted] = await Promise.all([
      AlumniProfile.find({ user: { $in: alumniIds } }).select('user privacy').lean(),
      viewer ? MentorshipRequest.find({ student: viewer._id, alumni: { $in: alumniIds }, status: { $in: ['accepted', 'completed'] } }).distinct('alumni') : [],
    ]);
    privacy = new Map(profiles.map((p) => [String(p.user), p.privacy || {}]));
    mentorOf = new Set(accepted.map(String));
  }

  for (const u of users) {
    if (sameId(u._id, viewer?._id)) continue;
    if (u.role === 'alumni') {
      const settings = privacy.get(String(u._id)) || {};
      for (const field of ['email', 'phone']) {
        const level = settings[field] || DEFAULT_PRIVACY[field] || 'hidden';
        if (!levelAllows(level, viewer, u.department, mentorOf.has(String(u._id)))) delete u[field];
      }
      delete u.rollNo;
      delete u.employeeId;
    } else if (!INTERNAL_STAFF.includes(viewer?.role)) {
      PARTY_CONTACT_FIELDS.forEach((f) => delete u[f]);
    }
  }
  return Array.isArray(data) ? list : list[0];
}

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
