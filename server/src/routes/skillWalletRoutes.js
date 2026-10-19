import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { query } from 'express-validator';
import {
  skillWalletCommentLimiter,
  skillWalletContactLimiter,
  skillWalletInviteLimiter,
  skillWalletPublicLimiter,
  skillWalletUploadLimiter,
  skillWalletWriteLimiter,
} from '../middleware/rateLimit.js';
import { SKILL_WALLET_COLLEGE_ROLES, SKILL_WALLET_STUDENT_ROLES, COE_ROLE } from '../constants.js';
import { attachActor } from '../services/skillWallet/access.js';
import * as projects from '../controllers/skillWallet/projectController.js';
import * as team from '../controllers/skillWallet/teamController.js';
import * as publication from '../controllers/skillWallet/publicationController.js';
import * as gallery from '../controllers/skillWallet/galleryController.js';
import * as certs from '../controllers/skillWallet/certificationController.js';
import * as links from '../controllers/skillWallet/linkController.js';
import * as review from '../controllers/skillWallet/reviewController.js';
import * as manage from '../controllers/skillWallet/managementController.js';
import { downloadFile } from '../controllers/skillWallet/fileController.js';

/**
 * Skill Wallet API (/api/skill-wallet). Mounted after protect, the platform
 * gate, the confined-role guard (COE / Office / Transport / Super Admin are
 * deny-by-default) and the admin policy guard — none of which are weakened.
 * Each handler re-checks ownership / membership / designation itself.
 */
const router = Router();
const students = authorize(...SKILL_WALLET_STUDENT_ROLES);
// College users, plus the COE (certificate verification only — see confinedRoleGuard).
const members = authorize(...SKILL_WALLET_COLLEGE_ROLES, COE_ROLE);
const listQuery = [
  query('page').optional().isInt({ min: 1, max: 10000 }),
  query('q').optional().isString().isLength({ max: 64 }),
  query('status').optional().isString().isLength({ max: 30 }),
  validate,
];

router.use(members, attachActor);

// Configuration (options for forms).
router.get('/config', manage.readConfig);
router.put('/config', skillWalletWriteLimiter, manage.updateConfig);

// ── My projects ─────────────────────────────────────────────────────
router.get('/projects', students, ...listQuery, projects.listMyProjects);
router.post('/projects', students, skillWalletWriteLimiter, projects.createProject);
router.post('/assets/project-image', students, skillWalletUploadLimiter, certs.projectImageUpload, projects.uploadProjectImage);
router.get('/projects/:id', projects.getProject);
router.put('/projects/:id', students, skillWalletWriteLimiter, projects.updateProject);
router.delete('/projects/:id', students, skillWalletWriteLimiter, projects.deleteProject);
router.get('/projects/:id/history', projects.projectHistory);
router.post('/projects/:id/submit', students, skillWalletWriteLimiter, projects.submitForReview);
router.post('/projects/:id/withdraw', students, skillWalletWriteLimiter, projects.withdrawSubmission);
router.post('/projects/:id/milestones', students, skillWalletWriteLimiter, projects.addMilestone);

// ── Team & invitations ──────────────────────────────────────────────
router.get('/projects/:id/team', team.getTeam);
router.post('/projects/:id/invitations', students, skillWalletInviteLimiter, team.inviteByRollNo);
router.post('/projects/:id/team/leave', students, skillWalletWriteLimiter, team.leaveTeam);
router.post('/projects/:id/team/transfer', students, skillWalletWriteLimiter, team.transferOwnership);
router.delete('/projects/:id/team/:userId', students, skillWalletWriteLimiter, team.removeMember);
router.get('/invitations', students, ...listQuery, team.listInvitations);
router.post('/invitations/:id/accept', students, skillWalletWriteLimiter, team.acceptInvitation);
router.post('/invitations/:id/decline', students, skillWalletWriteLimiter, team.declineInvitation);
router.delete('/invitations/:id', students, skillWalletWriteLimiter, team.cancelInvitation);

// ── Publication ─────────────────────────────────────────────────────
router.get('/projects/:id/publication', students, publication.getPublication);
router.put('/projects/:id/publication', students, skillWalletWriteLimiter, publication.setPublication);
router.post('/projects/:id/publication/consent', students, skillWalletWriteLimiter, publication.setConsent);

