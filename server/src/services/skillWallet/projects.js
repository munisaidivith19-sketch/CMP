import mongoose from 'mongoose';
import InnovationProject, { CONTENT_KEYS, MATERIAL_KEYS } from '../../models/InnovationProject.js';
import TeamMembership from '../../models/TeamMembership.js';
import ProjectPublicationEvent from '../../models/ProjectPublicationEvent.js';
import { ApiError } from '../../utils/http.js';
import { SW_PROJECT_MODES, SW_PROJECT_STAGES } from '../../constants.js';
import { activeKeys, labelOf } from './config.js';
import { githubRepoUrl, googleDriveUrl } from './urls.js';
import { assetUrl } from './assets.js';

const { isValidObjectId } = mongoose;

export const MAX_SKILLS = 20;
export const MAX_PROJECTS_PER_STUDENT = 50;

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Calendar date (YYYY-MM-DD or ISO) → UTC midnight Date. */
export function parseDay(value, label) {
  if (blank(value)) return null;
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) throw new ApiError(422, `${label} must be a valid date (YYYY-MM-DD)`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) throw new ApiError(422, `${label} must be a valid date`);
  if (d.getUTCFullYear() < 1990) throw new ApiError(422, `${label} is too far in the past`);
  return d;
}

/** Latest calendar day accepted as "not in the future" (one day of timezone slack). */
const latestDay = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
};

export function parseSkills(value) {
  if (blank(value)) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  if (list.length > 60) throw new ApiError(422, `List at most ${MAX_SKILLS} skills`);
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string' && typeof raw !== 'number') throw new ApiError(422, 'Skills must be text');
    const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) continue;
    if (s.length > 40) throw new ApiError(422, 'Each skill must be 40 characters or fewer');
    if (!/^[\p{L}\p{N} +#.\-/&()]+$/u.test(s)) throw new ApiError(422, `Skill "${s.slice(0, 20)}" contains unsupported characters`);
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > MAX_SKILLS) throw new ApiError(422, `List at most ${MAX_SKILLS} skills`);
  return out;
}

const text = (v, label, { min = 0, max }) => {
  if (blank(v)) {
    if (min) throw new ApiError(422, `${label} is required`);
    return '';
  }
  if (typeof v !== 'string') throw new ApiError(422, `${label} must be text`);
  const s = v.trim();
  if (s.length < min) throw new ApiError(422, `${label} must be at least ${min} characters`);
  if (s.length > max) throw new ApiError(422, `${label} must be at most ${max} characters`);
  return s;
};

/**
 * Validate project content on the SERVER. On update, `existing` is the
 * current project and only the fields present in `body` change — but the
 * merged result is validated as a whole, so the stage / end-date rules hold
 * whatever combination a client sends:
 *   developing  → end date must be absent; any stored end date is cleared;
 *   implemented → end date required, not before the start, not in the future.
 */
export function parseProjectInput(body, config, existing = null) {
  const src = body || {};
  const out = {};
  const want = (k) => !existing || has(src, k);

  if (want('title')) out.title = text(src.title, 'Project title', { min: 3, max: 140 });
  if (want('description')) out.description = text(src.description, 'Project description', { min: 10, max: 5000 });
  if (want('domain')) {
    const d = String(src.domain ?? '').trim();
    // An existing project may keep a domain that was later retired.
    if (!activeKeys(config.domains).includes(d) && !(existing && existing.domain === d)) {
      throw new ApiError(422, 'Choose a valid project domain');
    }
    out.domain = d;
  }
  if (want('skills')) out.skills = parseSkills(src.skills);
  if (want('stage')) {
    if (!SW_PROJECT_STAGES.includes(src.stage)) throw new ApiError(422, 'Development stage must be "developing" or "implemented"');
    out.stage = src.stage;
  }
  if (want('startedAt')) {
    out.startedAt = parseDay(src.startedAt, 'Start date');
    if (!out.startedAt) throw new ApiError(422, 'Start date is required');
  }
  if (has(src, 'endedAt')) out.endedAt = parseDay(src.endedAt, 'End date');
  if (want('githubUrl')) out.githubUrl = githubRepoUrl(src.githubUrl);
  if (want('driveUrl')) out.driveUrl = googleDriveUrl(src.driveUrl);
  if (!existing) {
    const mode = src.mode ?? 'solo';
    if (!SW_PROJECT_MODES.includes(mode)) throw new ApiError(422, 'Project mode must be "solo" or "team"');
    out.mode = mode;
  }

  // Stage / end-date rules on the merged state.
  const stage = out.stage ?? existing?.stage;
  const startedAt = out.startedAt ?? existing?.startedAt;
  if (stage === 'developing') {
    if (has(src, 'endedAt') && out.endedAt) {
      throw new ApiError(422, 'A project that is still developing cannot have an end date');
    }
    out.endedAt = null;
  } else if (stage === 'implemented') {
    const endedAt = has(src, 'endedAt') ? out.endedAt : existing?.endedAt ?? null;
    if (!endedAt) throw new ApiError(422, 'End date is required for an implemented project');
    if (startedAt && endedAt < startedAt) throw new ApiError(422, 'End date cannot be earlier than the start date');
    if (endedAt > latestDay()) throw new ApiError(422, 'End date cannot be in the future');
    out.endedAt = endedAt;
  }
  if (startedAt && startedAt > latestDay()) throw new ApiError(422, 'Start date cannot be in the future');
  return out;
}

