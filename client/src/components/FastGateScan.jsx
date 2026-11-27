import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, Clock, Loader2, RotateCcw, XCircle } from 'lucide-react';
import QrScannerModal from './QrScannerModal';
import { Avatar, cn } from './ui/primitives';
import { useSubmitGateScanMutation } from '../services/api';
import { newScanId } from '../utils/gateQr';
import { displayName, errMsg } from '../utils/format';

const KEEP = 12;
const RETRIES = 2;

/** One short tone per result, like a checkout scanner. Silent if audio is unavailable. */
let audioCtx;
function beep(kind) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = kind === 'success' ? [[1400, 0, 0.09]] : kind === 'duplicate' ? [[900, 0, 0.08], [900, 0.12, 0.08]] : [[320, 0, 0.12], [260, 0.16, 0.18]];
    for (const [freq, at, len] of tones) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = 'square';
      gain.gain.value = 0.08;
      osc.connect(gain).connect(audioCtx.destination);
      const t = audioCtx.currentTime + at;
      osc.start(t);
      osc.stop(t + len);
    }
    navigator.vibrate?.(kind === 'success' ? 60 : [80, 60, 80]);
  } catch {
    /* no sound — the colour and the list still show the result */
  }
}

const TONE = {
  success: { icon: CheckCircle2, cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  duplicate: { icon: Clock, cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  rejected: { icon: XCircle, cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  failed: { icon: XCircle, cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  sending: { icon: Loader2, cls: 'bg-slate-500/10 muted' },
};

/**
 * Supermarket-style gate scanning: the camera stays on and every QR shown to
 * it is verified AND recorded in one server call (exit for a gate pass QR,
 * return for a Return QR — the QR decides). No Verify or Confirm taps. The
 * server alone decides each result; each scan has its own id, so a retry
 * after a dropped connection can never record twice.
 */
export default function FastGateScan({ open, onClose }) {
  const [submit] = useSubmitGateScanMutation();
  const [items, setItems] = useState([]);
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef();
  const counts = items.reduce((c, i) => ({ ...c, [i.outcome]: (c[i.outcome] || 0) + 1 }), {});

  const update = (scanId, patch) => setItems((list) => list.map((i) => (i.scanId === scanId ? { ...i, ...patch } : i)));
  const show = (outcome) => {
    beep(outcome);
    setFlash(outcome === 'failed' ? 'rejected' : outcome);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 450);
  };

  const send = useCallback(
    async (payload) => {
      const scanId = newScanId();
      setItems((list) => [{ scanId, outcome: 'sending', message: 'Checking…', at: new Date() }, ...list].slice(0, KEEP));
      for (let attempt = 0; ; attempt += 1) {
        try {
          const r = await submit({ scanId, payload }).unwrap();
          const outcome = r.pending ? 'failed' : r.outcome || 'failed';
          update(scanId, { outcome, message: r.pending ? 'Still checking — look the student up before letting them pass.' : r.message, student: r.student, direction: r.direction });
          show(outcome);
          return;
        } catch (err) {
          const offline = !err?.status || err.status === 'FETCH_ERROR' || err.status === 'TIMEOUT_ERROR' || err.status >= 500;
          if (offline && attempt < RETRIES) continue; // same scanId: the server records it at most once
          update(scanId, { outcome: 'failed', message: err?.status === 429 ? 'Too many scans at once — wait a second and scan again.' : errMsg(err, 'Not sent — scan again.') });
          show('failed');
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [submit]
  );

  const latest = items[0];
  return (
    <QrScannerModal open={open} onClose={onClose} title="Fast scan — exit & return" continuous flash={flash} onScanned={send}>
      <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">{counts.success || 0} recorded</span>
        <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-300">{counts.duplicate || 0} repeat</span>
        <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-rose-700 dark:text-rose-300">{(counts.rejected || 0) + (counts.failed || 0)} refused</span>
        {items.length > 0 && (
          <button type="button" className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 muted hover:underline" onClick={() => setItems([])}>
            <RotateCcw className="h-3 w-3" /> Clear
          </button>
        )}
      </div>
      {latest && <ScanRow item={latest} big />}
      {items.length > 1 && (
        <ul className="max-h-56 space-y-1.5 overflow-y-auto" aria-label="Earlier scans">
          {items.slice(1).map((i) => (
            <li key={i.scanId}>
              <ScanRow item={i} />
            </li>
          ))}
        </ul>
      )}
    </QrScannerModal>
  );
}

function ScanRow({ item, big = false }) {
  const tone = TONE[item.outcome] || TONE.failed;
  const Icon = tone.icon;
  const label = item.outcome === 'success' ? (item.direction === 'in' ? 'IN' : 'OUT') : null;
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl', big ? 'p-3' : 'px-3 py-1.5', tone.cls)} aria-live={big ? 'assertive' : undefined}>
      {item.student ? <Avatar user={item.student} size={big ? 'md' : 'xs'} /> : <Icon className={cn('shrink-0', big ? 'h-6 w-6' : 'h-4 w-4', item.outcome === 'sending' && 'animate-spin')} />}
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-bold', big ? 'text-base' : 'text-sm')}>
          {item.student ? `${displayName(item.student)}${item.student.rollNo ? ` · ${item.student.rollNo}` : ''}` : item.message}
        </p>
        {item.student && <p className="truncate text-xs">{item.message}</p>}
      </div>
      {label && <span className={cn('rounded-lg bg-emerald-600 px-2 py-0.5 font-extrabold text-white', big ? 'text-sm' : 'text-[10px]')}>{label}</span>}
      <span className="shrink-0 text-[10px] opacity-70">{item.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
    </div>
  );
}
