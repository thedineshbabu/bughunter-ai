import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate, validateQuery } from '../middleware/validate.js';
import {
  createRun,
  deleteRun,
  getRun,
  listRuns,
  updateRun,
} from '../controllers/runs.controller.js';

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
});

const listRunsQuerySchema = z.object({
  app_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const updateRunSchema = z.object({
  status:  z.enum(['pending', 'running', 'completed', 'failed']),
  summary: z.record(z.unknown()).optional(),
  error:   z.string().optional(),
});

// Agent-facing PATCH route — authenticated via shared secret, not JWT
router.patch('/:id', authenticateAgent, validate(updateRunSchema), updateRun);

router.use(authenticate);

router.get('/', validateQuery(listRunsQuerySchema), listRuns);
router.post('/', validate(createRunSchema), createRun);
router.get('/:id', getRun);
router.delete('/:id', deleteRun);

export default router;
