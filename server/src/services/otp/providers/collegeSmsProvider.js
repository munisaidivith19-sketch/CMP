import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/http.js';

/**
 * DLT-registered templates. The vendor rejects any message whose text differs
 * from the registered template, so these must match it character for character
 * (the {#alp#} / {#num#} slots are filled by the render functions below).
 */
export const OTP_SMS_TEMPLATE =
  'Dear Parent, {#alp#} has requested a Gate Pass. OTP to approve is {#num#}. Valid 10 min. J.N.N Institute of Engineering';

export const renderOtpSms = ({ studentName, otp }) =>
  OTP_SMS_TEMPLATE.replace('{#alp#}', () => studentName).replace('{#num#}', () => otp);

/** Parent notice once security records the student leaving campus. */
export const EXIT_SMS_TEMPLATE =
  'Dear Parent, {#alp#} has left the campus on {#alp#} at {#alp#} with an approved Gate Pass. J.N.N Institute of Engineering';

export const renderExitSms = ({ studentName, date, time }) =>
  [studentName, date, time].reduce((text, value) => text.replace('{#alp#}', () => value), EXIT_SMS_TEMPLATE);

export const isCollegeSmsConfigured = () =>
  Boolean(env.sms.apiKey && env.sms.senderId && env.sms.otpTemplateId && env.sms.exitTemplateId);

/** 10-digit Indian mobile → the form the vendor expects (country code 91). */
export function normalizeMobile(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return local.length === 10 ? `91${local}` : null;
}

async function deliver({ to, message, templateId }) {
  if (!isCollegeSmsConfigured()) {
    throw new ApiError(503, 'The college SMS service is not configured yet. Ask an administrator.');
  }
  const number = normalizeMobile(to);
  if (!number) throw new ApiError(422, 'The parent mobile number is not a valid 10-digit number.');

  // The API key travels in the query string: never log the URL, the message or the response body.
  let url;
  try {
    url = new URL(env.sms.apiUrl);
  } catch {
    throw new ApiError(503, 'The college SMS service is not configured correctly. Ask an administrator.');
  }
  // The key, the parent's number and the OTP must never cross the network in
  // clear text: production sends over HTTPS only (no silent downgrade),
  // unless SMS_ALLOW_INSECURE_HTTP=true opts in for a vendor without HTTPS.
  if (env.isProd && url.protocol !== 'https:') {
    if (!env.sms.allowInsecureHttp) {
      console.error('[sms] refusing to send: SMS_API_URL must be an https:// URL in production (or set SMS_ALLOW_INSECURE_HTTP=true)');
      throw new ApiError(503, 'The college SMS service is not configured securely. Ask an administrator.');
    }
    console.warn('[sms] sending over plain http (SMS_ALLOW_INSECURE_HTTP=true)');
  }
  url.searchParams.set('apikey', env.sms.apiKey);
  url.searchParams.set('senderid', env.sms.senderId);
  url.searchParams.set('templateid', templateId);
  url.searchParams.set('number', number);
  url.searchParams.set('message', message);

  let res;
  try {
    res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
  } catch {
    throw new ApiError(502, 'Could not reach the SMS service. Please try again.');
  }
  if (!res.ok) throw new ApiError(502, 'The SMS service rejected the message. Please try again.');
}

/** Adapter for the college SMS vendor (HTTP API with API key). */
export const collegeSmsProvider = {
  name: 'college_sms',
  devPortal: false,
  // A real sender: OTP_SENT is recorded when it accepts a message.
  delivers: true,

  async sendOtp({ to, studentName, otp }) {
    await deliver({ to, message: renderOtpSms({ studentName, otp }), templateId: env.sms.otpTemplateId });
  },

  async sendMessage({ to, message, kind }) {
    if (kind !== 'gate_pass_exit') throw new ApiError(400, 'Unsupported SMS type.');
    await deliver({ to, message, templateId: env.sms.exitTemplateId });
  },
};
