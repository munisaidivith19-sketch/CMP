import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import morgan from 'morgan';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/error.js';
import { UPLOAD_ROOT, readStoredFile } from './utils/storage.js';
import { inputHygieneGuard, csrfAndOriginGuard } from './middleware/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

/**
 * How many reverse-proxy hops to trust for X-Forwarded-For, so req.ip (rate
 * limits, sign-in lockouts, audit logs) is the real visitor and not the proxy.
 * TRUST_PROXY=<hops> sets it (1 = Render; 2 = Cloudflare in front of Render),
 * TRUST_PROXY=false turns it off. Unset: 1 in production — the app is always
 * deployed behind a proxy there, and trusting none would make every visitor
 * share the proxy's IP (one attacker could lock everyone out) — and off in
 * development, where a client could otherwise spoof its IP with the header.
 * A hop count, never `true`: trusting every hop lets a client pick its own IP.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY, isProd = env.isProd) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'off') return false;
  const hops = Number.parseInt(v, 10);
  if (Number.isInteger(hops) && hops > 0) return Math.min(hops, 5);
  return isProd ? 1 : false;
}

// SPA routes never contain a dot; anything that looks like a file path and is
// not a real built asset (/.env, /server/src/app.js, /render.yaml, *.map) is a
// plain 404 — never the backend file, and not index.html either.
const looksLikeFile = (p) => p.split('/').some((seg) => seg.includes('.'));

export function createApp() {
  const app = express();
  const CLIENT_DIST = process.env.CLIENT_DIST_DIR ? path.resolve(process.env.CLIENT_DIST_DIR) : DEFAULT_CLIENT_DIST;
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxySetting());

  // Enterprise Security Headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      dnsPrefetchControl: { allow: false },
      // HTTPS only, for a year, subdomains included — production only, so a
      // plain-HTTP campus/dev server is never pinned to HTTPS by accident.
      strictTransportSecurity: env.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          // Allow plain-HTTP hosting on a local campus server (enable when behind HTTPS).
          'upgrade-insecure-requests': null,
        },
      },
    })
  );

  // Modern Permissions-Policy header
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
    next();
  });

  app.use(cors({ origin: env.clientUrls, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));
  app.use(cookieParser());
  app.use(mongoSanitize()); // strips $ and . keys → blocks NoSQL operator injection
  app.use(inputHygieneGuard); // HPP defense + null-byte stripping + pagination hard-cap

  if (!env.isProd && process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  // Uploaded files
  app.use(
    '/uploads',
    express.static(UPLOAD_ROOT, {
      maxAge: '7d',
      setHeaders: (res) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
      },
    })
  );

  // Files kept in the database (production without Cloudinary).
  app.get('/uploads/:filename', async (req, res, next) => {
    try {
      const file = await readStoredFile(req.params.filename);
      if (!file) return next();
      res.set({
        'Content-Type': file.mimeType,
        'Cache-Control': 'public, max-age=604800, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      });
      res.send(Buffer.from(file.data));
    } catch (err) {
      next(err);
    }
  });

  // API responses carry account data: never cache them in the browser or a
  // shared proxy (a handler may still set its own, stricter or streaming, value).
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  app.use('/api', apiLimiter, csrfAndOriginGuard, routes);
  app.use('/api', notFound);

  // The built web app (client/dist) is the only other thing served — never
  // server/, .env, config or source. express.static ignores dotfiles, and
  // source maps are refused even if a build ever emits them.
  if (fs.existsSync(CLIENT_DIST)) {
    // Vulnerability-report contact (RFC 9116), from client/public/.well-known.
    app.use('/.well-known', express.static(path.join(CLIENT_DIST, '.well-known'), { index: false, dotfiles: 'deny', fallthrough: true }));
    app.use((req, res, next) => (/\.map$/i.test(req.path) ? notFound(req, res) : next()));
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h', dotfiles: 'ignore' }));
    app.get('*', (req, res, next) => (looksLikeFile(req.path) ? next() : res.sendFile(path.join(CLIENT_DIST, 'index.html'))));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
