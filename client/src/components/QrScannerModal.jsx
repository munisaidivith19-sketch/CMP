import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/primitives';
import { createScanGate } from '../utils/gateQr';

const MAX_SIDE = 480; // decode a downscaled frame — plenty for a QR, much cheaper
const FRAME_MS = 120; // ~8 scans per second

const MESSAGES = {
  denied: 'Camera permission is required to scan a QR code. Allow camera access for this site in your browser settings, then try again.',
  nocamera: 'No camera was found on this device. Enter the code manually instead.',
  insecure: 'The camera only works on a secure (HTTPS) page. Open Vexon over HTTPS, or enter the code manually.',
  failed: 'The camera could not be started. Close the scanner and try again, or enter the code manually.',
};

function classify(err) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'insecure';
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'denied';
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'nocamera';
  return 'failed';
}

/**
 * In-page camera QR scanner. Reports the raw scanned text once through
 * onScanned — it verifies nothing; the caller sends that text to the same
 * backend check used for a typed code. The camera is on only while the
 * modal is open and the tab is visible, and is released on close.
 */
export default function QrScannerModal({ open, onClose, onScanned, title = 'Scan gate pass QR' }) {
  const videoRef = useRef(null);
  const [problem, setProblem] = useState('');
  const [starting, setStarting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const callback = useRef(onScanned); // latest handler, without restarting the camera on every render
  callback.current = onScanned;

  useEffect(() => {
    if (!open) return undefined;
    let stream;
    let timer;
    let stopped = false;
    const gate = createScanGate((value) => {
      stop();
      callback.current(value);
    });

    function stop() {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop()); // release the camera
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    async function start() {
      setProblem('');
      setStarting(true);
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setStarting(false);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const tick = () => {
          if (stopped) return;
          if (video.readyState >= 2 && video.videoWidth && !document.hidden) {
            const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (hit?.data && gate.handle(hit.data)) return;
          }
          timer = setTimeout(tick, FRAME_MS);
        };
        tick();
      } catch (err) {
        if (!stopped) {
          setProblem(classify(err));
          setStarting(false);
        }
      }
    }

    // No camera while the tab is in the background.
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        setStarting(true);
      } else {
        setAttempt((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [open, attempt]);

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {problem ? (
        <div className="space-y-3 text-sm" role="alert">
          <p>{MESSAGES[problem]}</p>
          {problem === 'denied' && (
            <Button icon={Camera} onClick={() => setAttempt((n) => n + 1)}>
              Allow camera
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-black">
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" aria-label="Camera preview" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
              <div className="relative h-[62%] w-[62%]">
                <span className="absolute left-0 top-0 h-9 w-9 rounded-tl-2xl border-l-4 border-t-4 border-white" />
                <span className="absolute right-0 top-0 h-9 w-9 rounded-tr-2xl border-r-4 border-t-4 border-white" />
                <span className="absolute bottom-0 left-0 h-9 w-9 rounded-bl-2xl border-b-4 border-l-4 border-white" />
                <span className="absolute bottom-0 right-0 h-9 w-9 rounded-br-2xl border-b-4 border-r-4 border-white" />
              </div>
            </div>
            {starting && <p className="absolute inset-x-0 bottom-3 text-center text-xs font-semibold text-white">Starting camera…</p>}
          </div>
          <p className="text-center text-sm muted">Align the QR code inside the frame</p>
        </div>
      )}
    </Modal>
  );
}
