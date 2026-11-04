import { describe, expect, it, vi } from 'vitest';

/**
 * Dashboard backend pieces that have real logic (docs/14_DASHBOARD_PLAN.md):
 *  - G9  the owner's numbers for a period are added up correctly
 *  - G1  a team member's first name, as the patient sees it
 *  - the new request rules (validators)
 */

vi.mock('../../src/db/supabase.js', () => ({ requireAdmin: () => ({}), adminAs: () => ({}), dbFor: () => ({}), publicDb: () => ({}) }));
vi.mock('../../src/models/profileModel.js', () => ({ findIdentity: vi.fn(), namesByIds: vi.fn() }));

const { summarize } = await import('../../src/services/reportService.js');
const { firstName } = await import('../../src/services/chatService.js');
const { ContactStartBody, ContactVerifyBody } = await import('../../src/validators/me.js');
const { RangeStatsQuery, TeamMemberPatch } = await import('../../src/validators/admin.js');
const { PatientCreateBody, ReportBody } = await import('../../src/validators/staff.js');

const visit = (startsAt, status, extra = {}) => ({
  starts_at: startsAt,
  status,
  source: 'dashboard',
  staff_id: 'doc-1',
  service_id: 'svc-1',
  service: { name_en: 'Cleaning', name_ar: 'تنظيف', price_egp: 500 },
  doctor: { full_name_en: 'Dr. Sarah', full_name_ar: 'د. سارة' },
  ...extra,
});

describe('owner numbers for a period (G9)', () => {
  const result = summarize({
    from: '2026-10-01',
    to: '2026-10-03',
    newPatients: 4,
    escalations: 1,
    appointments: [
      visit('2026-10-01T08:00:00Z', 'completed'), // 10:00 in Cairo, a Thursday
      visit('2026-10-01T09:00:00Z', 'no_show'),
      visit('2026-10-02T08:00:00Z', 'booked', { source: 'patient_assistant' }),
      visit('2026-10-03T08:00:00Z', 'cancelled'),
    ],
    runs: [{ outcome: 'answered' }, { outcome: 'booked' }, { outcome: 'escalated' }, { outcome: 'refused' }],
  });

  it('counts visits, money and the no-show rate', () => {
    expect(result.totals).toMatchObject({
      visits: 3, // cancelled ones are not visits
      completed: 1,
      no_show: 1,
      upcoming: 1,
      cancelled: 1,
      revenue_earned: 500,
      revenue_expected: 500,
      no_show_rate: 0.5,
      new_patients: 4,
      escalations: 1,
      ai_turns: 4,
      ai_handled_rate: 0.5, // answered + booked out of 4
      ai_bookings: 1,
    });
  });

  it('fills every day of the period, even empty ones', () => {
    expect(result.by_day.map((d) => [d.day, d.visits])).toEqual([
      ['2026-10-01', 2],
      ['2026-10-02', 1],
      ['2026-10-03', 0],
    ]);
  });

  it('places visits on the heatmap in clinic time', () => {
    expect(result.heatmap).toContainEqual({ weekday: 4, hour: 11, visits: 1 }); // 09:00Z = 11:00 Cairo (summer time ends 30 Oct)
    expect(result.top_services[0]).toMatchObject({ service_id: 'svc-1', visits: 3, revenue: 1000 });
    expect(result.by_doctor[0]).toMatchObject({ visits: 3, completed: 1, no_show: 1 });
  });

  it('leaves rates empty when there is nothing to divide', () => {
    const empty = summarize({ from: '2026-10-01', to: '2026-10-01', newPatients: 0, escalations: 0, appointments: [], runs: [] });
    expect(empty.totals.no_show_rate).toBeNull();
    expect(empty.totals.ai_handled_rate).toBeNull();
  });
});

describe('how a team member is named to the patient (G1)', () => {
  it('uses the first name and skips titles', () => {
    expect(firstName('Dr. Sarah Mansour')).toBe('Sarah');
    expect(firstName('د. سارة منصور')).toBe('سارة');
    expect(firstName(null)).toBeNull();
  });
});

describe('new request rules', () => {
  it('checks the new email or phone by its kind (G10)', () => {
    expect(ContactStartBody.safeParse({ field: 'email', value: 'New@Mail.co' }).data).toEqual({ field: 'email', value: 'new@mail.co' });
    expect(ContactStartBody.safeParse({ field: 'phone', value: '+20 100 123 4567' }).data).toEqual({ field: 'phone', value: '+201001234567' });
    expect(ContactStartBody.safeParse({ field: 'phone', value: 'new@mail.co' }).success).toBe(false);
    expect(ContactVerifyBody.safeParse({ field: 'email', code: '12345' }).success).toBe(false);
  });

  it('needs an email or a phone for a new patient (G5)', () => {
    expect(PatientCreateBody.safeParse({ full_name: 'Omar Said', date_of_birth: '1990-01-01' }).success).toBe(false);
    expect(PatientCreateBody.safeParse({ full_name: 'Omar Said', date_of_birth: '1990-01-01', phone: '+201001234567' }).success).toBe(true);
  });

  it('keeps periods sensible (G9) and edits non-empty (G7)', () => {
    expect(RangeStatsQuery.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success).toBe(false);
    expect(RangeStatsQuery.safeParse({ from: '2025-01-01', to: '2026-10-01' }).success).toBe(false);
    expect(RangeStatsQuery.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(TeamMemberPatch.safeParse({}).success).toBe(false);
    expect(TeamMemberPatch.safeParse({ staff_id: null }).success).toBe(true);
  });

  it('asks what went wrong when reporting the assistant (G4)', () => {
    expect(ReportBody.safeParse({ kind: 'wrong_answer', note: '' }).success).toBe(false);
    expect(ReportBody.safeParse({ kind: 'nonsense', note: 'Wrong price' }).success).toBe(false);
  });
});
