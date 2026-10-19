import SkillWalletAsset from '../../models/SkillWalletAsset.js';
import User from '../../models/User.js';
import { asyncHandler } from '../../utils/http.js';
import { getPrivate } from '../../utils/privateStorage.js';
import { buildActor } from '../../services/skillWallet/access.js';
import { canViewAsset, verifyAssetToken } from '../../services/skillWallet/assets.js';

/**
 * GET /api/skill-wallet/files/:token — download one private Skill Wallet file.
 *
 * Public route (an <img> cannot send the Bearer token), so the token is the
 * credential: HMAC-signed, short-lived, bound to one asset and one viewer.
 * Authorization is then re-run for that viewer — the token alone is not
 * enough once access was withdrawn. Every refusal is the same 404, so the
 * endpoint never confirms that an asset exists.
 */
const notFound = (res) => res.status(404).json({ message: 'File not found' });

export const downloadFile = asyncHandler(async (req, res) => {
  const t = verifyAssetToken(req.params.token);
  if (!t) return notFound(res);
  const asset = await SkillWalletAsset.findById(t.assetId).lean();
  if (!asset) return notFound(res);
  let user = null;
  if (t.viewerId) {
    user = await User.findById(t.viewerId);
    if (!user || !user.isActive) return notFound(res);
  }
  const actor = await buildActor(user);
  if (!(await canViewAsset(actor, asset))) return notFound(res);
  const bytes = await getPrivate(asset.storageKey);
  if (!bytes) return notFound(res);
  res.set({
    'Content-Type': asset.mimeType,
    'Content-Length': String(bytes.length),
    // Never cached by the browser or a proxy: unpublishing must take effect at once.
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    'Content-Disposition': `inline; filename="${asset.kind === 'certificate' ? 'certificate' : 'project-image'}.${asset.mimeType.split('/')[1].replace('jpeg', 'jpg')}"`,
    'Cross-Origin-Resource-Policy': 'same-site',
  });
  res.end(bytes);
});
