import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import SkillWalletAsset from '../../models/SkillWalletAsset.js';
import InnovationProject from '../../models/InnovationProject.js';
import NptelCertification from '../../models/NptelCertification.js';
import { putPrivate, removePrivate } from '../../utils/privateStorage.js';
import { canVerifyCertificate, canViewPublished, projectRelation, sameId } from './access.js';

/**
 * Signed, short-lived asset URLs.
 *
 * A URL is only ever minted AFTER the API authorized the viewer, and it is
 * bound to that viewer (or to "public" for an internet visitor). The download
 * route re-runs the authorization below with the bound identity, so an
 * unpublished project, a revoked membership or a deleted asset stops working
 * at once — a leaked URL is no broader than its viewer and dies within
 * SKILL_WALLET_ASSET_URL_MINUTES anyway.
 */
const KEY = crypto
  .createHash('sha256')
  .update(env.skillWallet.assetUrlSecret || `skill-wallet-asset-url:${env.accessSecret}`)
  .digest();

const b64 = (s) => Buffer.from(s).toString('base64url');
const mac = (payload) => crypto.createHmac('sha256', KEY).update(payload).digest('base64url');

/** Opaque token for one asset + viewer ('p' = public visitor). */
export function signAssetToken(assetId, viewerId) {
  const exp = Math.floor(Date.now() / 1000) + env.skillWallet.assetUrlMinutes * 60;
  const payload = `${assetId}.${viewerId || 'p'}.${exp}`;
  return `${b64(payload)}.${mac(payload)}`;
}

export function assetUrl(assetId, viewer) {
  if (!assetId) return null;
  return `/api/skill-wallet/files/${signAssetToken(String(assetId), viewer ? String(viewer._id || viewer) : 'p')}`;
}

/** { assetId, viewerId|null } or null when forged / expired / malformed. */
export function verifyAssetToken(token) {
  if (typeof token !== 'string' || token.length > 400) return null;
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  let payload;
  try {
    payload = Buffer.from(p, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = mac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [assetId, viewer, exp] = payload.split('.');
  if (!/^[a-f0-9]{24}$/.test(assetId) || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return null;
  if (viewer !== 'p' && !/^[a-f0-9]{24}$/.test(viewer)) return null;
  return { assetId, viewerId: viewer === 'p' ? null : viewer };
}

/**
 * Independent authorization of one asset for one actor (actor.user may be
 * null for a public visitor). Knowing the asset ID is never enough.
 */
export async function canViewAsset(actor, asset) {
  if (!asset || asset.status === 'deleted') return false;
  const user = actor?.user || null;
  if (asset.status === 'pending') return Boolean(user && sameId(asset.owner, user));

  if (asset.kind === 'certificate') {
    if (!user) return false;
    const cert = await NptelCertification.findById(asset.certification).lean();
    if (!cert || cert.isDeleted || !sameId(cert.image, asset._id)) return false;
    return sameId(cert.student, user) || canVerifyCertificate(actor, cert);
  }

  const project = await InnovationProject.findById(asset.project).lean();
  if (!project || project.isDeleted) return false;
  // Gallery viewers may see ONLY the image of the published copy.
  if (project.published?.image && sameId(project.published.image, asset._id) && canViewPublished(user, project)) return true;
  if (!user) return false;
  const rel = await projectRelation(actor, project);
  // Members see the live and published images; reviewers the live one.
  if (rel.member) return sameId(project.image, asset._id) || sameId(project.published?.image, asset._id);
  return rel.reviewer && sameId(project.image, asset._id);
}

/** Store processed image bytes privately and record the asset row (cleaned up on failure). */
export async function storeAsset({ owner, kind, image, project = null, certification = null, status = 'pending' }) {
  const storageKey = await putPrivate(image.buffer, image.ext, image.mimeType);
  try {
    return await SkillWalletAsset.create({
      owner,
      kind,
      project,
      certification,
      storageKey,
      mimeType: image.mimeType,
      size: image.size,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
      status,
    });
  } catch (err) {
    await removePrivate(storageKey);
    throw err;
  }
}

/** Remove an asset's bytes and mark the row deleted. Never throws. */
export async function deleteAsset(assetOrId) {
  try {
    const asset = assetOrId?.storageKey ? assetOrId : await SkillWalletAsset.findById(assetOrId);
    if (!asset || asset.status === 'deleted') return;
    await removePrivate(asset.storageKey);
    await SkillWalletAsset.updateOne({ _id: asset._id }, { $set: { status: 'deleted', deletedAt: new Date() } });
  } catch (err) {
    console.error('[skill-wallet] asset delete failed:', err.message);
  }
}

/**
 * Remove project images that were uploaded but never attached. (Images
 * replaced on a project are removed by the controllers once neither the live
 * nor the published copy references them.)
 */
export async function sweepOrphanAssets(now = Date.now()) {
  const cutoff = new Date(now - env.skillWallet.orphanAssetHours * 3600 * 1000);
  const orphans = await SkillWalletAsset.find({ status: 'pending', createdAt: { $lt: cutoff } }).limit(500);
  for (const a of orphans) await deleteAsset(a);
  return orphans.length;
}
