import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createLogger, format, transports } from 'winston';

import authRoutes from './routes/auth.routes.js';
import appsRoutes from './routes/apps.routes.js';
import runsRoutes from './routes/runs.routes.js';
import bugsRoutes from './routes/bugs.routes.js';
import apitestRoutes from './routes/apitest.routes.js';

// ── Logger ──────────────────────────────────────────────────────────────────
export const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.colorize(),
    format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
  ),
  transports: [new transports.Console()],
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

// ── Static screenshots (served from agent/screenshots/) ───────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const screenshotsDir = join(__dirname, '../../agent/screenshots');
app.use('/screenshots', express.static(screenshotsDir));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'bughunter-api', timestamp: new Date().toISOString() });
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
  logger.info(`🐛 BugHunter API running on http://localhost:${PORT}`);
});

export default app;
