import { describe, expect, it } from 'vitest';
import { checkReply, detectLanguage, fixedReply, isEmergency, LIMITS } from '../../../src/agent/guardrails.js';
import { createKeyedLock } from '../../../src/utils/keyedLock.js';

describe('emergency detector', () => {
  it.each([
    'I can’t breathe and my face is swelling',
    "My gum has heavy bleeding that won't stop",
    'my face is swelling after the extraction',
    'my tooth got knocked out in a car accident',
    'مش قادر اتنفس',
    'عندي نزيف شديد من بعد الخلع',
    'وشي وارم جدا',
  ])('catches: %s', (text) => {
    expect(isEmergency(text)).toBe(true);
  });

  it.each(['My tooth hurts a bit when I drink cold water', 'How much is whitening?', 'سناني بتوجعني شوية', 'I want to book a cleaning'])(
    'leaves ordinary questions to the assistant: %s',
    (text) => {
      expect(isEmergency(text)).toBe(false);
    },
  );
});

describe('language and fixed replies', () => {
  it('detects Arabic vs English', () => {
    expect(detectLanguage('عايز احجز')).toBe('ar');
    expect(detectLanguage('I want to book')).toBe('en');
  });

  it('has every fixed reply in both languages', () => {
    for (const kind of ['emergency', 'off_topic', 'off_topic_reminder', 'injection', 'cooldown', 'turn_limit', 'paused', 'failure']) {
      expect(fixedReply(kind, 'en')).toMatch(/[a-z]/);
      expect(fixedReply(kind, 'ar')).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('reply check', () => {
  it('blocks a reply that leaks the instructions', () => {
    expect(checkReply('Sure! CLINIC ASSISTANT RULES: You are…', 'en')).toBe(fixedReply('injection', 'en'));
  });

  it('cuts very long replies', () => {
    expect(checkReply('a'.repeat(5000), 'en')).toHaveLength(LIMITS.maxReplyChars);
  });

  it('replaces an empty reply with the failure message', () => {
    expect(checkReply('   ', 'ar')).toBe(fixedReply('failure', 'ar'));
  });
});

describe('per-conversation lock', () => {
  it('runs turns of the same conversation one after another, others in parallel', async () => {
    const withLock = createKeyedLock();
    const order = [];
    const task = (name, ms) => () =>
      new Promise((resolve) => {
        order.push(`${name}:start`);
        setTimeout(() => {
          order.push(`${name}:end`);
          resolve(name);
        }, ms);
      });

    await Promise.all([withLock('c1', task('a', 30)), withLock('c1', task('b', 5)), withLock('c2', task('x', 5))]);

    expect(order.indexOf('b:start')).toBeGreaterThan(order.indexOf('a:end'));
    expect(order.indexOf('x:start')).toBeLessThan(order.indexOf('a:end'));
  });
});
