import Report from '../models/Report.js';
import { notifyRoles } from './notify.js';

// Minimal starter word list — extend for your campus. Matched as whole words.
const BLOCKED_WORDS = [
  'idiot',
  'stupid',
  'moron',
  'dumbass',
  'bastard',
  'bitch',
  'shit',
  'fuck',
  'asshole',
  'scam',
  'loser',
];

const pattern = new RegExp(`\\b(${BLOCKED_WORDS.join('|')})\\b`, 'i');

export const containsBlockedContent = (...texts) => texts.some((t) => t && pattern.test(t));

/** Create an automatic report so moderators review the content. */
export async function autoFlag({ targetType, targetId, replyId, excerpt }) {
  try {
    await Report.create({
      targetType,
      targetId,
      replyId,
      reason: 'inappropriate',
      details: `Auto-flagged by content filter: "${String(excerpt).slice(0, 120)}"`,
    });
    await notifyRoles(['admin', 'faculty'], {
      type: 'report',
      title: 'Content auto-flagged for review',
      message: String(excerpt).slice(0, 120),
      link: '/admin/reports',
    });
  } catch (err) {
    console.error('[moderation] auto-flag failed:', err.message);
  }
}
