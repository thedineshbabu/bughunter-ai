import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate, validateQuery } from '../middleware/validate.js';
import {
  deleteBug,
  getBug,
  listBugs,
  updateBugStatus,
} from '../controllers/bugs.controller.js';

const router = Router();

const statusSchema = z.object({
  status: z.enum(['open', 'confirmed', 'fixed', 'wontfix']),
});

const listBugsQuerySchema = z.object({
  run_id:   z.string().uuid().optional(),
  app_id:   z.string().uuid().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  status:   z.enum(['open', 'confirmed', 'fixed', 'wontfix']).optional(),
  page:     z.coerce.number().int().positive().default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
});

router.use(authenticate);

router.get('/', validateQuery(listBugsQuerySchema), listBugs);
router.get('/:id', getBug);
router.put('/:id/status', validate(statusSchema), updateBugStatus);
router.delete('/:id', deleteBug);

export default router;