export const assertObjectId = (id, label = 'id') => {
  if (!isValidObjectId(id) || String(id).length !== 24) throw new ApiError(400, `Invalid ${label}`);
};

export async function loadProject(id, { lean = false } = {}) {
  assertObjectId(id, 'project id');
  const q = InnovationProject.findOne({ _id: id, isDeleted: false });
  const project = lean ? await q.lean() : await q;
  if (!project) throw new ApiError(404, 'Project not found');
  return project;
}

const sameVal = (a, b) => {
  if (a instanceof Date || b instanceof Date) return (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) === JSON.stringify(b || []);
  return String(a ?? '') === String(b ?? '');
};

/** Which content keys `next` changes, and whether any is material. */
export function diffContent(project, next) {
  const changed = CONTENT_KEYS.filter((k) => has(next, k) && !sameVal(project[k], next[k]));
  return { changed, material: changed.some((k) => MATERIAL_KEYS.includes(k)) };
}

export const contentOf = (p) => Object.fromEntries(CONTENT_KEYS.map((k) => [k, p[k] ?? null]));

/** The gallery copy of the live content at its current revision. */
export const snapshotOf = (p) => ({ ...contentOf(p), skills: [...(p.skills || [])], revision: p.revision, publishedAt: new Date() });

export function logPublication(project, actor, action, { from = null, to = null, note, revision } = {}) {
  return ProjectPublicationEvent.create({
    project: project._id,
    actor: actor._id,
    action,
    revision: revision ?? project.revision,
    from,
    to,
    note,
  }).catch((err) => console.error('[skill-wallet] publication event failed:', err.message));
}

/** Active team (owner first) with display fields only. */
export async function teamOf(projectId, { staffView = false } = {}) {
  const fields = staffView ? 'name title department year section rollNo avatar' : 'name title department year avatar';
  const rows = await TeamMembership.find({ project: projectId, status: 'active' }).populate('user', fields).sort({ role: -1, joinedAt: 1 }).lean();
  return rows.filter((r) => r.user).map((r) => ({ role: r.role, joinedAt: r.joinedAt, user: r.user }));
}

const domainView = (config, key) => ({ key, label: labelOf(config.domains, key) });

/** Full view for team members (owner included). Reviewer-only notes never appear here. */
export function memberView(p, { viewer, config, team = [], relation = {} }) {
  const owner = relation.owner;
  return {
    _id: p._id,
    mode: p.mode,
    title: p.title,
    domain: domainView(config, p.domain),
    description: p.description,
    skills: p.skills || [],
    stage: p.stage,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    githubUrl: p.githubUrl,
    driveUrl: p.driveUrl,
    imageUrl: assetUrl(p.image, viewer),
    hasImage: Boolean(p.image),
    revision: p.revision,
    visibility: p.visibility,
    published: p.published
      ? { revision: p.published.revision, publishedAt: p.published.publishedAt, title: p.published.title, imageUrl: assetUrl(p.published.image, viewer) }
      : null,
    publicRequest: p.publicRequest
      ? {
          revision: p.publicRequest.revision,
          requestedAt: p.publicRequest.requestedAt,
          consentedBy: (p.publicRequest.consents || []).map((c) => String(c.user)),
        }
      : null,
    review: {
      status: p.review?.status || 'draft',
      submittedRevision: p.review?.submittedRevision ?? null,
      submittedAt: p.review?.submittedAt,
      approvedRevision: p.review?.approvedRevision ?? null,
      decidedAt: p.review?.decidedAt,
      currentRevisionApproved: p.review?.approvedRevision === p.revision,
    },
    facultyScore: p.facultyScore,
    hidden: Boolean(p.moderation?.hidden),
    hiddenReason: p.moderation?.hidden ? p.moderation.reason || '' : undefined,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    team,
    memberCount: p.memberCount ?? team.length,
    isOwner: owner,
    canEdit: Boolean(relation.member),
    canManage: owner,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Gallery view of the PUBLISHED copy only. No user IDs, roll numbers, hall
 * tickets, reviewer notes, invitations or private files. `publicView` (an
 * internet visitor) also drops team departments' class detail.
 */
export function galleryView(p, { viewer, config, team = [], likedByMe = false, publicView = false }) {
  const pub = p.published || {};
  return {
    _id: p._id,
    title: pub.title,
    domain: domainView(config, pub.domain),
    description: pub.description,
    skills: pub.skills || [],
    stage: pub.stage,
    startedAt: pub.startedAt,
    endedAt: pub.endedAt,
    githubUrl: pub.githubUrl,
    driveUrl: pub.driveUrl,
    imageUrl: pub.image ? assetUrl(pub.image, publicView ? null : viewer) : null,
    publishedAt: pub.publishedAt,
    visibility: p.visibility,
    mode: p.mode,
    department: p.department,
    year: publicView ? undefined : p.year,
    team: team.map((t) => ({ name: t.user.name, title: t.user.title, role: t.role, department: t.user.department, ...(publicView ? {} : { avatar: t.user.avatar }) })),
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    facultyScore: p.facultyScore == null ? null : Math.round(p.facultyScore),
    likedByMe: publicView ? undefined : likedByMe,
  };
}
