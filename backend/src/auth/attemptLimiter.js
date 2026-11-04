import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/**
 * Counts failed sign-in guesses per visitor, for every door: the website and the chat assistant
 * both go through here, so opening a new chat doesn't give a guesser fresh tries.
 *
 * Personal codes get one more guard. A wrong code doesn't point to any patient, so it can't lock a
 * record. Instead, many failures across the whole clinic in a short time (someone spreading
 * guesses over many addresses) pause code sign-in for a while. The other sign-in methods keep
 * working during a pause.
 *
 * Counters live in memory: fine for one server, and a restart simply forgives everyone.
 */
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const MAX_TRACKED = 10_000;

export const ATTEMPT_RULES = Object.freeze({
  personal_code: { max: 5, windowMs: FIFTEEN_MINUTES, clinicMax: 50 },
  phone: { max: 10, windowMs: FIFTEEN_MINUTES },
});

export function createAttemptLimiter({ rules = ATTEMPT_RULES, now = () => Date.now() } = {}) {
  const failures = new Map(); // "kind:visitor" → { count, resetAt }
  const clinic = new Map(); // kind → { count, resetAt }

  const current = (map, key) => {
    const entry = map.get(key);
    return entry && entry.resetAt > now() ? entry : null;
  };

  function bump(map, key, windowMs) {
    const entry = current(map, key) ?? { count: 0, resetAt: now() + windowMs };
    entry.count += 1;
    map.set(key, entry);
    return entry;
  }

  function forgetExpired() {
    if (failures.size < MAX_TRACKED) return;
    for (const [key, entry] of failures) if (entry.resetAt <= now()) failures.delete(key);
  }

  return {
    /** Throws 429 if this visitor (or, for codes, the whole clinic) has used up its tries. */
    assertAllowed(kind, visitor) {
      if (!visitor) return; // the agent evals
      const rule = rules[kind];
      if (rule.clinicMax && (current(clinic, kind)?.count ?? 0) >= rule.clinicMax) {
        throw new AppError(429, 'sign_in_paused', 'This way of signing in is paused for a few minutes. Please use another one or try again soon.');
      }
      if ((current(failures, `${kind}:${visitor}`)?.count ?? 0) >= rule.max) {
        throw new AppError(429, 'too_many_attempts', 'Too many tries. Please wait 15 minutes and try again.');
      }
    },

    recordFailure(kind, visitor) {
      if (!visitor) return;
      const rule = rules[kind];
      forgetExpired();
      bump(failures, `${kind}:${visitor}`, rule.windowMs);
      if (rule.clinicMax && bump(clinic, kind, rule.windowMs).count === rule.clinicMax) {
        logger.warn(`Sign-in by ${kind} paused: ${rule.clinicMax} failures across the clinic in a short time.`);
      }
    },
  };
}

export const attempts = createAttemptLimiter();
