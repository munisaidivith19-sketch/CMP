import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LocateFixed, QrCode } from 'lucide-react';
import { useGetReturnCredentialQuery, useVerifyReturnLocationMutation } from '../../services/api';
import { Button, Skeleton } from '../../components/ui/primitives';
import { locationProblem, permissionState, preflight, readFreshFix, readingBody, verifyProblem } from '../../utils/returnLocation';

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
  const inFlight = useRef(false);
  const now = useNow(Boolean(data));
  const left = data ? Math.max(0, Math.ceil((new Date(data.expiresAt).getTime() - now) / 1000)) : 0;

  useEffect(() => () => abort.current?.abort(), []);

  const checkLocation = async () => {
    if (inFlight.current) return; // one check at a time
    setProblem('');
    const blocked = preflight(window);
    if (blocked) {
      setProblem(locationProblem(blocked));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    let fix = null;
    try {
      const permissionBefore = await permissionState(navigator);
      try {
        fix = await readFreshFix(navigator.geolocation, { signal: controller.signal });
      } catch (e) {
        if (e?.kind !== 'aborted') setProblem(locationProblem(e?.kind, permissionBefore));
        return;
      }
      if (controller.signal.aborted) return;
      try {
        await verify({ id: pass._id, ...readingBody(fix) }).unwrap();
        setShowQr(false);
      } catch (e) {
        if (!controller.signal.aborted) setProblem(verifyProblem(e, fix));
      }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
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
          {busy ? 'Finding your location…' : problem ? 'Try again' : 'Verify my location'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <p className="flex items-center gap-1.5 font-bold text-emerald-600">
        <CheckCircle2 className="h-5 w-5" /> {data.override ? 'Return approved by Admin' : 'Location verified'}
      </p>
      <p className="text-sm muted">{data.override ? 'Show this code to Security at the gate to record your return.' : 'You are within the campus verification area.'}</p>
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
