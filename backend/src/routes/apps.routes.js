import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
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

export default router;
