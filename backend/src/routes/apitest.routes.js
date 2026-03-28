/**
 * BugHunter.AI — API Testing Routes
 * Proxies requests to the Python agent Flask server for OpenAPI spec parsing
 * and AI-generated API test execution with SSE streaming.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';

const router = Router();
const AGENT_FLASK_URL = process.env.AGENT_FLASK_URL || 'http://localhost:5001';

router.use(authenticate);

/**
 * POST /api/apitest/upload
 * Parse an OpenAPI/Swagger JSON spec and return the endpoint list.
 * Body: { spec_content: string }
 */
router.post('/upload', async (req, res, next) => {
  try {
    const { spec_content } = req.body;
    if (!spec_content) return res.status(400).json({ error: 'spec_content is required' });

    const pyRes = await fetch(`${AGENT_FLASK_URL}/apitest/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec_content }),
    });

    if (!pyRes.ok) {
      const err = await pyRes.text();
      return res.status(502).json({ error: `Agent server error: ${err}` });
    }

    res.json(await pyRes.json());
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/apitest/collection-stream
 * SSE: AI-generate test cases and execute them against the target API.
 * Body: { spec: string, base_url: string }
 */
router.post('/collection-stream', async (req, res, next) => {
  const { spec, base_url } = req.body;
  if (!spec) return res.status(400).json({ error: 'spec is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  try {
    const pyRes = await fetch(`${AGENT_FLASK_URL}/apitest/collection-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec, base_url: base_url || '' }),
    });

    if (!pyRes.ok) {
      clearInterval(ping);
      res.write(`data: ${JSON.stringify({ error: `Agent error: ${pyRes.status}` })}\n\n`);
      res.end();
      return;
    }

    // Pipe the SSE stream from Python to the browser
    const reader = pyRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    clearInterval(ping);
    res.end();
  }
});

export default router;
