import { describe, expect, it } from 'vitest';
import { describeSlots } from '../../../src/agent/tools/bookingTools.js';

describe('free times shown to the assistant', () => {
  it('are spread across the whole day, not just the first ones', () => {
    const slots = Array.from({ length: 31 }, (_, i) => ({ starts_at: new Date(Date.UTC(2026, 11, 1, 8, 0) + i * 15 * 60_000).toISOString() }));
    const times = describeSlots(slots, 10);

    expect(times).toHaveLength(10);
    expect(times[0]).toBe('10:00');
    expect(times.at(-1)).toBe('17:30');
    expect(times.some((t) => t >= '14:00')).toBe(true);
  });

  it('shows every time when there are only a few', () => {
    const slots = [{ starts_at: '2026-12-01T08:00:00Z' }, { starts_at: '2026-12-01T12:00:00Z' }];
    expect(describeSlots(slots, 10)).toEqual(['10:00', '14:00']);
  });
});
