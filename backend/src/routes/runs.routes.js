import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createRun,
  deleteRun,
  getRun,
  listRuns,
} from '../controllers/runs.controller.js';

const router = Router();

const createRunSchema = z.object({
  app_id: z.string().uuid('Must be a valid app UUID'),
  notes: z.string().optional(),
});

router.use(authenticate);

router.get('/', listRuns);
router.post('/', validate(createRunSchema), createRun);
router.get('/:id', getRun);
router.delete('/:id', deleteRun);

export default router;
