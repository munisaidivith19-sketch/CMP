import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transport = null;

export const mailEnabled = () => Boolean(env.smtp.host);

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transport;
}

/** Send an email. Never throws and never logs the message body (it may hold a secret link). */
export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled()) {
    console.warn(`[mail] SMTP_HOST is not configured — could not send "${subject}"`);
    return false;
  }
  try {
    await getTransport().sendMail({ from: env.smtp.from, to, subject, text, html });
    return true;
  } catch (err) {
    console.error(`[mail] send failed for "${subject}":`, err.message);
    return false;
  }
}
