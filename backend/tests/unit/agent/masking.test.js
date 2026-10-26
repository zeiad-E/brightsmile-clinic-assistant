import { describe, expect, it } from 'vitest';
import { maskDeep, maskText, restoreForPatient, unmaskValue, withoutCodes } from '../../../src/agent/masking.js';

const NOW = new Date('2026-10-26T10:00:00Z');

describe('privacy masking', () => {
  it('hides emails and phone numbers behind placeholders', () => {
    const map = {};
    const masked = maskText('Email mona@example.com or call +20 100 123 4567 / 01001234567', map, { now: NOW });

    expect(masked).toBe('Email [EMAIL_1] or call [PHONE_1] / [PHONE_2]');
    expect(map).toEqual({ '[EMAIL_1]': 'mona@example.com', '[PHONE_1]': '+201001234567', '[PHONE_2]': '01001234567' });
  });

  it('hides birth dates but keeps booking dates visible', () => {
    const map = {};
    const masked = maskText('Born 1992-04-15, also 15/04/1992 and 15 April 1992. Book me on 2026-11-03 please', map, { now: NOW });

    expect(masked).toBe('Born [DOB_1], also [DOB_2] and [DOB_3]. Book me on 2026-11-03 please');
  });

  it('hides personal codes and email codes', () => {
    const map = {};
    const masked = maskText('My code is K7Q4-9M2X, or k7q49m2x, and the email code 01378216', map, { now: NOW });

    expect(masked).toBe('My code is [CODE_1], or [CODE_2], and the email code [CODE_3]');
  });

  it('leaves normal clinic talk alone', () => {
    const text = 'Can I book a cleaning on Sunday at 10:30? It costs 800 EGP, right? WHATEVER works';
    expect(maskText(text, {}, { now: NOW })).toBe(text);
  });

  it.each(['Read this back and ask the patient', 'Please make sure the time is good', 'best time next week', 'This will work fine', 'Room 2B is near'])(
    'never mistakes word pairs for a code: %s',
    (text) => {
      expect(maskText(text, {}, { now: NOW })).toBe(text);
    },
  );

  it('still catches a code typed exactly as emailed, even without digits', () => {
    expect(maskText('code ABCD-EFGH', {}, { now: NOW })).toBe('code [CODE_1]');
  });

  it('reads Arabic-Indic digits too', () => {
    expect(maskText('رقمي ٠١٠٠١٢٣٤٥٦٧', {}, { now: NOW })).toBe('رقمي [PHONE_1]');
  });

  it('reuses the same placeholder for the same value across turns', () => {
    const map = {};
    maskText('mona@example.com', map, { now: NOW });
    expect(maskText('again: mona@example.com and new@example.com', map, { now: NOW })).toBe('again: [EMAIL_1] and [EMAIL_2]');
  });

  it('swaps placeholders back to real values inside tool arguments', () => {
    const map = { '[PHONE_1]': '+201001234567', '[DOB_1]': '1992-04-15' };
    expect(unmaskValue({ phone: '[PHONE_1]', nested: ['[DOB_1]', 'x'], n: 3 }, map)).toEqual({
      phone: '+201001234567',
      nested: ['1992-04-15', 'x'],
      n: 3,
    });
  });

  it('shows the patient real values back, but never codes', () => {
    const map = { '[EMAIL_1]': 'mona@example.com', '[CODE_1]': 'K7Q4-9M2X' };
    expect(restoreForPatient('Sent to [EMAIL_1]. Code [CODE_1] accepted.', map)).toBe('Sent to mona@example.com. Code •••• accepted.');
  });

  it('forgets one-time codes after the turn', () => {
    expect(withoutCodes({ '[EMAIL_1]': 'a@b.co', '[CODE_1]': '123456' })).toEqual({ '[EMAIL_1]': 'a@b.co' });
  });

  it('masks values inside tool results before the AI reads them', () => {
    const map = {};
    expect(maskDeep({ patient: { email: 'mona@example.com' }, list: ['+201001234567'] }, map, { now: NOW })).toEqual({
      patient: { email: '[EMAIL_1]' },
      list: ['[PHONE_1]'],
    });
  });
});
