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
import { transportConfig } from './services/transport/config.js';
import { correlationId } from './services/soc/monitors.js';
import { requestMetrics } from './services/soc/metrics.js';
import { captureRateLimited } from './middleware/error.js';
import { forceHttpsEnabled, httpsOnly, trustProxySetting } from './middleware/https.js';

/**
 * Origins the bus map may load its style, tiles, glyphs and sprites from: the
 * origin of MAP_STYLE_URL plus any extra https origins in MAP_CSP_ORIGINS
 * (comma-separated). Nothing else is added to the CSP.
 */
function mapCspOrigins() {
  const out = new Set();
  try {
    out.add(new URL(transportConfig().mapStyleUrl).origin);
  } catch {
    /* invalid MAP_STYLE_URL: no map origin allowed */
  }
  for (const o of String(process.env.MAP_CSP_ORIGINS || '').split(',')) {
    try {
      const u = new URL(o.trim());
      if (u.protocol === 'https:') out.add(u.origin);
    } catch {
      /* skip */
    }
  }
  return [...out];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

// Lives in middleware/https.js (socket.js needs it without importing the app).
export { trustProxySetting };

// SPA routes never contain a dot; anything that looks like a file path and is
// not a real built asset (/.env, /server/src/app.js, /render.yaml, *.map) is a
// plain 404 — never the backend file, and not index.html either.
const looksLikeFile = (p) => p.split('/').some((seg) => seg.includes('.'));

export function createApp({ forceHttps = forceHttpsEnabled() } = {}) {
  const app = express();
  const mapOrigins = mapCspOrigins();
  const CLIENT_DIST =process.env.CLIENT_DIST_DIR ? path.resolve(process.env.CLIENT_DIST_DIR) : DEFAULT_CLIENT_DIST;
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxySetting());

  // Plain HTTP never reaches the app when HTTPS is enforced (production default).
  app.use(httpsOnly(forceHttps));

  // Enterprise Security Headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      dnsPrefetchControl: { allow: false },
      // HTTPS only, subdomains included: two years when HTTPS is enforced,
      // otherwise one year in production — never in development, so a
      // plain-HTTP campus/dev server is not pinned to HTTPS by accident.
      strictTransportSecurity: forceHttps
        ? { maxAge: 63072000, includeSubDomains: true }
        : env.isProd
          ? { maxAge: 31536000, includeSubDomains: true }
          : false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', ...mapOrigins],
          // The bus map's style, tiles, glyphs and sprites come from the
          // configured map provider only (MAP_STYLE_URL / MAP_CSP_ORIGINS).
          'connect-src': ["'self'", 'ws:', 'wss:', ...mapOrigins],
          // MapLibre's CSP build runs its worker from our own origin.
          'worker-src': ["'self'", 'blob:'],
          // Every sub-resource over HTTPS when it is enforced; off only for a
          // plain-HTTP campus server (FORCE_HTTPS=false).
          'upgrade-insecure-requests': forceHttps ? [] : null,
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
  app.use(
    express.json({
      limit: '200kb',
      // The vehicle-tracker webhook is authenticated by an HMAC of its exact bytes.
      verify: (req, _res, buf) => {
        if (req.originalUrl?.startsWith('/api/transport/tracker/')) req.rawBody = buf.toString('utf8');
      },
    })
  );
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
  // SOC: a correlation ID on every API request (X-Request-Id), response
  // counters for error rates, and 429s recorded as rate-limit events.
  app.use('/api', correlationId, requestMetrics, captureRateLimited);
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
