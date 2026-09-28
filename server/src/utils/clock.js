/**
 * The server's notion of "now" for time-controlled rules (attendance windows).
 * Always the server clock in production; tests may replace `clock.now` to
 * simulate a time of day. Never derived from anything the client sends.
 */
export const clock = {
  now: () => new Date(),
};
