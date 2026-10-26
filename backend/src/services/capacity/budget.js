/**
 * Daily budgets, so one person (or a bot) can't use up the clinic's free AI quota.
 *
 *  - per person (user, or IP for guests): messages per day and tokens per day
 *  - clinic-wide: tokens per day. At 90% the assistant switches to SAFE MODE (answers from
 *    the knowledge base and hands over to staff); at 100% it stops using the AI for the day.
 *
 * "Today" is the clinic's day (Cairo). Counters live in memory; the clinic-wide total is
 * re-read from agent_runs once per day/restart, so a restart doesn't forget today's usage.
 */
import { dayInZone } from '../../utils/clinicTime.js';

export function createBudget({ perPersonMessages, perPersonTokens, clinicTokens, safeModeAt = 0.9, loadClinicUsage, now = () => new Date() }) {
  let day = null;
  let clinicUsed = 0;
  let loaded = null; // promise of the initial clinic total for `day`
  const people = new Map(); // key → { messages, tokens }

  async function rollOver() {
    const today = dayInZone(now());
    if (today === day) return loaded;
    day = today;
    people.clear();
    clinicUsed = 0;
    loaded = (loadClinicUsage ? loadClinicUsage(today) : Promise.resolve(0))
      .then((used) => {
        clinicUsed += used;
      })
      .catch(() => {});
    return loaded;
  }

  const person = (key) => {
    if (!people.has(key)) people.set(key, { messages: 0, tokens: 0 });
    return people.get(key);
  };

  /**
   * Called before a turn. Returns { allowed, mode } where mode is 'normal' | 'safe' | 'off',
   * or { allowed: false, reason: 'person_messages' | 'person_tokens' }.
   */
  async function check(keys) {
    await rollOver();
    for (const key of keys.filter(Boolean)) {
      const p = person(key);
      if (p.messages >= perPersonMessages) return { allowed: false, reason: 'person_messages' };
      if (p.tokens >= perPersonTokens) return { allowed: false, reason: 'person_tokens' };
    }
    const share = clinicUsed / clinicTokens;
    return { allowed: true, mode: share >= 1 ? 'off' : share >= safeModeAt ? 'safe' : 'normal' };
  }

  async function recordMessage(keys) {
    await rollOver();
    for (const key of keys.filter(Boolean)) person(key).messages += 1;
  }

  async function recordTokens(keys, tokens) {
    if (!tokens) return;
    await rollOver();
    clinicUsed += tokens;
    for (const key of keys.filter(Boolean)) person(key).tokens += tokens;
  }

  return {
    check,
    recordMessage,
    recordTokens,
    stats: () => ({ day, clinicUsed, clinicTokens, share: clinicTokens ? clinicUsed / clinicTokens : 0, people: people.size }),
  };
}
