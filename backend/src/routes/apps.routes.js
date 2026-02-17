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

const appSchema = z.object({
  name: z.string().min(1, 'App name is required'),
  url: z.string().url('Must be a valid URL'),
  credentials: z.object({
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional(),
});

router.use(authenticate);

router.get('/', listApps);
router.post('/', validate(appSchema), createApp);
router.get('/:id', getApp);
router.put('/:id', validate(appSchema.partial()), updateApp);
router.delete('/:id', deleteApp);

export default router;
