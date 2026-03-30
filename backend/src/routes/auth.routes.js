import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { login, me, register, updateProfile } from '../controllers/auth.controller.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  current_password: z.string().optional(),
  new_password: z.string().min(8).optional(),
});

router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/login', authLimiter, validate(loginSchema), login);
router.get('/me', authenticate, me);
router.patch('/profile', authenticate, validate(updateProfileSchema), updateProfile);

export default router;
