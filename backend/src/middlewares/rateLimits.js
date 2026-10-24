import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

/**
 * Limits how often one IP address may call us.
 *
 * Why: the demo is public and runs on free tiers. Without limits, one bot could guess
 * sign-in codes, spam bookings, or burn our email quota.
 *
 * Counters live in memory — fine for our single Render instance. (With several servers
 * they would need a shared store such as Redis.)
 *
 * Created per app (see routes/index.js), so every test starts with fresh counters.
 */
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function limiter(windowMs, limit, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8', // tells the client how many tries are left
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'rate_limited', message)),
  });
}

export function createRateLimits({ enabled = true } = {}) {
  const off = (_req, _res, next) => next();
  if (!enabled) return { api: off, auth: off, code: off, booking: off };

  return {
    // Everything under /api.
    api: limiter(FIFTEEN_MINUTES, 300, 'Too many requests. Please slow down.'),
    // Sign-in, email codes, refresh.
    auth: limiter(FIFTEEN_MINUTES, 10, 'Too many sign-in attempts. Please wait 15 minutes.'),
    // Personal-code sign-in: the database has no lockout for codes, so this limit is the guard.
    code: limiter(FIFTEEN_MINUTES, 5, 'Too many code attempts. Please wait 15 minutes.'),
    // Creating bookings.
    booking: limiter(ONE_HOUR, 20, 'Too many booking attempts. Please try again later.'),
  };
}
