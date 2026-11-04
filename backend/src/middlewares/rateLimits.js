import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
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
    keyGenerator: (req) => ipKeyGenerator(req.clientIp),
    skip: (req) => Boolean(req.evalCase), // the agent evals (see middlewares/evalPass.js)
    handler: (_req, _res, next) => next(new AppError(429, 'rate_limited', message)),
  });
}

export function createRateLimits({ enabled = true } = {}) {
  const off = (_req, _res, next) => next();
  if (!enabled) return { api: off, auth: off, code: off, refresh: off, booking: off, chat: off };

  return {
    // Everything under /api.
    api: limiter(FIFTEEN_MINUTES, 300, 'Too many requests. Please slow down.'),
    // Sign-in, email codes, refresh.
    auth: limiter(FIFTEEN_MINUTES, 10, 'Too many sign-in attempts. Please wait 15 minutes.'),
    // Personal-code sign-in and email codes: wrong guesses.
    code: limiter(FIFTEEN_MINUTES, 5, 'Too many code attempts. Please wait 15 minutes.'),
    // Keeping a session alive happens every 15 minutes per tab, from every device behind one router.
    refresh: limiter(FIFTEEN_MINUTES, 120, 'Too many requests. Please wait a moment.'),
    // Creating bookings.
    booking: limiter(ONE_HOUR, 20, 'Too many booking attempts. Please try again later.'),
    // Chat messages: each one costs AI calls on free tiers.
    chat: limiter(60 * 1000, 20, 'You are sending messages too quickly. Please wait a moment.'),
  };
}
