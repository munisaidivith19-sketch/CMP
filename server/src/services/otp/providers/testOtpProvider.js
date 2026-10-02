/**
 * Development stand-in for the college SMS vendor. Nothing leaves the server:
 * the code is held in process memory (never the database, never the logs) so
 * the admin-only development OTP portal can display it.
 */
const KEEP_MS = 60 * 60 * 1000;
const OUTBOX_SIZE = 50;
const issued = new Map(); // otpId -> { otp, expiresAt, storedAt }
const outbox = []; // newest first: parent messages that would have been sent by SMS

function prune(now = Date.now()) {
  for (const [id, entry] of issued) {
    if (now - entry.storedAt > KEEP_MS && entry.expiresAt.getTime() < now) issued.delete(id);
  }
}

export const testOtpProvider = {
  name: 'test',
  devPortal: true,

  async sendOtp({ otpId, otp, maskedMobile, expiresAt }) {
    prune();
    issued.set(String(otpId), { otp, expiresAt, storedAt: Date.now() });
    console.info(`[otp:test] OTP issued for ${maskedMobile} — view it in the development OTP portal`);
  },

  /** Plaintext test OTP for the development portal only. */
  peek(otpId) {
    return issued.get(String(otpId))?.otp ?? null;
  },

  forget(otpId) {
    issued.delete(String(otpId));
  },

  async sendMessage({ maskedMobile, message, kind }) {
    outbox.unshift({ to: maskedMobile, message, kind, sentAt: new Date() });
    outbox.length = Math.min(outbox.length, OUTBOX_SIZE);
    console.info(`[sms:test] ${kind} message for ${maskedMobile} — view it in the development OTP portal`);
  },

  /** Parent messages the test provider "sent" — for the development portal and tests only. */
  sentMessages() {
    return [...outbox];
  },
};
