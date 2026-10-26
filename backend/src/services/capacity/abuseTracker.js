/**
 * Off-topic and manipulation counters per person (signed-in user, or IP address for guests).
 *
 * The conversation keeps its own counter too, but a page refresh starts a new conversation —
 * so the person-level counter is what makes a cooldown stick. Counters forget events older
 * than one hour. (In memory: fine for one server; a restart simply forgives everyone.)
 *
 *   5 off-topic messages within an hour → 10-minute cooldown
 *   2 manipulation (injection) attempts within an hour → 1-hour cooldown
 */
const WINDOW_MS = 60 * 60 * 1000;
export const ABUSE_RULES = Object.freeze({
  off_topic: { threshold: 5, cooldownMs: 10 * 60 * 1000 },
  injection: { threshold: 2, cooldownMs: 60 * 60 * 1000 },
  abuse: { threshold: 2, cooldownMs: 60 * 60 * 1000 },
});

export function createAbuseTracker({ now = () => Date.now() } = {}) {
  const people = new Map(); // key → { events: [{kind, at}], blockedUntil }

  const entry = (key) => {
    if (!people.has(key)) people.set(key, { events: [], blockedUntil: 0 });
    return people.get(key);
  };

  /** Records a declined message; returns the block end time if this triggers a cooldown. */
  function record(keys, kind) {
    const rule = ABUSE_RULES[kind] ?? ABUSE_RULES.off_topic;
    let blockedUntil = 0;
    for (const key of keys.filter(Boolean)) {
      const person = entry(key);
      const t = now();
      person.events = person.events.filter((e) => t - e.at < WINDOW_MS);
      person.events.push({ kind, at: t });
      const count = person.events.filter((e) => e.kind === kind).length;
      if (count >= rule.threshold) {
        person.blockedUntil = Math.max(person.blockedUntil, t + rule.cooldownMs);
        person.events = person.events.filter((e) => e.kind !== kind); // start fresh after the cooldown
      }
      blockedUntil = Math.max(blockedUntil, person.blockedUntil);
    }
    return blockedUntil > now() ? new Date(blockedUntil) : null;
  }

  /** The latest block end time among the keys, or null. */
  function blockedUntil(keys) {
    const until = Math.max(0, ...keys.filter(Boolean).map((key) => people.get(key)?.blockedUntil ?? 0));
    return until > now() ? new Date(until) : null;
  }

  return { record, blockedUntil, size: () => people.size };
}
