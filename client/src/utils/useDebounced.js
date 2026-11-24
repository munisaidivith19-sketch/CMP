import { useEffect, useState } from 'react';

/**
 * The value, once it has stopped changing for `ms` milliseconds. Search boxes
 * pass their text through this so a word typed is one request, not one per
 * keystroke (and the list does not flicker while typing).
 */
export function useDebounced(value, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
