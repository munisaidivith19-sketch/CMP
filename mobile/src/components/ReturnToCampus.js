import { useEffect, useState } from 'react';
import { Image, Linking, View } from 'react-native';
import { CheckCircle2, LocateFixed, LogIn, MapPinOff, QrCode } from 'lucide-react-native';
import { Button, Loading, T } from './ui';
import { errMsg, useGetReturnCredentialQuery, useVerifyReturnLocationMutation } from '../services/api';
import { colors, radius } from '../theme';
import { UPDATE_APP_MESSAGE, hasNativeModule } from '../utils/native';

// Loaded only when this app build contains the native module; a build made
// before expo-location was added must not crash the gate pass screens.
const Location = hasNativeModule('ExpoLocation') ? require('expo-location') : null;

const SAMPLE_MS = 12000; // keep listening this long for a precise fix
const GOOD_ENOUGH_M = 20; // stop early once the fix is this precise

const accuracyOf = (fix) => fix?.coords?.accuracy ?? Number.POSITIVE_INFINITY;

/**
 * Fresh high-accuracy fixes for a few seconds, keeping the most precise one —
 * never a cached last-known position. Stops listening as soon as it returns.
 */
async function bestFreshFix() {
  let best = null;
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0, mayShowUserSettingsDialog: true },
    (fix) => {
      if (accuracyOf(fix) < accuracyOf(best)) best = fix;
      if (accuracyOf(fix) <= GOOD_ENOUGH_M) finish();
    }
  );
  const timer = setTimeout(finish, SAMPLE_MS);
  await done;
  clearTimeout(timer);
  sub.remove();
  return best;
}

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const PERMISSION_TEXT = 'Location permission is required to verify your return to campus.';

/** Student, pass status "active" (outside campus): location check → temporary return QR/code for security. */
export default function ReturnToCampus({ pass }) {
  const existing = useGetReturnCredentialQuery(pass._id);
  const [verify, { isLoading: sending }] = useVerifyReturnLocationMutation();
  const [step, setStep] = useState('idle'); // idle | intro | locating | denied | failed
  const [failure, setFailure] = useState('');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [fresh, setFresh] = useState(null);
  const [showQr, setShowQr] = useState(false);

  const credential = fresh || existing.data;
  const now = useNow(Boolean(credential));
  const left = credential ? Math.max(0, Math.ceil((new Date(credential.expiresAt).getTime() - now) / 1000)) : 0;
  const live = Boolean(credential) && left > 0;

  const checkLocation = async () => {
    setFailure('');
    setShowQr(false);
    if (!Location) {
      setFailure(UPDATE_APP_MESSAGE);
      setStep('failed');
      return;
    }
    let perm;
    try {
      perm = await Location.requestForegroundPermissionsAsync();
    } catch {
      setFailure(UPDATE_APP_MESSAGE); // e.g. a build whose manifest lacks the location permission
      setStep('failed');
      return;
    }
    if (perm.status !== 'granted') {
      setCanAskAgain(perm.canAskAgain);
      setStep('denied');
      return;
    }
    setStep('locating');
    let fix;
    try {
      fix = await bestFreshFix();
    } catch {
      fix = null;
    }
    if (!fix) {
      setFailure('Could not get your location. Turn on location (GPS) and try again.');
      setStep('failed');
      return;
    }
    if (fix.mocked) {
      setFailure('A mock-location app appears to be active. Turn it off and try again.');
      setStep('failed');
      return;
    }
    try {
      const res = await verify({
        id: pass._id,
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracy: fix.coords.accuracy ?? 9999,
        timestamp: fix.timestamp,
      }).unwrap();
      setFresh(res);
      setStep('idle');
    } catch (e) {
      setFailure(errMsg(e, 'Could not verify your location. Please try again.'));
      setStep('failed');
    }
  };

  const allowLocation = () => (canAskAgain ? checkLocation() : Linking.openSettings());

  if (existing.isLoading) return <Loading />;

  if (live && step === 'idle') {
    return (
      <View style={{ gap: 10, alignItems: 'center', padding: 14, borderRadius: radius.md, backgroundColor: colors.successSoft }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <CheckCircle2 size={18} color={colors.success} />
          <T v="strong" style={{ color: '#059669' }}>
            Location verified
          </T>
        </View>
        <T v="small" style={{ textAlign: 'center' }}>
          You are within the campus verification area.
        </T>
        <T v="label">Return code</T>
        <T v="code" accessibilityLabel={`Return code ${credential.code.split('').join(' ')}`}>
          {credential.code}
        </T>
        {showQr ? (
          <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 24 }}>
            <Image source={{ uri: credential.qr }} style={{ width: 220, height: 220 }} accessibilityLabel="Return QR code" />
          </View>
        ) : null}
        <Button title={showQr ? 'Hide return QR' : 'Show return QR'} icon={QrCode} variant="outline" onPress={() => setShowQr((v) => !v)} style={{ alignSelf: 'stretch' }} />
        <T v="small" style={{ textAlign: 'center' }}>
          Show this QR/code to Security. Expires in <T v="strong">{mmss(left)}</T>
        </T>
      </View>
    );
  }

  if (step === 'idle') {
    return (
      <View style={{ gap: 8 }}>
        <T v="small">{credential ? 'Your return code expired. Verify your location again to get a new one.' : 'Student is currently OUT.'}</T>
        <Button title="Return to campus" icon={LogIn} onPress={() => setStep('intro')} />
      </View>
    );
  }

  return (
    <View style={{ gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: colors.primarySoft }}>
      <T v="strong">Verify return to campus</T>
      {step === 'denied' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MapPinOff size={16} color={colors.danger} />
            <T v="small" style={{ color: colors.danger, flex: 1 }}>
              {PERMISSION_TEXT}
            </T>
          </View>
          <Button title={canAskAgain ? 'Allow location' : 'Open settings'} icon={LocateFixed} onPress={allowLocation} />
        </>
      ) : (
        <>
          <T v="small">We need your current location to verify that you have returned to the college campus. It is read once, only now.</T>
          {step === 'failed' && failure ? (
            <T v="small" style={{ color: colors.danger }}>
              {failure}
            </T>
          ) : null}
          <Button
            title={step === 'locating' ? (sending ? 'Verifying…' : 'Finding your location…') : step === 'failed' ? 'Try again' : 'Verify my location'}
            icon={LocateFixed}
            loading={step === 'locating'}
            onPress={checkLocation}
          />
        </>
      )}
      <Button title="Cancel" variant="ghost" disabled={step === 'locating'} onPress={() => setStep('idle')} />
    </View>
  );
}