// ── Gallery, interactions, leaderboard, portfolio ───────────────────
router.get('/gallery', ...listQuery, gallery.gallery);
router.get('/gallery/:id', gallery.galleryProjectDetail);
router.get('/leaderboard', gallery.getLeaderboard);
router.post('/projects/:id/like', skillWalletWriteLimiter, gallery.toggleLike);
router.get('/projects/:id/comments', ...listQuery, gallery.listComments);
router.post('/projects/:id/comments', skillWalletCommentLimiter, gallery.addComment);
router.delete('/comments/:id', skillWalletWriteLimiter, gallery.deleteComment);
router.post('/projects/:id/report', skillWalletCommentLimiter, gallery.reportContent);
router.post('/projects/:id/contact', skillWalletContactLimiter, gallery.requestContact);
router.get('/contact-requests', ...listQuery, gallery.listContactRequests);
router.post('/contact-requests/:id/respond', skillWalletWriteLimiter, gallery.respondContact);
router.get('/portfolio/me', students, gallery.portfolio);
router.get('/portfolio/:userId', gallery.portfolio);

// ── NPTEL certifications ────────────────────────────────────────────
router.get('/certifications', students, certs.listMyCertifications);
router.post('/certifications', students, skillWalletUploadLimiter, certs.certificateUpload, certs.createCertification);
router.get('/certifications/:id', students, certs.getMyCertification);
router.put('/certifications/:id', students, skillWalletUploadLimiter, certs.certificateUpload, certs.updateCertification);
router.delete('/certifications/:id', students, skillWalletWriteLimiter, certs.deleteCertification);

// ── Links & profiles ────────────────────────────────────────────────
router.get('/profile-links', students, links.listLinks);
router.post('/profile-links', students, skillWalletWriteLimiter, links.createLink);
router.put('/profile-links/:id', students, skillWalletWriteLimiter, links.updateLink);
router.delete('/profile-links/:id', students, skillWalletWriteLimiter, links.deleteLink);

// ── Faculty review workspace ────────────────────────────────────────
router.get('/review/me', review.myReviewerRoles);
router.get('/review/queue', ...listQuery, review.reviewQueue);
router.get('/review/projects/:id', review.reviewDetail);
router.post('/review/projects/:id/reviews', skillWalletWriteLimiter, review.submitReview);
router.get('/review/certifications', ...listQuery, certs.verifierQueue);
router.get('/review/certifications/:id', certs.verifierDetail);
router.post('/review/certifications/:id/decision', skillWalletWriteLimiter, certs.decideCertification);

// ── Innovation management ───────────────────────────────────────────
router.get('/management/overview', manage.overview);
router.get('/management/projects', ...listQuery, manage.listManagedProjects);
router.get('/management/staff', manage.searchStaff);
router.put('/management/projects/:id/reviewers', skillWalletWriteLimiter, manage.assignReviewers);
router.post('/management/projects/:id/hide', skillWalletWriteLimiter, manage.hideProject);
router.post('/management/projects/:id/unhide', skillWalletWriteLimiter, manage.unhideProject);
router.get('/management/recommendations', ...listQuery, manage.listRecommendations);
router.patch('/management/recommendations/:id', skillWalletWriteLimiter, manage.updateRecommendation);
router.get('/management/milestones', ...listQuery, manage.listMilestones);
router.patch('/management/milestones/:id', skillWalletWriteLimiter, manage.decideMilestone);
router.get('/management/reports', ...listQuery, manage.listReports);
router.patch('/management/reports/:id', skillWalletWriteLimiter, manage.resolveReport);
router.get('/management/designations', manage.listDesignations);
router.post('/management/designations', skillWalletWriteLimiter, manage.grantDesignation);
router.delete('/management/designations/:id', skillWalletWriteLimiter, manage.revokeDesignation);

/**
 * Public (no session) Skill Wallet routes, mounted BEFORE protect:
 * the published public gallery and signed file downloads. GET only.
 */
export const skillWalletPublicRouter = Router();
// Per route (not router.use): authenticated /skill-wallet traffic also passes through this router.
skillWalletPublicRouter.get('/public/gallery', skillWalletPublicLimiter, ...listQuery, gallery.publicGallery);
skillWalletPublicRouter.get('/public/gallery/:id', skillWalletPublicLimiter, gallery.publicProjectDetail);
skillWalletPublicRouter.get('/public/leaderboard', skillWalletPublicLimiter, gallery.publicLeaderboard);
skillWalletPublicRouter.get('/files/:token', skillWalletPublicLimiter, downloadFile);

export default router;
