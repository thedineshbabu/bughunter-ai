import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createLogger, format, transports } from 'winston';

import authRoutes from './routes/auth.routes.js';
import appsRoutes from './routes/apps.routes.js';
import runsRoutes from './routes/runs.routes.js';
import bugsRoutes from './routes/bugs.routes.js';
import apitestRoutes from './routes/apitest.routes.js';
import { startReaper } from './jobs/staleRunReaper.js';

// ── Logger ──────────────────────────────────────────────────────────────────
export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.json(),
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}]: ${message}${extra}`;
        }),
      ),
    }),
  ],
});

// ── Startup assertions — fail fast on missing/weak secrets ──────────────────
const requiredEnv = [
  { key: 'JWT_SECRET',                  minLen: 32, hint: 'generate with: openssl rand -hex 32' },
  { key: 'CREDENTIALS_ENCRYPTION_KEY',  minLen: 64, hint: 'generate with: openssl rand -hex 32 (must be 32-byte hex = 64 chars)' },
];

for (const { key, minLen, hint } of requiredEnv) {
  const val = process.env[key];
  if (!val || val.length < minLen) {
    logger.error(`FATAL: ${key} must be set and at least ${minLen} characters. ${hint}`);
    process.exit(1);
  }
}

// ── App ──────────────────────────────────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── Global API rate limiter (100 req / 15 min per IP) ────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);

// ── Request logging ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: duration,
      ip: req.ip,
    });
  });
  next();
});

// ── Static screenshots (served from agent/screenshots/) ───────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const screenshotsDir = join(__dirname, '../../agent/screenshots');
app.use('/screenshots', express.static(screenshotsDir));

// ── Health check (deep — verifies DB + Redis) ──────────────────────────────
app.get('/health', async (_req, res) => {
  const checks = { db: 'ok', redis: 'ok' };
  let status = 200;

  try {
    const { query: dbQuery } = await import('./config/db.js');
    await dbQuery('SELECT 1');
  } catch {
    checks.db = 'error';
    status = 503;
  }

  try {
    const redisModule = await import('./config/redis.js');
    await redisModule.default.ping();
  } catch {
    checks.redis = 'error';
    status = 503;
  }

  res.status(status).json({
    status: status === 200 ? 'ok' : 'degraded',
    service: 'bughunter-api',
    timestamp: new Date().toISOString(),
    uptime_s: Math.floor(process.uptime()),
    checks,
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/apps', appsRoutes);
app.use('/api/runs', runsRoutes);
app.use('/api/bugs', bugsRoutes);
app.use('/api/apitest', apitestRoutes);

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ──────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`BugHunter API running on http://localhost:${PORT}`);
  startReaper();
});

export default app;
