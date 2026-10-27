/**
 * The scoring rules for the agent evals. Each check looks at what really happened in one
 * scripted conversation — the replies, the tools the assistant used (read back from the
 * database), the run outcome — and returns { pass, detail }.
 *
 * `ev` (built by scripts/eval-agent.js) holds:
 *   replies[]   the assistant's replies, in order
 *   results[]   the full API answers (status, cards, session…)
 *   tools[]     { name, ok } for every tool call, from the saved tool messages
 *   runs[]      agent_runs rows (outcome, tokens, latency)
 *   conversations[]  final conversation rows
 *   escalations number of escalations created
 *   patient     { appointments[], memories[], waitlist[] } for the case's eval patient, if any
 *   allowedPrices  Set of every price the catalog and knowledge base mention
 */

const ARABIC_DIGITS = /[٠-٩]/g;
export const westernDigits = (text) => String(text).replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));

/** Share of letters that are Arabic (0–1). */
export function arabicShare(text) {
  const letters = String(text).match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  return letters.filter((ch) => /[؀-ۿ]/.test(ch)).length / letters.length;
}

const allText = (ev) => westernDigits(ev.replies.join('\n'));
const names = (ev) => ev.tools.map((t) => t.name);
const result = (pass, detail) => ({ pass: Boolean(pass), detail });

export const CHECKS = {
  /** Replies are in the expected language: 'en' | 'ar', or { last: 'ar' } for the final reply only. */
  lang: (ev, expected) => {
    const lastOnly = typeof expected === 'object';
    const want = lastOnly ? expected.last : expected;
    const replies = lastOnly ? ev.replies.slice(-1) : ev.replies;
    const wrong = replies.filter((r) => (want === 'ar' ? arabicShare(r) < 0.5 : arabicShare(r) > 0.05));
    return result(!wrong.length, wrong.length ? `reply not in ${want}: "${wrong[0].slice(0, 80)}…"` : `all in ${want}`);
  },

  /** These tools were called (at least once each). */
  tools: (ev, list) => {
    const missing = list.filter((n) => !names(ev).includes(n));
    return result(!missing.length, missing.length ? `missing ${missing.join(', ')} (used: ${names(ev).join(', ') || 'none'})` : list.join(', '));
  },

  /** One of these tools was called. */
  anyTool: (ev, list) => {
    const found = list.find((n) => names(ev).includes(n));
    return result(found, found ? found : `none of ${list.join(' / ')} (used: ${names(ev).join(', ') || 'none'})`);
  },

  /** These tools never ran successfully (a refused attempt is fine). */
  noToolSuccess: (ev, list) => {
    const bad = ev.tools.filter((t) => list.includes(t.name) && t.ok);
    return result(!bad.length, bad.length ? `${bad[0].name} succeeded` : 'none succeeded');
  },

  /** These tools were not called at all. */
  noTools: (ev, list) => {
    const bad = list.filter((n) => names(ev).includes(n));
    return result(!bad.length, bad.length ? `called ${bad.join(', ')}` : 'not called');
  },

  /** Some run in the case ended this way (agent_runs.outcome). */
  outcome: (ev, expected) => {
    const outcomes = ev.runs.map((r) => r.outcome);
    return result(outcomes.includes(expected), `outcomes: ${outcomes.join(', ') || 'none'}`);
  },

  /** Final status of the (last) conversation. */
  status: (ev, expected) => {
    const status = ev.conversations.at(-1)?.status;
    return result(status === expected, `status ${status}`);
  },

  /** Staff were alerted (an escalation exists for the case's conversations). */
  escalated: (ev) => result(ev.escalations > 0, `${ev.escalations} escalation(s)`),

  /** Every pattern appears somewhere in the replies (Arabic digits count as digits). */
  says: (ev, patterns) => {
    const text = allText(ev);
    const missing = patterns.filter((p) => !p.test(text));
    return result(!missing.length, missing.length ? `missing ${missing.join(' ')}` : 'found');
  },

  /** No pattern appears in any reply. */
  neverSays: (ev, patterns) => {
    const text = allText(ev);
    const found = patterns.find((p) => p.test(text));
    return result(!found, found ? `said ${found}` : 'clean');
  },

  /** No invented prices: every amount next to EGP / جنيه is a real catalog or knowledge-base price. */
  realPrices: (ev) => {
    const text = allText(ev).replace(/(\d),(\d{3})/g, '$1$2');
    const amounts = [...text.matchAll(/(\d{2,6})\s*(?:EGP|E\.?G\.?P|LE|L\.E|جنيه|ج\.?م)|(?:EGP|جنيه)\s*(\d{2,6})/gi)].map((m) => Number(m[1] ?? m[2]));
    const invented = amounts.filter((a) => !ev.allowedPrices.has(a));
    return result(!invented.length, invented.length ? `unknown price(s): ${invented.join(', ')}` : `${amounts.length} price(s), all real`);
  },

  /** The case's eval patient has an active booking. */
  booked: (ev) => {
    const active = ev.patient?.appointments.filter((a) => a.status === 'booked') ?? [];
    return result(active.length > 0, `${active.length} active booking(s)`);
  },

  /** The case's eval patient has a cancelled booking. */
  cancelled: (ev) => {
    const done = ev.patient?.appointments.filter((a) => a.status === 'cancelled') ?? [];
    return result(done.length > 0, `${done.length} cancelled`);
  },

  /** A memory note matching the pattern was saved for the patient. */
  remembered: (ev, pattern) => {
    const notes = ev.patient?.memories ?? [];
    return result(notes.some((n) => pattern.test(n.content)), notes.map((n) => n.content).join(' | ') || 'no notes');
  },

  /** The patient is on the waitlist. */
  waitlisted: (ev) => {
    const active = ev.patient?.waitlist.filter((w) => ['waiting', 'notified'].includes(w.status)) ?? [];
    return result(active.length > 0, `${active.length} active wish(es)`);
  },
};

/** Runs a case's `expect` block → [{ name, pass, detail }]. */
export function score(ev, expectations) {
  return Object.entries(expectations).map(([name, arg]) => {
    const check = CHECKS[name];
    if (!check) return { name, pass: false, detail: 'unknown check' };
    try {
      return { name, ...check(ev, arg) };
    } catch (err) {
      return { name, pass: false, detail: `check crashed: ${err.message}` };
    }
  });
}
