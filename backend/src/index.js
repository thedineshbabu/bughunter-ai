import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createLogger, format, transports } from 'winston';

import authRoutes from './routes/auth.routes.js';
import appsRoutes from './routes/apps.routes.js';
import runsRoutes from './routes/runs.routes.js';
import bugsRoutes from './routes/bugs.routes.js';

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

// ── App ──────────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'bughunter-api', timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/apps', appsRoutes);
app.use('/api/runs', runsRoutes);
app.use('/api/bugs', bugsRoutes);

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
