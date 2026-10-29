import { Router } from 'express';
import { chatRouter } from './chat.js';
import { authRouter } from './auth.js';
import { publicRouter } from './public.js';
import { appointmentsRouter } from './appointments.js';
import { meRouter } from './me.js';
import { staffRouter } from './staff.js';
import { adminRouter } from './admin.js';
import { authenticate } from '../middlewares/authenticate.js';
import { createRateLimits } from '../middlewares/rateLimits.js';

/**
 * Everything under /api.
 *
 * Every request first passes the general rate limit and authenticate() (which sets
 * req.user, or leaves it null for visitors); each router then decides who may enter.
 */
export function createApiRouter({ rateLimit = true } = {}) {
  const limits = createRateLimits({ enabled: rateLimit });
  const router = Router();

  router.use(limits.api);
  router.use(authenticate());

  router.use('/auth', authRouter(limits));
  router.use('/appointments', appointmentsRouter(limits));
  router.use('/me', meRouter(limits));
  router.use('/staff', staffRouter(limits));
  router.use('/admin', adminRouter());
  router.use('/chat', chatRouter(limits));
  router.use(publicRouter());

  return router;
}
