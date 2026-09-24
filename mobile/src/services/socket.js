import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { API_URL } from '../config';

/**
 * One Socket.io connection to the SAME server the web app uses. The server
 * authenticates the access token on connect and only lets the socket into
 * rooms it is authorised for (own user room, verified chat rooms).
 */
let socket = null;
const listeners = new Map();
const connectHooks = new Set();
const dispatch = (event, args) => listeners.get(event)?.forEach((fn) => fn(...args));

export function connectSocket(getToken, { onUnauthorized } = {}) {
  if (socket) return socket;
  socket = io(API_URL, {
    transports: ['websocket'],
    auth: (cb) => cb({ token: getToken() }),
    reconnectionDelayMax: 10000,
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
    if (ok && socket && !socket.connected) socket.connect();
  };
  socket.on('connect_error', (err) => {
    if (err?.message === 'unauthorized') reauth();
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') reauth();
  });
  return socket;
}

/** Android suspends background sockets; reconnect as soon as the app is foregrounded. */
AppState.addEventListener('change', (state) => {
  if (state === 'active' && socket && !socket.connected) socket.connect();
});

export const getSocket = () => socket;
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
export const emit = (event, payload) => socket?.connected && socket.emit(event, payload);
export const emitWithAck = (event, payload) =>
  new Promise((resolve) => {
    if (!socket?.connected) return resolve(null);
    socket.timeout(5000).emit(event, payload, (err, res) => resolve(err ? null : res));
  });

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
