import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
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

router.use(authenticate);

router.get('/', listBugs);
router.get('/:id', getBug);
router.put('/:id/status', validate(statusSchema), updateBugStatus);
router.delete('/:id', deleteBug);

export default router;
