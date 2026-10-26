import { describe, expect, it } from 'vitest';
import { BusyError, createLimiter } from '../../src/services/capacity/limiter.js';
import { createAbuseTracker } from '../../src/services/capacity/abuseTracker.js';
import { createBudget } from '../../src/services/capacity/budget.js';
import { createCircuitBreaker } from '../../src/services/capacity/circuitBreaker.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('concurrency limiter', () => {
  it('runs at most `max` turns at once; the rest wait their turn in order', async () => {
    const limiter = createLimiter({ max: 2, queueMax: 10, maxWaitMs: 5000 });
    const gates = [deferred(), deferred(), deferred()];
    const order = [];
    const runs = gates.map((gate, i) =>
      limiter.run(async () => {
        order.push(`start ${i}`);
        await gate.promise;
        order.push(`end ${i}`);
      }),
    );

    await Promise.resolve();
    expect(limiter.stats()).toMatchObject({ active: 2, waiting: 1 });
    expect(order).toEqual(['start 0', 'start 1']);

    gates[0].resolve();
    await runs[0];
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toContain('start 2');

    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(runs);
    expect(limiter.stats()).toMatchObject({ active: 0, waiting: 0 });
  });

  it('says "busy" instead of crashing when the waiting line is full', async () => {
    const limiter = createLimiter({ max: 1, queueMax: 1, maxWaitMs: 5000 });
    const gate = deferred();
    const first = limiter.run(() => gate.promise);
    const second = limiter.run(async () => 'second');

    await expect(limiter.run(async () => 'third')).rejects.toMatchObject({ name: 'BusyError', reason: 'queue_full' });
    gate.resolve();
    await first;
    expect(await second).toBe('second');
  });

  it('gives up on someone who waited too long', async () => {
    const limiter = createLimiter({ max: 1, queueMax: 5, maxWaitMs: 20 });
    const gate = deferred();
    const first = limiter.run(() => gate.promise);

    await expect(limiter.run(async () => 'late')).rejects.toBeInstanceOf(BusyError);
    expect(limiter.stats().waiting).toBe(0);
    gate.resolve();
    await first;
  });

  it('frees the slot even when a turn throws', async () => {
    const limiter = createLimiter({ max: 1, queueMax: 1, maxWaitMs: 1000 });
    await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await limiter.run(async () => 'next')).toBe('next');
  });
});

describe('abuse tracker', () => {
  it('blocks a person for 10 minutes after 5 off-topic messages in an hour', () => {
    let t = 0;
    const tracker = createAbuseTracker({ now: () => t });
    for (let i = 0; i < 4; i += 1) expect(tracker.record(['ip:1'], 'off_topic')).toBeNull();
    const until = tracker.record(['ip:1'], 'off_topic');

    expect(until.getTime()).toBe(10 * 60 * 1000);
    expect(tracker.blockedUntil(['ip:1'])).not.toBeNull();
    t = 10 * 60 * 1000 + 1;
    expect(tracker.blockedUntil(['ip:1'])).toBeNull();
  });

  it('blocks for an hour after 2 manipulation attempts', () => {
    const tracker = createAbuseTracker({ now: () => 0 });
    tracker.record(['user:a'], 'injection');
    expect(tracker.record(['user:a'], 'injection').getTime()).toBe(60 * 60 * 1000);
  });

  it('forgets events older than an hour', () => {
    let t = 0;
    const tracker = createAbuseTracker({ now: () => t });
    for (let i = 0; i < 4; i += 1) tracker.record(['ip:1'], 'off_topic');
    t = 61 * 60 * 1000;
    expect(tracker.record(['ip:1'], 'off_topic')).toBeNull();
  });

  it('keeps people apart', () => {
    const tracker = createAbuseTracker({ now: () => 0 });
    tracker.record(['ip:1'], 'injection');
    tracker.record(['ip:1'], 'injection');
    expect(tracker.blockedUntil(['ip:2'])).toBeNull();
  });
});

describe('daily budget', () => {
  const make = (extra = {}) =>
    createBudget({ perPersonMessages: 3, perPersonTokens: 1000, clinicTokens: 10_000, now: () => new Date('2026-10-26T10:00:00Z'), ...extra });

  it('stops one person after their daily message limit', async () => {
    const budget = make();
    for (let i = 0; i < 3; i += 1) await budget.recordMessage(['ip:1']);

    expect(await budget.check(['ip:1'])).toEqual({ allowed: false, reason: 'person_messages' });
    expect((await budget.check(['ip:2'])).allowed).toBe(true);
  });

  it('stops one person after their daily token limit', async () => {
    const budget = make();
    await budget.recordTokens(['user:a'], 1200);
    expect((await budget.check(['user:a'])).reason).toBe('person_tokens');
  });

  it('switches the whole clinic to safe mode at 90% and off at 100%', async () => {
    const budget = make();
    await budget.recordTokens([], 8999);
    expect((await budget.check([])).mode).toBe('normal');
    await budget.recordTokens([], 1);
    expect((await budget.check([])).mode).toBe('safe');
    await budget.recordTokens([], 1000);
    expect((await budget.check([])).mode).toBe('off');
  });

  it('remembers today’s usage after a restart (reads it back from the database)', async () => {
    const budget = make({ loadClinicUsage: async () => 9500 });
    expect((await budget.check([])).mode).toBe('safe');
  });

  it('starts fresh on a new clinic day', async () => {
    let now = new Date('2026-10-26T10:00:00Z');
    const budget = make({ now: () => now });
    for (let i = 0; i < 3; i += 1) await budget.recordMessage(['ip:1']);
    now = new Date('2026-10-27T10:00:00Z');
    expect((await budget.check(['ip:1'])).allowed).toBe(true);
  });
});

describe('circuit breaker', () => {
  it('trips after repeated failures, then lets one test turn through after the cool-down', () => {
    let t = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 3, windowMs: 60_000, openMs: 1000, now: () => t });
    breaker.failure();
    breaker.failure();
    expect(breaker.allows()).toBe(true);
    breaker.failure();
    expect(breaker.allows()).toBe(false);

    t = 1001;
    expect(breaker.stats().state).toBe('half_open');
    expect(breaker.allows()).toBe(true);
    breaker.success();
    expect(breaker.stats().state).toBe('closed');
  });

  it('opens again if the test turn fails', () => {
    let t = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 1, openMs: 1000, now: () => t });
    breaker.failure();
    t = 1001;
    breaker.failure();
    expect(breaker.allows()).toBe(false);
  });
});
