import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { collegeSmsProvider, isCollegeSmsConfigured, renderExitSms } from '../otp/providers/collegeSmsProvider.js';
import { maskMobile, normalizeIndianMobile } from '../otp/otpService.js';
import { fmtParts } from '../gatePassReturn.js';

/**
 * Troubleshooting → SMS / OTP test: sends one message of each registered DLT
 * template (Gate Pass OTP and left-campus notice) to a number IT support
 * types, straight through the college SMS vendor, and reports each result.
 *
 * Uses the vendor even while OTP_SMS_ENABLED is off, so the setup can be
 * checked before going live. The test OTP is random and unrelated to any
 * Gate Pass. Never returns or logs the API key; the number is masked in logs.
 */
const TEST_NAME = 'Test Student';
const REQUIRED = [
  ['SMS_API_KEY', () => env.sms.apiKey],
  ['SMS_SENDER_ID', () => env.sms.senderId],
  ['SMS_OTP_TEMPLATE_ID', () => env.sms.otpTemplateId],
  ['SMS_EXIT_TEMPLATE_ID', () => env.sms.exitTemplateId],
];

async function attempt(name, send) {
  const started = Date.now();
  try {
    await send();
    return { name, status: 'SENT', detail: 'Accepted by the SMS vendor. Check the phone.', durationMs: Date.now() - started };
  } catch (err) {
    return { name, status: 'FAILED', detail: String(err.message || 'Failed').slice(0, 200), durationMs: Date.now() - started };
  }
}

export async function runSmsTest(rawPhone) {
  const phone = normalizeIndianMobile(String(rawPhone || ''));
  if (!phone) return { ok: false, error: 'Enter a valid 10-digit Indian mobile number (starting 6–9).' };

  const missing = REQUIRED.filter(([, get]) => !get()).map(([k]) => k);
  const config = {
    liveSms: env.otp.smsEnabled,
    provider: env.otp.provider,
    apiUrlHttps: (() => {
      try {
        return new URL(env.sms.apiUrl).protocol === 'https:';
      } catch {
        return false;
      }
    })(),
    missing,
  };
  const to = maskMobile(phone);
  if (!isCollegeSmsConfigured()) {
    const detail = `Not configured: set ${missing.join(', ')} in the server .env.`;
    return { ok: false, to, config, results: [{ name: 'Gate Pass OTP SMS', status: 'SKIPPED', detail }, { name: 'Left-campus SMS', status: 'SKIPPED', detail }] };
  }

  const otp = String(crypto.randomInt(0, 10 ** env.otp.length)).padStart(env.otp.length, '0');
  const { date, time12 } = fmtParts(new Date());
  const results = [
    await attempt('Gate Pass OTP SMS', () => collegeSmsProvider.sendOtp({ to: phone, studentName: TEST_NAME, otp })),
    await attempt('Left-campus SMS', () =>
      collegeSmsProvider.sendMessage({ to: phone, kind: 'gate_pass_exit', message: renderExitSms({ studentName: TEST_NAME, date, time: time12 }) })
    ),
  ];
  return { ok: results.every((r) => r.status === 'SENT'), to, config, testOtp: otp, results };
}
