import SkillWalletDesignation from '../../models/SkillWalletDesignation.js';
import TeamMembership from '../../models/TeamMembership.js';
import { COE_ROLE, SKILL_WALLET_COLLEGE_ROLES, SKILL_WALLET_STUDENT_ROLES } from '../../constants.js';
import { ApiError } from '../../utils/http.js';

/**
 * Skill Wallet authorization. Every route and every asset download decides
 * access here, from the database — never from anything the client sends.
 *
 * An "actor" is the signed-in user plus their live Skill Wallet designations
 * (loaded once per request). Role alone grants very little on purpose:
 *   - students own their projects / certificates / links;
 *   - reviewers see a project only once it was submitted, and only when
 *     assigned, a coordinator in scope, or the HOD of its department;
 *   - certificate verifiers: COE (campus), HOD (own department), the Class
 *     In-Charge of the student's class, or a designated verifier in scope;
 *   - innovation coordinators are designated by the Principal. The Principal
 *     and the Super Admin get NO review / verification / publication rights
 *     from their role.
 */

const sid = (v) => String(v?._id || v || '');
export const sameId = (a, b) => Boolean(a && b && sid(a) === sid(b));

export const isStudent = (user) => SKILL_WALLET_STUDENT_ROLES.includes(user?.role);
export const isCollegeUser = (user) => Boolean(user?.isActive !== false && SKILL_WALLET_COLLEGE_ROLES.includes(user?.role));

/** The signed-in user plus their live designations. */
export async function buildActor(user) {
  if (!user) return { user: null, designations: [] };
  const designations = await SkillWalletDesignation.find({ user: user._id, revokedAt: null }).lean();
  return { user, designations };
}

/** Express middleware: req.swActor for the Skill Wallet router. */
export async function attachActor(req, _res, next) {
  try {
    req.swActor = await buildActor(req.user);
    next();
  } catch (err) {
    next(err);
  }
}

/** Does the actor hold `capability` covering `department` (campus scope covers all)? */
export function hasDesignation(actor, capability, department) {
  return (actor?.designations || []).some(
    (d) => d.capability === capability && (d.scope === 'campus' || (department && d.department === department))
  );
}

export const isCoordinator = (actor, department) => hasDesignation(actor, 'innovation_coordinator', department);
export const isAnyCoordinator = (actor) => (actor?.designations || []).some((d) => d.capability === 'innovation_coordinator');
/** Departments a department-scoped coordinator manages; null = campus-wide. */
export function coordinatorScope(actor) {
  const ds = (actor?.designations || []).filter((d) => d.capability === 'innovation_coordinator');
  if (ds.some((d) => d.scope === 'campus')) return null;
  return ds.map((d) => d.department).filter(Boolean);
}

export async function activeMembership(projectId, userId) {
  if (!projectId || !userId) return null;
  return TeamMembership.findOne({ project: projectId, user: userId, status: 'active' }).lean();
}

export const activeMemberIds = (projectId) =>
  TeamMembership.find({ project: projectId, status: 'active' }).distinct('user');

const reviewOpened = (project) => Boolean(project?.review?.submittedRevision);

/** Reviewer-side access to a submitted project (never to drafts). */
export function canReviewProject(actor, project) {
  const user = actor?.user;
  if (!user || !project || project.isDeleted || !reviewOpened(project)) return false;
  if (isStudent(user)) return false;
  if ((project.review?.reviewers || []).some((r) => sameId(r, user))) return true;
  if (isCoordinator(actor, project.department)) return true;
  return user.role === 'hod' && Boolean(user.department) && user.department === project.department;
}

/**
 * May the actor record a review decision? The same people who may review: an
 * assigned reviewer, a coordinator in scope, or the department's HOD.
 */
export const canDecideProject = canReviewProject;

/**
 * The actor's relationship to a project. `member` includes the owner.
 * Pending invitations grant nothing.
 */
export async function projectRelation(actor, project) {
  const user = actor?.user;
  if (!user || !project || project.isDeleted) return { owner: false, member: false, reviewer: false };
  const owner = sameId(project.owner, user);
  const member = owner || Boolean(await activeMembership(project._id, user._id));
  return { owner, member, reviewer: canReviewProject(actor, project) };
}

/** Throws 404 (not 403: never confirm a private project exists) unless member or reviewer. */
export async function assertProjectAccess(actor, project) {
  const rel = await projectRelation(actor, project);
  if (!rel.member && !rel.reviewer) throw new ApiError(404, 'Project not found');
  return rel;
}

/** Audience filter for published gallery content. null user = internet visitor. */
export function galleryAudience(user) {
  if (isCollegeUser(user)) return { $in: ['college', 'public'] };
  return 'public';
}

/** Can this viewer see the PUBLISHED copy of a project? */
export function canViewPublished(user, project) {
  if (!project || project.isDeleted || !project.published || project.moderation?.hidden) return false;
  if (project.visibility === 'public') return true;
  return project.visibility === 'college' && isCollegeUser(user);
}

/** NPTEL verification rights over one certificate (never the student themself). */
export function canVerifyCertificate(actor, cert) {
  const user = actor?.user;
  if (!user || !cert || sameId(cert.student, user) || isStudent(user)) return false;
  if (user.role === COE_ROLE) return true;
  if (hasDesignation(actor, 'certificate_verifier', cert.department)) return true;
  if (user.role === 'hod') return Boolean(user.department) && user.department === cert.department;
  if (user.role === 'faculty') {
    return Boolean(
      user.section && user.inChargeYear && user.department === cert.department && user.section === cert.section && Number(user.inChargeYear) === Number(cert.year)
    );
  }
  return false;
}

/** Mongo filter of the certificates this actor may verify (for queues). Null = none. */
export function verifierQueueFilter(actor) {
  const user = actor?.user;
  if (!user || isStudent(user)) return null;
  if (user.role === COE_ROLE) return {};
  const ors = [];
  const ds = (actor.designations || []).filter((d) => d.capability === 'certificate_verifier');
  if (ds.some((d) => d.scope === 'campus')) return {};
  for (const d of ds) if (d.department) ors.push({ department: d.department });
  if (user.role === 'hod' && user.department) ors.push({ department: user.department });
  if (user.role === 'faculty' && user.section && user.inChargeYear) {
    ors.push({ department: user.department, section: user.section, year: Number(user.inChargeYear) });
  }
  if (!ors.length) return null;
  return { $or: ors, student: { $ne: user._id } };
}

/** Mongo filter for the projects an actor may review (queue). Null = none. */
export function reviewerQueueFilter(actor) {
  const user = actor?.user;
  if (!user || isStudent(user)) return null;
  const ors = [{ 'review.reviewers': user._id }];
  const scope = coordinatorScope(actor);
  if (isAnyCoordinator(actor)) {
    if (scope === null) return { 'review.submittedRevision': { $ne: null } };
    if (scope.length) ors.push({ department: { $in: scope } });
  }
  if (user.role === 'hod' && user.department) ors.push({ department: user.department });
  return { 'review.submittedRevision': { $ne: null }, $or: ors };
}

/** Is this user one who may hold a Skill Wallet staff designation / be assigned as reviewer? */
export const isReviewerEligible = (user) => ['faculty', 'hod', 'principal', 'dean'].includes(user?.role) && user?.isActive !== false;
