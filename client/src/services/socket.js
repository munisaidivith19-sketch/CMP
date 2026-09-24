import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

let socket = null;

// Listeners live outside the socket so components can subscribe before the
// socket exists (child effects run before the layout creates it) and keep
// working across reconnects.
const listeners = new Map(); // event -> Set<fn>
const connectHooks = new Set(); // run on every (re)connect — used to (re)join rooms

function dispatch(event, args) {
  listeners.get(event)?.forEach((fn) => fn(...args));
}

/**
 * Connect once per signed-in session. `getToken` is read on every (re)connect.
 * The server authenticates only at handshake time, so when a reconnect is
 * refused because the access token expired, `onUnauthorized` refreshes the
 * session and we try again with the new token.
 */
export function connectSocket(getToken, { onUnauthorized } = {}) {
  if (socket) return socket;
  socket = io({
    path: '/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling'],
    auth: (cb) => cb({ token: getToken() }),
  });

  socket.onAny((event, ...args) => dispatch(event, args));
  socket.on('connect', () => {
    connectHooks.forEach((fn) => fn(socket));
    dispatch('connect', []);
  });

  let retrying = false;
  const reauth = async () => {
    if (retrying || !onUnauthorized) return;
    retrying = true;
    const ok = await onUnauthorized().catch(() => false);
    retrying = false;
    // Socket.io does not auto-retry after a middleware rejection.
    if (ok && socket && !socket.connected) socket.connect();
  };
  socket.on('connect_error', (err) => {
    if (err?.message === 'unauthorized') reauth();
  });
  // The server drops sockets of revoked sessions ("io server disconnect").
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') reauth();
  });
  return socket;
}

export const getSocket = () => socket;

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/** Emit and wait for the server's acknowledgement (resolves null after a timeout). */
export function emitWithAck(event, payload, timeout = 5000) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve(null);
    socket.timeout(timeout).emit(event, payload, (err, res) => resolve(err ? null : res));
  });
}

export function emit(event, payload) {
  if (socket?.connected) socket.emit(event, payload);
}

/**
 * Subscribe to a Socket.io event for the lifetime of a component. Works even
 * if the socket is created later, and the handler may change between renders.
 */
export function useSocketEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (...args) => ref.current?.(...args);
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  }, [event]);
}

/**
 * Join a server room (e.g. 'chat:join' / 'chat:leave') while mounted, and
 * re-join automatically after every reconnect. The server verifies access.
 */
export function useSocketRoom(joinEvent, leaveEvent, id) {
  useEffect(() => {
    if (!id) return undefined;
    const join = (s) => s.emit(joinEvent, id);
    connectHooks.add(join);
    if (socket?.connected) join(socket);
    return () => {
      connectHooks.delete(join);
      if (socket?.connected) socket.emit(leaveEvent, id);
    };
  }, [joinEvent, leaveEvent, id]);
}
