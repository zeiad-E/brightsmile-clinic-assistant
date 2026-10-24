import { z } from 'zod';
import { AppError } from '../utils/AppError.js';

/**
 * Requires an `Idempotency-Key: <uuid>` header on actions that must never happen twice
 * (creating a booking).
 *
 * The frontend makes ONE key per booking attempt and reuses it on retries. If a
 * double-click or a flaky network sends the same request twice, the database sees the
 * same key and returns the first booking instead of creating a second one.
 * Like a receipt number: the same receipt can't be paid twice.
 *
 * A random UUID can't be guessed, so nobody can replay someone else's key.
 */
const Key = z.uuid();

export function idempotencyKey() {
  return (req, _res, next) => {
    const parsed = Key.safeParse(req.get('idempotency-key'));
    if (!parsed.success) {
      return next(
        AppError.badRequest('idempotency_key_required', 'Send a new UUID in the Idempotency-Key header for each booking.'),
      );
    }
    req.idempotencyKey = parsed.data;
    return next();
  };
}
