import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './lib/config';
import { logStore } from './lib/logger';
import { ValidationError } from './lib/validate';
import { RobloxApiError } from './lib/http';
import { inventoryRouter } from './routes/inventory';
import { savedRouter } from './routes/saved';
import { searchRouter } from './routes/search';
import { systemRouter } from './routes/system';
import { usersRouter } from './routes/users';

/* ------------------------------ simple throttle ----------------------------- */

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();
const BUCKET_CAPACITY = 240;
const REFILL_PER_SEC = 40;

/**
 * Per-IP token bucket.
 * Protects both this server and, transitively, the Roblox APIs: a client that
 * floods us cannot make us flood them.
 */
function throttle(req: Request, res: Response, next: NextFunction): void {
  const key = (req.ip ?? req.socket.remoteAddress ?? 'unknown').toString();
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: BUCKET_CAPACITY, updated: now };

  bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + ((now - bucket.updated) / 1000) * REFILL_PER_SEC);
  bucket.updated = now;

  if (bucket.tokens < 1) {
    res.setHeader('Retry-After', '2');
    res.status(429).json({ ok: false, error: 'Too many requests — slow down' });
    return;
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);

  // Opportunistic cleanup so the map cannot grow without bound.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (now - b.updated > 60_000) buckets.delete(k);
    }
  }
  next();
}

/** Conservative security headers without pulling in another dependency. */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(securityHeaders);
  app.use(
    cors({
      origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(',').map((s) => s.trim()),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', throttle);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'vesper-api', time: Date.now(), mockMode: config.mockMode });
  });

  app.use('/api/users', usersRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/saved', savedRouter);
  // inventory/assets/thumbnails all live under /api but have their own prefixes
  app.use('/api', inventoryRouter);
  app.use('/api', systemRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'Endpoint not found' });
  });

  // Never leak stack traces or upstream response bodies to the client.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ ok: false, error: err.message, field: err.field });
      return;
    }
    if (err instanceof RobloxApiError) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      logStore.push('error', `${err.kind}: ${err.message}`, { status: err.status, detail: err.detail ?? null });
      res.status(status).json({ ok: false, error: err.message, kind: err.kind });
      return;
    }
    const e = err as Error;
    logStore.push('error', `Unhandled error: ${e?.message ?? 'unknown'}`, { detail: e?.stack?.split('\n')[0] ?? null });
    res.status(500).json({ ok: false, error: 'Something went wrong' });
  });

  return app;
}
