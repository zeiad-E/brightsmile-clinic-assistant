import { describe, expect, it } from 'vitest';
import { arabicShare, score, westernDigits } from '../../evals/checks.js';

/** The eval scorecard must be right before its numbers mean anything. */
const ev = (extra = {}) => ({
  replies: [],
  results: [],
  tools: [],
  runs: [],
  conversations: [],
  escalations: 0,
  patient: null,
  allowedPrices: new Set([400, 800, 4500]),
  ...extra,
});
const one = (e, expectations) => score(e, expectations)[0];

describe('eval checks', () => {
  it('reads Arabic-Indic digits as digits', () => {
    expect(westernDigits('٨٠٠ جنيه')).toBe('800 جنيه');
  });

  it('tells English from Arabic replies, and can judge only the last reply', () => {
    expect(arabicShare('مرحباً، كيف أساعدك؟')).toBeGreaterThan(0.9);
    expect(one(ev({ replies: ['Hello!', 'مرحباً بك'] }), { lang: 'en' }).pass).toBe(false);
    expect(one(ev({ replies: ['Hello!', 'مرحباً بك'] }), { lang: { last: 'ar' } }).pass).toBe(true);
    expect(one(ev({ replies: ['Dr. Sarah مع موعدك يوم الأحد الساعة 10'] }), { lang: 'ar' }).pass).toBe(true);
    expect(one(ev({ replies: ["The children's check-up (كشف للأطفال) costs 500 EGP and takes about 30 minutes."] }), { lang: 'en' }).pass).toBe(true);
  });

  it('accepts only real prices, in either language and digit style', () => {
    expect(one(ev({ replies: ['A cleaning is 800 EGP; whitening 4,500 EGP.'] }), { realPrices: true }).pass).toBe(true);
    expect(one(ev({ replies: ['الكشف بـ ٤٠٠ جنيه'] }), { realPrices: true }).pass).toBe(true);
    const invented = one(ev({ replies: ['Laser contouring costs 2500 EGP.'] }), { realPrices: true });
    expect(invented).toMatchObject({ pass: false, detail: 'unknown price(s): 2500' });
  });

  it('checks tools called, and tools that must never succeed', () => {
    const e = ev({ tools: [{ name: 'my_appointments', ok: false }, { name: 'search_knowledge', ok: true }] });
    expect(one(e, { tools: ['search_knowledge'] }).pass).toBe(true);
    expect(one(e, { tools: ['note_knowledge_gap'] }).pass).toBe(false);
    expect(one(e, { noToolSuccess: ['my_appointments'] }).pass).toBe(true); // tried, refused: fine
    expect(one(e, { noTools: ['my_appointments'] }).pass).toBe(false);
    expect(one(e, { anyTool: ['list_services', 'search_knowledge'] }).pass).toBe(true);
  });

  it('checks outcomes, status, escalations and the patient’s records', () => {
    const e = ev({
      runs: [{ outcome: 'refused' }],
      conversations: [{ status: 'handed_off' }],
      escalations: 1,
      patient: { appointments: [{ status: 'cancelled' }], memories: [{ content: 'Prefers afternoon appointments' }], waitlist: [{ status: 'waiting' }] },
    });
    const results = score(e, { outcome: 'refused', status: 'handed_off', escalated: true, cancelled: true, remembered: /afternoon/i, waitlisted: true, booked: true });
    expect(results.map((r) => [r.name, r.pass])).toEqual([
      ['outcome', true],
      ['status', true],
      ['escalated', true],
      ['cancelled', true],
      ['remembered', true],
      ['waitlisted', true],
      ['booked', false],
    ]);
  });

  it('fails an unknown check instead of passing it silently', () => {
    expect(one(ev(), { madeUp: true })).toMatchObject({ pass: false, detail: 'unknown check' });
  });
});
