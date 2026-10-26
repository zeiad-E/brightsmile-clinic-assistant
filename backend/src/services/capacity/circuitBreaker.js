/**
 * Circuit breaker for the AI: if many turns fail within a short time (the free providers are
 * down or overloaded), stop calling the AI for a few minutes instead of making every patient
 * wait 45 s for a failure. Patients get a clear "please call / book on the website" meanwhile.
 *
 * Like a fuse box: too many failures "trip" it (open). After the cool-down one turn is let
 * through as a test (half-open); if it works, normal service resumes (closed).
 */
export function createCircuitBreaker({ failureThreshold = 5, windowMs = 5 * 60 * 1000, openMs = 3 * 60 * 1000, now = () => Date.now() } = {}) {
  let failures = [];
  let openedAt = 0;
  let state = 'closed';

  function current() {
    if (state === 'open' && now() - openedAt >= openMs) state = 'half_open';
    return state;
  }

  return {
    /** May a turn use the AI right now? */
    allows() {
      return current() !== 'open';
    },
    success() {
      failures = [];
      state = 'closed';
    },
    failure() {
      const t = now();
      if (current() === 'half_open') {
        state = 'open';
        openedAt = t;
        return;
      }
      failures = failures.filter((at) => t - at < windowMs);
      failures.push(t);
      if (failures.length >= failureThreshold) {
        state = 'open';
        openedAt = t;
        failures = [];
      }
    },
    stats: () => ({ state: current(), recentFailures: failures.length, openedAt: openedAt ? new Date(openedAt).toISOString() : null }),
  };
}
