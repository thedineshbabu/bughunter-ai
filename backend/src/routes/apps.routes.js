import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { query } from '../config/db.js';
import {
  createApp,
  deleteApp,
  getApp,
  listApps,
  updateApp,
} from '../controllers/apps.controller.js';

const router = Router();

const loginFlowStepSchema = z.object({
  action: z.enum(['fill', 'click', 'wait_for_navigation', 'wait_for_selector', 'wait']),
  selector: z.string().optional(),
  value: z.string().optional(),
  timeout: z.number().positive().optional(),
});

const appSchema = z.object({
  name: z.string().min(1, 'App name is required'),
  url: z.string().url('Must be a valid URL'),
  credentials: z.object({
    username: z.string().optional(),
    password: z.string().optional(),
    login_flow: z.array(loginFlowStepSchema).min(1).optional(),
  }).optional(),
});

router.use(authenticate);

router.get('/', listApps);
router.post('/', validate(appSchema), createApp);
router.get('/:id', getApp);
router.put('/:id', validate(appSchema.partial()), updateApp);
router.delete('/:id', deleteApp);

/**
 * GET /api/apps/:id/memory
 * Returns the agent memory blob for an app (login steps, page scores, known bugs).
 * Ownership is verified: the app must belong to the authenticated user.
 */
router.get('/:id/memory', async (req, res, next) => {
  try {
    const ownerCheck = await query(
      'SELECT id FROM apps WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (ownerCheck.rows.length === 0) return res.status(404).json({ error: 'App not found' });

    const result = await query(
      'SELECT data, updated_at FROM app_memory WHERE app_id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.json({ data: null });
    res.json({ data: result.rows[0].data, updated_at: result.rows[0].updated_at });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/apps/:id/memory
 * Clears the agent memory for an app so the next run starts fresh.
 */
router.delete('/:id/memory', async (req, res, next) => {
  try {
    const ownerCheck = await query(
      'SELECT id FROM apps WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (ownerCheck.rows.length === 0) return res.status(404).json({ error: 'App not found' });

    await query('DELETE FROM app_memory WHERE app_id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
