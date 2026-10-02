import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LocateFixed, QrCode } from 'lucide-react';
import { useGetReturnCredentialQuery, useVerifyReturnLocationMutation } from '../../services/api';
import { Button, Skeleton } from '../../components/ui/primitives';
import { errMsg } from '../../utils/format';

const SAMPLE_MS = 12000; // keep listening this long for a precise fix
const GOOD_ENOUGH_M = 20; // stop early once the fix is this precise

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

const PERMISSION_TEXT = 'Location permission is required to verify your return to campus. Allow location for this site in your browser settings, then try again.';

/**
 * Fresh high-accuracy fixes for a few seconds, keeping the most precise one —
 * never a cached position. Resolves null on timeout with no fix; rejects with
 * the browser's GeolocationPositionError otherwise. Stops listening before it returns.
 */
function bestFreshFix(signal) {
  return new Promise((resolve, reject) => {
    let best = null;
    let watchId;
    let timer;
    const finish = (err) => {
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      if (best) resolve(best);
      else if (err) reject(err);
      else resolve(null);
    };
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        if (pos.coords.accuracy <= GOOD_ENOUGH_M) finish();
      },
      (err) => finish(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: SAMPLE_MS }
    );
    timer = setTimeout(() => finish(), SAMPLE_MS);
    signal?.addEventListener('abort', () => finish());
  });
}

/**
 * Student's pass while outside campus. One tap reads the browser's location
 * once and sends the raw reading to the server, which alone decides; on
 * success the return code/QR for Security appears. (The mobile app does the
 * same check with the phone's GPS.)
 */
export function ReturnStatus({ pass }) {
  const { data, isLoading } = useGetReturnCredentialQuery(pass._id);
  const [verify] = useVerifyReturnLocationMutation();
  const [showQr, setShowQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const abort = useRef(null);
  const now = useNow(Boolean(data));
  const left = data ? Math.max(0, Math.ceil((new Date(data.expiresAt).getTime() - now) / 1000)) : 0;

  useEffect(() => () => abort.current?.abort(), []);

  const checkLocation = async () => {
    setProblem('');
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setProblem('This browser cannot share its location here. Open Vexon over HTTPS in a browser that supports location, or use the Vexon app.');
      return;
    }
    setBusy(true);
    abort.current = new AbortController();
    try {
      const fix = await bestFreshFix(abort.current.signal);
      if (!fix) {
        setProblem('Could not get your location. Turn on location (GPS) and try again.');
        return;
      }
      await verify({
        id: pass._id,
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracy: fix.coords.accuracy,
        timestamp: fix.timestamp,
      }).unwrap();
      setShowQr(false);
    } catch (e) {
      if (e?.code === 1) setProblem(PERMISSION_TEXT); // GeolocationPositionError.PERMISSION_DENIED
      else if (e?.code === 2 || e?.code === 3) setProblem('Could not get your location. Turn on location (GPS) and try again.');
      else setProblem(errMsg(e, 'Could not verify your location. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Skeleton className="mx-auto h-40 w-full max-w-xs" />;

  if (!data || left === 0) {
    return (
      <div className="flex w-full flex-col items-center gap-3 text-center">
        <p className="font-bold">{data ? 'Your return code expired' : 'Student is currently OUT'}</p>
        <p className="text-sm muted">
          {data ? 'Verify your location again to get a new one.' : 'When you are back at the college, verify your location to get a return code for Security. Your location is read once, only when you tap the button.'}
        </p>
        {problem && (
          <p className="text-sm text-rose-600" role="alert">
            {problem}
          </p>
        )}
        <Button icon={LocateFixed} loading={busy} onClick={checkLocation} className="w-full sm:w-auto">
          {busy ? 'Finding your location…' : 'Verify my location'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <p className="flex items-center gap-1.5 font-bold text-emerald-600">
        <CheckCircle2 className="h-5 w-5" /> Location verified
      </p>
      <p className="text-sm muted">You are within the campus verification area.</p>
      <p className="text-xs font-bold uppercase tracking-wide muted">Return code</p>
      <p className="font-mono text-4xl font-extrabold tracking-[0.3em]">{data.code}</p>
      {showQr && (
        <div className="rounded-3xl bg-white p-3 shadow-soft">
          <img src={data.qr} alt="Return QR code" className="h-52 w-52 max-w-full" />
        </div>
      )}
      <Button variant="soft" icon={QrCode} onClick={() => setShowQr((v) => !v)}>
        {showQr ? 'Hide return QR' : 'Show return QR'}
      </Button>
      <p className="text-xs muted">
        Show this QR/code to Security · expires in <span className="font-bold tabular-nums">{mmss(left)}</span>
      </p>
    </div>
  );
}
