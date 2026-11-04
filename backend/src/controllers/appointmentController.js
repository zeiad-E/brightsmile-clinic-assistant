import * as bookingService from '../services/bookingService.js';
import { startSession } from './authController.js';

/** POST /api/appointments — website booking (guest or signed-in patient). */
export async function book(req, res) {
  const { status, body, signIn } = await bookingService.bookAsVisitor({ user: req.user }, req.valid.body, req.idempotencyKey);
  // A failed sign-in must not hide the booking that already happened.
  const session = signIn ? await startSession(req, res, signIn).catch(() => null) : null;
  res.status(status).json({ ...body, session });
}
