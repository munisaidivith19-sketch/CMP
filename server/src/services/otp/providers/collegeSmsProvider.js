import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/http.js';

/** DLT-registered parent OTP template supplied by the college. */
export const OTP_SMS_TEMPLATE =
  'Dear Parent, {#studentName#} has requested a gate pass. For confirmation, your OTP is #OTP#. This OTP is valid for 10 minutes. Do not share this OTP with anyone except the authorized college faculty.';

export const renderOtpSms = ({ studentName, otp }) =>
  OTP_SMS_TEMPLATE.replace('{#studentName#}', studentName).replace('#OTP#', otp);

/** Parent notice once security records the student's return. */
export const RETURN_SMS_TEMPLATE =
  'Dear Parent, {#studentName#} has returned to the college campus on {#date#} at {#time#}. This is an automated notification from JNN INSTITUTE OF ENGINEERING.';

export const renderReturnSms = ({ studentName, date, time }) =>
  RETURN_SMS_TEMPLATE.replace('{#studentName#}', studentName).replace('{#date#}', date).replace('{#time#}', time);

export const isCollegeSmsConfigured = () => Boolean(env.sms.apiKey && env.sms.senderId && env.sms.otpTemplateId);

/**
 * Adapter for the college SMS vendor. Deliberately not wired to any endpoint:
 * implement `sendOtp` from the vendor's API documentation once it arrives,
 * using env.sms.apiKey / senderId / otpTemplateId and renderOtpSms().
 * Never log the OTP, the rendered message or the API key.
 */
export const collegeSmsProvider = {
  name: 'college_sms',
  devPortal: false,

  async sendOtp() {
    if (!isCollegeSmsConfigured()) {
      throw new ApiError(503, 'The college SMS service is not configured yet. Ask an administrator.');
    }
    throw new ApiError(503, 'The college SMS service is not connected yet. Ask an administrator.');
  },

  async sendMessage() {
    throw new ApiError(503, 'The college SMS service is not connected yet.');
  },
};
