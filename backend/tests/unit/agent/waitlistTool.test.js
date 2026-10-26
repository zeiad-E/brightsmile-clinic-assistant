import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, dayInZone } from '../../../src/utils/clinicTime.js';

/** join_waitlist: checks dates and names before anything is saved. */
vi.mock('../../../src/db/supabase.js', () => ({ requireAdmin: () => ({}), adminAs: () => ({}) }));
vi.mock('../../../src/services/catalogService.js', () => ({
  listServices: vi.fn(async () => [{ id: 'clean', slug: 'teeth-cleaning', name_en: 'Teeth cleaning', name_ar: 'تنظيف الأسنان' }]),
  listDoctors: vi.fn(async () => [{ id: 'doc', full_name_en: 'Dr. Sarah', full_name_ar: 'د. سارة', service_ids: ['clean'] }]),
}));
vi.mock('../../../src/models/patientModel.js', () => ({ findById: vi.fn(async () => ({ id: 'p1', email: 'p1@example.com' })) }));
vi.mock('../../../src/services/waitlistService.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    WAITLIST_LIMITS: real.WAITLIST_LIMITS,
    describeWish: real.describeWish,
    join: vi.fn(async ({ dateFrom, dateTo }) => ({ added: true, entry: { service: { name_en: 'Teeth cleaning' }, date_from: dateFrom, date_to: dateTo } })),
  };
});

const waitlistService = await import('../../../src/services/waitlistService.js');
const { joinWaitlist } = await import('../../../src/agent/tools/bookingTools.js');

const today = dayInZone(new Date(), 'Africa/Cairo');
const ctx = () => ({
  conversation: { id: 'conv-1' },
  user: { patientId: 'p1' },
  isPatient: true,
  timeZone: 'Africa/Cairo',
  db: {},
  state: {},
  events: {},
  emit: vi.fn(),
});

beforeEach(() => vi.clearAllMocks());

describe('join_waitlist', () => {
  it('adds the wish for any doctor and counts it as a data change', async () => {
    const c = ctx();
    const result = await joinWaitlist.run({ service: 'cleaning', from: addDays(today, 1), to: addDays(today, 7) }, c);

    expect(result).toMatchObject({ added: true, waiting: `Teeth cleaning with any doctor, ${addDays(today, 1)} to ${addDays(today, 7)}` });
    expect(waitlistService.join).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'clean', staffId: null, conversationId: 'conv-1' }));
    expect(c.events.changed).toBe(true);
  });

  it('keeps a named doctor, and starts a range in the past from today', async () => {
    await joinWaitlist.run({ service: 'cleaning', doctor: 'Sarah', from: addDays(today, -3), to: addDays(today, 5) }, ctx());

    expect(waitlistService.join).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'doc', dateFrom: today }));
  });

  it.each([
    ['a malformed date', { from: 'next week', to: addDays(today, 3) }, 'invalid_dates'],
    ['an end before the start', { from: addDays(today, 5), to: addDays(today, 2) }, 'invalid_dates'],
    ['a range in the past', { from: addDays(today, -9), to: addDays(today, -2) }, 'invalid_dates'],
    ['more than 30 days', { from: today, to: addDays(today, 45) }, 'range_too_long'],
  ])('refuses %s', async (_name, dates, error) => {
    expect((await joinWaitlist.run({ service: 'cleaning', ...dates }, ctx())).error).toBe(error);
    expect(waitlistService.join).not.toHaveBeenCalled();
  });

  it('passes on the service’s answer (e.g. no email) with advice for the assistant', async () => {
    waitlistService.join.mockResolvedValueOnce({ error: 'no_email', message: 'No email.' });

    const result = await joinWaitlist.run({ service: 'cleaning', from: today, to: addDays(today, 3) }, ctx());

    expect(result).toMatchObject({ error: 'no_email' });
    expect(result.next).toMatch(/by email/);
  });

  it('is only for signed-in patients', () => {
    expect(joinWaitlist.signedIn).toBe(true);
  });
});
