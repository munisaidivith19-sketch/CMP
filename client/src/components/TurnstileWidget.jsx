import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile (CAPTCHA) widget. Shown only when the server asks for
 * it (sign-in after recent failures from this network); the server verifies
 * the token with Cloudflare — the browser never decides.
 *
 * Tokens are single-use: bump `resetKey` after every request that sent one
 * and the widget fetches a fresh token (onToken(null) until it arrives).
 */
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable')));
      s.onerror = () => {
        scriptPromise = null; // allow a retry on the next render
        reject(new Error('Turnstile failed to load'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export default function TurnstileWidget({ siteKey, action, onToken, resetKey = 0, onLoadError }) {
  const ref = useRef(null);
  const widgetId = useRef(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const onErrorRef = useRef(onLoadError);
  onErrorRef.current = onLoadError;

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !ref.current) return;
        widgetId.current = ts.render(ref.current, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        onTokenRef.current(null);
        onErrorRef.current?.();
      });
    return () => {
      cancelled = true;
      if (widgetId.current != null && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (!resetKey || widgetId.current == null || !window.turnstile) return;
    onTokenRef.current(null);
    window.turnstile.reset(widgetId.current);
  }, [resetKey]);

  return <div ref={ref} className="flex min-h-[65px] justify-center" aria-label="Security check" />;
}
