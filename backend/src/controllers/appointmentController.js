import * as bookingService from '../services/bookingService.js';

/** POST /api/appointments — website booking (guest or signed-in patient). */
export async function book(req, res) {
  const { status, body } = await bookingService.bookAsVisitor({ user: req.user }, req.valid.body, req.idempotencyKey);
  res.status(status).json(body);
}
