import { isMobileClient } from './tokens.js';

/** Browser family from a User-Agent string. */
export function parseBrowser(ua = '') {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

/** Operating system from a User-Agent string. */
export function parseOs(ua = '') {
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown OS';
}

/** The device name the mobile app reports, reduced to safe characters. */
export const mobileDeviceName = (req) => String(req?.get?.('x-device-name') || '').replace(/[^\w .\-()]/g, '').slice(0, 60);

/** A readable device label, e.g. "Chrome on Windows" or "Mobile app · Pixel 7". */
export function parseDevice(ua = '', req) {
  if (req && isMobileClient(req)) {
    const name = mobileDeviceName(req);
    return `Mobile app${name ? ` · ${name}` : ''}`;
  }
  return `${parseBrowser(ua)} on ${parseOs(ua)}`;
}
