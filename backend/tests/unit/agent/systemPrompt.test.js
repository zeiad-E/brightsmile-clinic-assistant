import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../../src/agent/systemPrompt.js';

const base = {
  clinicName: 'BrightSmile',
  clinicPhone: '+20 100 555 0123',
  replyLanguage: 'en',
  today: { weekday: 'Monday', date: '2026-11-09', time: '10:00' },
  openingHours: 'Sun 09:00–17:00, Fri closed',
};
const guest = buildSystemPrompt({ ...base, patient: null });
const patient = buildSystemPrompt({ ...base, patient: { fullName: 'Ali Hassan', preferredLanguage: 'ar' } });

describe('buildSystemPrompt', () => {
  it('gives a guest the sign-in and sign-up steps, not memory or intake', () => {
    expect(guest).toContain('YOU ARE TALKING TO A GUEST');
    expect(guest).toContain('show_details_form');
    expect(guest).toContain('sign_in_with_code');
    expect(guest).toContain('start_sign_up');
    expect(guest).not.toContain('MEMORY');
    expect(guest).not.toContain('update_intake');
  });

  it('gives a signed-in patient memory and intake, not the sign-in steps', () => {
    expect(patient).toContain('YOU ARE TALKING TO A SIGNED-IN PATIENT');
    expect(patient).toContain('remember');
    expect(patient).toContain('update_intake');
    expect(patient).not.toContain('sign_in_with_code');
    expect(patient).not.toContain('show_details_form');
    expect(patient).not.toContain('start_sign_up');
  });

  it('keeps the shared rules and ends with the reply language', () => {
    for (const prompt of [guest, patient]) {
      expect(prompt).toContain('CLINIC ASSISTANT RULES');
      expect(prompt).toContain('BOOKING AND CHANGES');
      expect(prompt).toContain('BEGIN CONTEXT');
      expect(prompt.trim().split('\n').at(-1)).toBe('Write your whole reply in English.');
    }
    expect(buildSystemPrompt({ ...base, patient: null, replyLanguage: 'ar' }).trim().split('\n').at(-1)).toBe('Write your whole reply in Arabic.');
  });
});
