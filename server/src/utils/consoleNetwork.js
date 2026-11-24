import net from 'node:net';
import { env } from '../config/env.js';
import { trustProxySetting } from '../middleware/https.js';

/**
 * Where the IT support account may be used: CONSOLE_ALLOWED_NETWORKS in .env,
 * comma-separated addresses or CIDR ranges (e.g. "127.0.0.1,::1,172.16.20.0/24").
 * Default: the server itself only (127.0.0.1 and ::1).
 *
 * Everywhere else the account behaves as if it did not exist: a sign-in with
 * the correct password is answered exactly like a wrong one, and a session
 * used from outside is ended. Checked on sign-in, token refresh, every API
 * request and the real-time connection.
 *
 * The client address is worked out here, not taken from a header: the raw
 * socket address, and X-Forwarded-For only through the proxy hops the server
 * is configured to trust (TRUST_PROXY), the same rule Express uses. A request
 * that reaches the server from localhost carrying forwarding headers while no
 * proxy is trusted is refused: a local reverse proxy is hiding the real
 * visitor, and a client could otherwise claim to be 127.0.0.1.
 */
const FORWARD_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip'];

export const normalizeIp = (ip) => {
  const s = String(ip || '').trim();
  return s.startsWith('::ffff:') && net.isIPv4(s.slice(7)) ? s.slice(7) : s;
};
const isLoopback = (ip) => ip === '::1' || /^127\./.test(ip);

/** origin: { remoteAddress, headers } — an Express request's socket, or a socket.io handshake. */
export function clientAddress({ remoteAddress, headers } = {}, hops = trustProxySetting()) {
  const remote = normalizeIp(remoteAddress);
  if (!hops) return remote;
  const forwarded = String(headers?.['x-forwarded-for'] || '')
    .split(',')
    .map(normalizeIp)
    .filter(Boolean)
    .reverse();
  const chain = [remote, ...forwarded];
  return chain[Math.min(hops, chain.length - 1)];
}

let cache = { key: null, list: null, entries: [] };
function allowList() {
  const key = env.consoleAllowedNetworks.join(',');
  if (cache.key === key) return cache;
  const list = new net.BlockList();
  const entries = [];
  for (const raw of env.consoleAllowedNetworks) {
    const [addr, bits] = raw.split('/');
    const type = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
    const prefix = bits === undefined ? null : Number(bits);
    if (!type || (prefix !== null && (!Number.isInteger(prefix) || prefix < 0 || prefix > (type === 'ipv4' ? 32 : 128)))) {
      console.warn(`[console-network] ignoring invalid CONSOLE_ALLOWED_NETWORKS entry: ${raw}`);
      continue;
    }
    if (prefix === null) list.addAddress(addr, type);
    else list.addSubnet(addr, prefix, type);
    entries.push(raw);
  }
  cache = { key, list, entries };
  return cache;
}

export const consoleNetworks = () => allowList().entries;

/** Whether this request / connection may use the IT support account. */
export function consoleNetworkAllowed(origin = {}) {
  const hops = trustProxySetting();
  const remote = normalizeIp(origin.remoteAddress);
  if (!hops && isLoopback(remote) && FORWARD_HEADERS.some((h) => origin.headers?.[h])) return false;
  const ip = clientAddress(origin, hops);
  // "I am the server" can only be true of a connection that is itself local:
  // a header claiming localhost over a remote connection is forged (or
  // TRUST_PROXY claims a proxy that is not there).
  if (isLoopback(ip) && !isLoopback(remote)) return false;
  const type = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null;
  return Boolean(type) && allowList().list.check(ip, type);
}

/** Origin of an Express request. */
export const requestOrigin = (req) => ({ remoteAddress: req.socket?.remoteAddress, headers: req.headers });
