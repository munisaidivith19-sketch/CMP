/**
 * Checks the Firebase (FCM) setup from this machine, end to end, without a phone:
 *
 *   node scripts/check-fcm.mjs                 verify the key + reach Google
 *   node scripts/check-fcm.mjs <device-token>  also send a real test notification
 *
 * How the no-phone check works: it sends one message to a deliberately fake
 * device token. Google can only answer "that token is invalid" after it has
 * accepted this server's credentials, so that answer proves the key is valid,
 * the clock is right and outbound HTTPS to Google is open.
 *
 * Nothing here prints the key, an access token or a device token.
 */
import '../src/config/env.js';
import { fcmConfigured, sendToToken } from '../src/services/fcm.js';

const [, , deviceToken] = process.argv;

if (!fcmConfigured()) {
  console.error('FAIL  No usable key. Set FCM_SERVICE_ACCOUNT_FILE (a path) or FCM_SERVICE_ACCOUNT in server/.env,');
  console.error('      then run this again. (Look above for an "[fcm] ..." line saying why a set value was rejected.)');
  process.exit(1);
}

const probe = await sendToToken('vexon-connectivity-check-not-a-real-token', { title: 'check', body: 'check' });
if (probe === 'invalid') {
  console.log('OK    Key accepted by Google and FCM is reachable.');
} else {
  console.error(`FAIL  Could not reach FCM with this key (result: ${probe}).`);
  console.error('      Check: outbound HTTPS to fcm.googleapis.com / oauth2.googleapis.com, the server clock (NTP),');
  console.error('      and that the key belongs to the Firebase project the app\'s google-services.json came from.');
  process.exit(1);
}

if (deviceToken) {
  const sent = await sendToToken(
    deviceToken,
    { title: 'VEXON test', body: 'Push notifications are working.', link: '/notifications', category: 'sos' },
    { priority: 'high' },
  );
  if (sent === 'sent') console.log('OK    Test notification sent. It should appear on the phone within a few seconds.');
  else if (sent === 'invalid') console.error('FAIL  Google says that device token is not valid (stale, or from a different Firebase project).');
  else console.error(`FAIL  Sending failed (result: ${sent}).`);
  process.exit(sent === 'sent' ? 0 : 1);
}
