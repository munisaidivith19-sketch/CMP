import { useSyncExternalStore } from 'react';

/**
 * App-wide "can we reach the server?" flag. Fed by the socket (connect /
 * disconnect) and by every API request (network error vs. any HTTP answer),
 * so the banner reflects reality without an extra native NetInfo module.
 */
let online = true;
const subs = new Set();

export function setOnline(value) {
  if (online === value) return;
  online = value;
  subs.forEach((fn) => fn());
}

export const isOnline = () => online;

export function subscribeOnline(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, isOnline);
}
