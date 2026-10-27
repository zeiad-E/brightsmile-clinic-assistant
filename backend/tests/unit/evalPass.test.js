import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config/index.js';
import { evalPass } from '../../src/middlewares/evalPass.js';
import { personKeys } from '../../src/services/capacity/index.js';
import { sendEmail, setEmailAdapter } from '../../src/services/email/emailService.js';

/** The eval pass only exists with a configured key, and only the exact key opens it. */
const KEY = 'k'.repeat(40);
const run = (headers) => {
  const req = { get: (name) => headers[name.toLowerCase()] };
  evalPass()(req, {}, () => {});
  return req.evalCase;
};

afterEach(() => {
  config.evalKey = '';
});

describe('eval pass', () => {
  it('is off when no EVAL_KEY is configured, whatever the request sends', () => {
    config.evalKey = '';
    expect(run({ 'x-eval-key': '', 'x-eval-case': 'a' })).toBeNull();
    expect(run({ 'x-eval-key': 'anything', 'x-eval-case': 'a' })).toBeNull();
  });

  it('marks a request with the right key as that eval case', () => {
    config.evalKey = KEY;
    expect(run({ 'x-eval-key': KEY, 'x-eval-case': 'book-en-1' })).toBe('book-en-1');
    expect(run({ 'x-eval-key': KEY, 'x-eval-case': 'bad case id!' })).toBe('default');
  });

  it('ignores a wrong key', () => {
    config.evalKey = KEY;
    expect(run({ 'x-eval-key': `${KEY}x`, 'x-eval-case': 'a' })).toBeNull();
    expect(run({ 'x-eval-case': 'a' })).toBeNull();
  });

  it('makes each eval conversation its own person for budgets and cooldowns', () => {
    expect(personKeys({ userId: 'u1', ip: '1.2.3.4', evalCase: 'off-topic-1' })).toEqual(['eval:off-topic-1']);
    expect(personKeys({ userId: 'u1', ip: '1.2.3.4' })).toEqual(['user:u1', 'ip:1.2.3.4']);
  });

  it('refuses a key shorter than 32 characters at boot', async () => {
    const { loadConfig } = await import('../../src/config/index.js');
    expect(() => loadConfig({ EVAL_KEY: 'short' })).toThrow(/EVAL_KEY/);
  });
});

describe('reserved test addresses', () => {
  it('never emails a .invalid address (used by the eval patients)', async () => {
    const sent = [];
    setEmailAdapter({ name: 'capture', send: async (m) => sent.push(m) });

    const result = await sendEmail({ template: 'login_code', to: 'eval-x@eval.invalid', data: { clinicName: 'B', personalCode: 'K7Q4-9M2X' } });

    expect(result).toEqual({ sent: false, skipped: true });
    expect(sent).toEqual([]);
  });
});
