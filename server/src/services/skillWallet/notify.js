import { notifyUsers } from '../../utils/notify.js';

/**
 * Skill Wallet notifications through the one VEXON notification service
 * (stored in-app, live over Socket.io, then FCM push when configured).
 *
 * Payloads are deliberately generic: push text travels through a third-party
 * service and shows on lock screens, so it never carries a project title,
 * description, hall ticket or reviewer note — the app shows those after the
 * user opens the link and the API authorizes them.
 */
export function notifySkillWallet(userIds, { title, message, link }, opts = {}) {
  return notifyUsers(userIds, { type: 'skill_wallet', title, message, link }, { category: 'system', ...opts });
}
