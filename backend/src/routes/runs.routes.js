import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate, validateQuery } from '../middleware/validate.js';
import {
  createRun,
  deleteRun,
  getRun,
  listRuns,
  pauseRun,
  resumeRun,
  stopRun,
  updateRun,
} from '../controllers/runs.controller.js';
import { query } from '../config/db.js';
import { createSubscriber } from '../config/redis.js';

/** Middleware: accept requests from the Python agent via a shared secret header */
function authenticateAgent(req, res, next) {
  const secret = process.env.AGENT_API_SECRET;
  if (!secret || req.headers['x-agent-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const router = Router();

const createRunSchema = z.object({
  app_id: z.string().uuid('Must be a valid app UUID'),
  notes: z.string().optional(),
  test_config: z.object({
    max_pages:              z.number().int().min(1).max(20).optional(),
    instructions:           z.string().optional(),
    focus_areas:            z.string().optional(),
    screenshot_login_steps: z.boolean().optional(),
    detailed_report:        z.boolean().optional(),
  }).optional(),
});

const listRunsQuerySchema = z.object({
  app_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'paused']).optional(),
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const updateRunSchema = z.object({
  status:  z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'paused']),
  summary: z.record(z.unknown()).optional(),
  error:   z.string().optional(),
});

// Agent-facing PATCH route — authenticated via shared secret, not JWT
router.patch('/:id', authenticateAgent, validate(updateRunSchema), updateRun);

/**
 * GET /api/runs/:id/stream
 * SSE endpoint: streams live agent progress events for an active run.
 * EventSource cannot send Authorization headers, so we accept ?token= query param.
 */
router.get('/:id/stream', async (req, res) => {
  // Authenticate via query param token (EventSource limitation)
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  let userId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const runId = req.params.id;
  try {
    const result = await query(
      'SELECT id, status FROM test_runs WHERE id = $1 AND user_id = $2',
      [runId, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Run not found' });
  } catch {
    return res.status(500).json({ error: 'Database error' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  const channel = `bughunter:run:${runId}:progress`;
  const subscriber = createSubscriber();

  try {
    await subscriber.connect();
    await subscriber.subscribe(channel, (message) => {
      res.write(`data: ${message}\n\n`);
    });
  } catch {
    clearInterval(ping);
    res.end();
    return;
  }

  req.on('close', async () => {
    clearInterval(ping);
    try { await subscriber.unsubscribe(channel); await subscriber.disconnect(); } catch { /* ignore */ }
  });
});

router.use(authenticate);

router.get('/', validateQuery(listRunsQuerySchema), listRuns);
router.post('/', validate(createRunSchema), createRun);
router.get('/:id', getRun);
router.delete('/:id', deleteRun);
router.post('/:id/stop', stopRun);
router.post('/:id/pause', pauseRun);
router.post('/:id/resume', resumeRun);

/**
 * POST /api/runs/:id/generate-tests
 * Fetches bug reports for a completed run and calls the Python agent API
 * server to generate a Gherkin .feature file from the findings.
 */
router.post('/:id/generate-tests', async (req, res, next) => {
  try {
    const runResult = await query(
      `SELECT r.id, r.status, a.url AS app_url
       FROM test_runs r
       LEFT JOIN apps a ON r.app_id = a.id
       WHERE r.id = $1 AND r.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (runResult.rows.length === 0) return res.status(404).json({ error: 'Run not found' });
    const run = runResult.rows[0];

    if (run.status !== 'completed') {
      return res.status(400).json({ error: 'Run must be completed before generating tests' });
    }

    const bugsResult = await query(
      'SELECT title, description, steps_to_reproduce, expected_behavior, actual_behavior, severity, page_url FROM bug_reports WHERE run_id = $1 ORDER BY severity, created_at',
      [req.params.id]
    );

    if (bugsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No bugs found in this run to generate tests from' });
    }

    const agentFlaskUrl = process.env.AGENT_FLASK_URL || 'http://localhost:5001';
    const pyRes = await fetch(`${agentFlaskUrl}/generate-tests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: run.id, bugs: bugsResult.rows, app_url: run.app_url }),
    });

    if (!pyRes.ok) {
      const err = await pyRes.text();
      return res.status(502).json({ error: `Agent server error: ${err}` });
    }

    const data = await pyRes.json();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
