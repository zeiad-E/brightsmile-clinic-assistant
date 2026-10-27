import crypto from 'node:crypto';
import { config } from '../config/index.js';

/**
 * The eval pass: lets the agent evals (`npm run eval:agent`) run many scripted conversations
 * against the live API from one computer.
 *
 * A request carrying `x-eval-key` equal to EVAL_KEY is marked as an eval: each scripted
 * conversation (`x-eval-case`) then counts as its own "person" for daily budgets and abuse
 * cooldowns, and the per-IP rate limits skip it. Without this, the off-topic and injection
 * tests would put the tester's IP on a cooldown, and the per-person token budget would stop the
 * run halfway. The clinic-wide budget still counts every eval turn.
 *
 * No EVAL_KEY configured → the pass does not exist. A wrong key is simply ignored.
 */
const CASE_ID = /^[\w-]{1,64}$/;

function matches(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function evalPass() {
  return (req, _res, next) => {
    req.evalCase = null;
    const key = req.get('x-eval-key');
    if (config.evalKey && key && matches(key, config.evalKey)) {
      const caseId = req.get('x-eval-case');
      req.evalCase = caseId && CASE_ID.test(caseId) ? caseId : 'default';
    }
    next();
  };
}
