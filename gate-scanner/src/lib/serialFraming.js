/**
 * USB virtual-COM (serial) scanner input: the scanner writes each code
 * followed by CR, LF or CRLF. Bytes arrive in arbitrary chunks, so they are
 * buffered until a line ends. Pure: feed Uint8Array chunks, get lines.
 */
export const MAX_LINE = 256;

export function createLineFramer({ onLine, onError = () => {}, maxLine = MAX_LINE }) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buffer = '';
  let overflow = false;

  return {
    /** @param {Uint8Array} chunk */
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      for (;;) {
        const i = buffer.search(/[\r\n]/);
        if (i === -1) break;
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (overflow) {
          overflow = false; // the rest of an over-long line: drop it
          continue;
        }
        if (line.trim()) onLine(line.trim());
      }
      if (buffer.length > maxLine) {
        buffer = '';
        overflow = true;
        onError('too_long');
      }
    },
    /** Port closed: anything left without a line ending is incomplete. */
    end() {
      const rest = buffer.trim();
      buffer = '';
      if (rest) onError('incomplete');
    },
  };
}
