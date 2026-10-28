import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createWedgeParser, isEditableTarget } from '../lib/hidWedge.js';
import { createScanQueue, FINAL_STATES } from '../lib/scanQueue.js';
import { createSerialReader, serialSupported } from '../lib/serialReader.js';
import { describePayload } from '../lib/payload.js';
import { INPUT_PROBLEMS } from '../lib/explain.js';
import { beep } from '../lib/sound.js';
import { fmtTime } from '../ui.jsx';

const ScannerCtx = createContext(null);
export const useScanner = () => useContext(ScannerCtx);

const SOUND = { success: 'success', duplicate: 'warning', rejected: 'error', failed: 'error' };

/**
 * Scanner input (keyboard-mode HID and USB serial) → scan queue → server.
 * Scans are only sent while the Scanner screen is open ("armed"); anywhere
 * else a scan is reported, never recorded. Diagnostics' test mode captures
 * scans without sending them.
 */
export function ScannerProvider({ settings, connection, onAuthProblem, notify, children }) {
  const [jobs, setJobs] = useState([]);
  const [ignoredRepeats, setIgnoredRepeats] = useState(0);
  const [armed, setArmed] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [testCapture, setTestCapture] = useState(null);
  const [lastInput, setLastInput] = useState(null);
  const [inputProblem, setInputProblem] = useState(null);
  const [windowFocused, setWindowFocused] = useState(document.hasFocus());
  const [capsLock, setCapsLock] = useState(false);
  const [serial, setSerial] = useState({ state: 'idle', detail: null });

  const refs = useRef({});
  refs.current = { armed, testMode, connection, onAuthProblem, notify };
  const previousStates = useRef(new Map());

  const queue = useMemo(
    () =>
      createScanQueue({
        submit: async (body) => {
          const r = await window.gate.api.scan(body);
          if (!r.ok && ['offline', 'timeout'].includes(r.kind)) refs.current.connection.reportFailure();
          if (!r.ok && ['auth', 'role', 'terms', 'password'].includes(r.kind)) refs.current.onAuthProblem(r);
          return r;
        },
        checkStatus: (scanId) => window.gate.api.scanStatus(scanId),
        isOnline: () => refs.current.connection.online,
        onChange: ({ jobs: list, ignoredRepeats: n }) => {
          setIgnoredRepeats(n);
          setJobs(list.map((j) => ({ ...j })));
          for (const j of list) {
            const was = previousStates.current.get(j.scanId);
            if (was !== j.state && FINAL_STATES.includes(j.state)) {
              beep(SOUND[j.state]);
              window.gate.diag.record({ event: 'scan', state: j.state, code: j.result?.code || null, kind: j.error?.kind || null, source: j.source });
            }
            previousStates.current.set(j.scanId, j.state);
          }
        },
      }),
    []
  );

  const handleRaw = useCallback(
    (text, meta, source) => {
      const info = describePayload(text);
      setInputProblem(null);
      setLastInput({ at: Date.now(), source, length: text.length, label: info.label, capsLock: meta.capsLock, durationMs: meta.durationMs });
      if (refs.current.testMode) {
        setTestCapture({ at: Date.now(), source, label: info.label, length: text.length, durationMs: meta.durationMs ?? null, capsLock: meta.capsLock, direction: info.direction });
        return;
      }
      if (!refs.current.armed) {
        refs.current.notify('A scan was received but not recorded. Open the Scanner screen to record gate scans.');
        return;
      }
      queue.enqueue({ payload: text, source, capsLock: meta.capsLock });
    },
    [queue]
  );

  const handleProblem = useCallback((reason, source) => {
    setInputProblem({ reason, source, at: Date.now(), ...INPUT_PROBLEMS[reason] });
    if (reason !== 'too_short') beep('warning');
    window.gate.diag.record({ event: 'input_problem', reason, source });
  }, []);

  // ── Keyboard-mode (USB / Bluetooth HID) ────────────────────────────
  useEffect(() => {
    if (settings.scannerMode !== 'hid') return undefined;
    const parser = createWedgeParser({
      terminator: settings.terminator,
      maxKeyGapMs: settings.maxKeyGapMs,
      onScan: (text, meta) => handleRaw(text, meta, 'hid'),
      onIncomplete: (reason) => handleProblem(reason, 'hid'),
    });
    const onKey = (e) => {
      setCapsLock(e.getModifierState?.('CapsLock') === true);
      // Typing into a form field (login, search, manual code) is never a scan.
      if (isEditableTarget(e.target)) return;
      const consumed = parser.handleKey({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, capsLock: e.getModifierState?.('CapsLock') === true }, performance.now());
      if (consumed) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const stall = setInterval(() => parser.checkStalled(performance.now()), 300);
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearInterval(stall);
      window.removeEventListener('keydown', onKey, true);
      parser.reset();
    };
  }, [settings.scannerMode, settings.terminator, settings.maxKeyGapMs, handleRaw, handleProblem]);

  useEffect(() => window.gate.window.onFocus((f) => setWindowFocused(f)), []);

  // ── USB virtual COM (serial) ───────────────────────────────────────
  const serialReader = useMemo(
    () =>
      createSerialReader({
        onLine: (line) => handleRaw(line, { capsLock: false }, 'serial'),
        onState: (state, detail) => {
          setSerial({ state, detail: detail || null });
          window.gate.diag.record({ event: 'serial_state', state });
        },
        onInputProblem: (reason) => handleProblem(reason, 'serial'),
      }),
    [handleRaw, handleProblem]
  );

  useEffect(() => {
    if (settings.scannerMode !== 'serial') {
      serialReader.close();
      return undefined;
    }
    if (!serialSupported()) {
      setSerial({ state: 'unsupported', detail: null });
      return undefined;
    }
    serialReader.reconnect(settings.serialPortHint, settings.serialBaudRate);
    // Unplug / re-plug: reconnect to the remembered scanner automatically.
    const onChange = () => setTimeout(() => !serialReader.open && serialReader.reconnect(settings.serialPortHint, settings.serialBaudRate), 500);
    const onDisconnect = () => setSerial({ state: 'disconnected', detail: 'The scanner was unplugged.' });
    navigator.serial.addEventListener('connect', onChange);
    navigator.serial.addEventListener('disconnect', onDisconnect);
    return () => {
      navigator.serial.removeEventListener('connect', onChange);
      navigator.serial.removeEventListener('disconnect', onDisconnect);
      serialReader.close();
    };
  }, [settings.scannerMode, settings.serialBaudRate, settings.serialPortHint, serialReader]);

  /** What the header and dashboard show — honest about what can be detected. */
  const status = useMemo(() => {
    if (settings.scannerMode === 'serial') {
      const map = {
        connected: ['success', 'Scanner connected (COM)', 'USB serial scanner connected and ready.'],
        initializing: ['pending', 'Scanner initializing', 'Opening the COM port…'],
        disconnected: ['error', 'Scanner disconnected', serial.detail || 'Plug the scanner in; it reconnects automatically.'],
        unsupported: ['error', 'Serial input unsupported', 'Serial ports are not available on this PC. Use keyboard (HID) mode.'],
        error: ['error', 'Scanner port error', serial.detail || 'The COM port could not be opened.'],
        idle: ['warning', 'No COM port selected', 'Choose the scanner port in Diagnostics → Scanner setup.'],
      };
      const [tone, label, detail] = map[serial.state] || map.idle;
      return { tone, label, detail, hardwareDetectable: true };
    }
    if (!windowFocused) return { tone: 'warning', label: 'Window not focused', detail: 'Keyboard-mode scanners type into the active window. Click the Gate Scanner window.', hardwareDetectable: false };
    if (capsLock) return { tone: 'warning', label: 'Caps Lock is on', detail: 'Turn Caps Lock off — return QRs are case-sensitive.', hardwareDetectable: false };
    if (lastInput) return { tone: 'success', label: 'Keyboard scanner ready', detail: `Last scan received at ${fmtTime(lastInput.at)}. A keyboard-mode scanner's presence cannot be detected, only its input.`, hardwareDetectable: false };
    return { tone: 'neutral', label: 'Waiting for first scan', detail: 'Keyboard-mode (USB / Bluetooth HID): Windows apps cannot detect the scanner itself. Test it in Diagnostics.', hardwareDetectable: false };
  }, [settings.scannerMode, serial, windowFocused, capsLock, lastInput]);

  const value = {
    jobs,
    ignoredRepeats,
    status,
    serial,
    lastInput,
    inputProblem,
    capsLock,
    windowFocused,
    armed,
    setArmed,
    testMode,
    setTestMode,
    testCapture,
    setTestCapture,
    enqueueManual: (code, kind) => queue.enqueue({ payload: code, source: 'manual', kind }),
    recheck: (scanId) => queue.recheck(scanId),
    chooseSerialPort: () => serialReader.choose(settings.serialBaudRate),
    disconnectSerial: () => serialReader.close(),
  };
  return <ScannerCtx.Provider value={value}>{children}</ScannerCtx.Provider>;
}
