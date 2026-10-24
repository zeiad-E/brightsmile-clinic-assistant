import { Router } from 'express';
import * as appointments from '../controllers/appointmentController.js';
import { validate } from '../middlewares/validate.js';
import { idempotencyKey } from '../middlewares/idempotencyKey.js';
import { BookBody } from '../validators/appointments.js';

/** /api/appointments — booking from the website (guest or signed-in patient). */
export function appointmentsRouter(limits) {
  const router = Router();

  router.post('/', limits.booking, idempotencyKey(), validate({ body: BookBody }), appointments.book);

  return router;
}
