import { describe, expect, it } from 'vitest';
import { addDays, dayInZone, isValidDay, weekdayOf } from '../../src/utils/clinicTime.js';
import { generatePersonalCode, hmacPersonalCode, normalizePersonalCode } from '../../src/utils/crypto.js';

describe('clinicTime', () => {
  it('uses the clinic day, not the server (UTC) day', () => {
    // 23:30 UTC on Oct 24 is already Oct 25 in Cairo (UTC+2 or +3).
    expect(dayInZone(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
    expect(dayInZone(new Date('2026-10-24T23:30:00Z'), 'UTC')).toBe('2026-10-24');
  });

  it('accepts only real calendar days', () => {
    expect(isValidDay('2026-10-24')).toBe(true);
    expect(isValidDay('2028-02-29')).toBe(true); // leap year
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('24-10-2026')).toBe(false);
    expect(isValidDay(undefined)).toBe(false);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('numbers weekdays like the working_hours table (0 = Sunday)', () => {
    expect(weekdayOf('2026-10-25')).toBe(0); // Sunday
    expect(weekdayOf('2026-10-30')).toBe(5); // Friday, clinic closed
    expect(weekdayOf('2026-10-31')).toBe(6); // Saturday
  });
});

describe('personal codes', () => {
  it('generates readable XXXX-XXXX codes without look-alike characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePersonalCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('does not repeat codes', () => {
    const codes = new Set(Array.from({ length: 1000 }, generatePersonalCode));
    expect(codes.size).toBe(1000);
  });

  it('forgives lowercase, spaces and dashes', () => {
    expect(normalizePersonalCode(' k7q4 - 9m2x ')).toBe('K7Q49M2X');
  });

  it('fingerprints the same code the same way however it is typed', () => {
    const stored = hmacPersonalCode('secret', 'K7Q4-9M2X');

    expect(hmacPersonalCode('secret', 'k7q49m2x')).toBe(stored);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain('K7Q4');
  });

  it('gives a different fingerprint with a different secret', () => {
    expect(hmacPersonalCode('secret-a', 'K7Q4-9M2X')).not.toBe(hmacPersonalCode('secret-b', 'K7Q4-9M2X'));
  });

  it('refuses to fingerprint without a secret', () => {
    expect(() => hmacPersonalCode('', 'K7Q4-9M2X')).toThrow(/secret/);
  });
});
