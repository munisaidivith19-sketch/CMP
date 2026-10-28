/**
 * USB virtual-COM scanner over Web Serial (Electron grants it to this app
 * only; the port is picked by the guard from the real port list). Unlike a
 * keyboard-mode scanner, a serial port's presence is actually known: plug
 * and unplug events drive the "connected / disconnected" status.
 */
import { createLineFramer } from './serialFraming.js';

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

/**
 * @param {object} o
 * @param {(line: string) => void} o.onLine
 * @param {(state: string, detail?: string) => void} o.onState  initializing | connected | disconnected | unsupported | error | idle
 * @param {(reason: string) => void} o.onInputProblem
 */
export function createSerialReader({ onLine, onState, onInputProblem }) {
  let port = null;
  let reader = null;
  let closing = false;
  let options = { baudRate: 9600 };

  const info = (p) => {
    const i = p?.getInfo?.() || {};
    return { usbVendorId: i.usbVendorId, usbProductId: i.usbProductId };
  };

  async function readLoop() {
    const framer = createLineFramer({ onLine, onError: onInputProblem });
    while (port?.readable && !closing) {
      reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) framer.push(value);
        }
      } catch (err) {
        if (!closing) onState('disconnected', err?.message);
      } finally {
        reader.releaseLock();
        reader = null;
      }
    }
    framer.end();
  }

  async function open(p) {
    port = p;
    onState('initializing');
    try {
      await port.open({ baudRate: options.baudRate, dataBits: 8, stopBits: 1, parity: 'none' });
    } catch (err) {
      // Already open by another program, or the device vanished.
      onState('error', /already open|access denied|busy/i.test(err?.message || '') ? 'The COM port is in use by another program.' : 'The COM port could not be opened.');
      port = null;
      return null;
    }
    closing = false;
    onState('connected');
    readLoop();
    return info(port);
  }

  async function close() {
    closing = true;
    try {
      await reader?.cancel();
    } catch {
      /* already closed */
    }
    try {
      await port?.close();
    } catch {
      /* already closed */
    }
    port = null;
  }

  return {
    /** Re-open a port this app was granted before (matching the saved hint), without asking. */
    async reconnect(hint, baudRate) {
      if (!serialSupported()) return onState('unsupported');
      options = { baudRate: baudRate || 9600 };
      const ports = await navigator.serial.getPorts();
      const match = ports.find((p) => {
        const i = info(p);
        return hint && i.usbVendorId === hint.usbVendorId && i.usbProductId === hint.usbProductId;
      });
      if (!match) return onState('disconnected', 'No scanner COM port is plugged in.');
      return open(match);
    },
    /** Ask the guard to choose a port (needs a click). Returns the port hint to remember. */
    async choose(baudRate) {
      if (!serialSupported()) return onState('unsupported');
      options = { baudRate: baudRate || 9600 };
      await close();
      let picked;
      try {
        picked = await navigator.serial.requestPort();
      } catch {
        onState('idle', 'No port selected.');
        return null;
      }
      return open(picked);
    },
    close: async () => {
      await close();
      onState('idle');
    },
    get open() {
      return Boolean(port);
    },
  };
}
