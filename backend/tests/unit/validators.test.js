import { describe, expect, it } from 'vitest';
import { Phone, Email } from '../../src/validators/common.js';
import { StaffAppointmentsQuery, TimeOffQuery } from '../../src/validators/staff.js';
import { StaffBookBody } from '../../src/validators/appointments.js';
import { WorkingHoursBody, ServiceBody } from '../../src/validators/admin.js';
import { startOfDayInZone } from '../../src/utils/clinicTime.js';

describe('common rules', () => {
  it('normalises phone numbers to the stored international format', () => {
    expect(Phone.parse(' +20 (100) 123-4567 ')).toBe('+201001234567');
    expect(Phone.safeParse('01001234567').success).toBe(false); // no country code
  });

  it('lower-cases and trims emails', () => {
    expect(Email.parse('  Mona@Example.COM ')).toBe('mona@example.com');
    expect(Email.safeParse('not-an-email').success).toBe(false);
  });
});

describe('clinic days', () => {
  it('starts a Cairo day at the right UTC moment in winter (UTC+2) and summer (UTC+3)', () => {
    expect(startOfDayInZone('2026-12-01').toISOString()).toBe('2026-11-30T22:00:00.000Z');
    expect(startOfDayInZone('2026-07-01').toISOString()).toBe('2026-06-30T21:00:00.000Z');
  });

  it('turns ?date= into a midnight-to-midnight Cairo range for the staff calendar', () => {
    const query = StaffAppointmentsQuery.parse({ date: '2026-12-01', staff_id: '00000000-0000-4000-a000-000000000101' });

    expect(query).toMatchObject({
      from: '2026-11-30T22:00:00.000Z',
      to: '2026-12-01T22:00:00.000Z',
      staffId: '00000000-0000-4000-a000-000000000101',
      limit: 50,
      offset: 0,
    });
  });

  it('understands staff_id=clinic as "clinic-wide closures only"', () => {
    expect(TimeOffQuery.parse({ staff_id: 'clinic' }).staffId).toBeNull();
    expect(TimeOffQuery.parse({}).staffId).toBeUndefined();
  });
});

describe('booking input', () => {
  const base = {
    service_id: '00000000-0000-4000-a000-000000000201',
    staff_id: '00000000-0000-4000-a000-000000000101',
    starts_at: '2026-12-01T10:00:00+02:00',
    full_name: 'Walk In',
    date_of_birth: '1990-01-01',
  };

  it('staff bookings need an email or a phone', () => {
    expect(StaffBookBody.safeParse(base).success).toBe(false);
    expect(StaffBookBody.safeParse({ ...base, phone: '+201001234567' }).success).toBe(true);
  });

  it('refuses a start time without a timezone (ambiguous)', () => {
    expect(StaffBookBody.safeParse({ ...base, phone: '+201001234567', starts_at: '2026-12-01T10:00:00' }).success).toBe(false);
  });

  it('refuses a date of birth in the future', () => {
    expect(StaffBookBody.safeParse({ ...base, phone: '+201001234567', date_of_birth: '2999-01-01' }).success).toBe(false);
  });
});

describe('admin input', () => {
  it('refuses a shift that ends before it starts', () => {
    expect(WorkingHoursBody.safeParse({ hours: [{ weekday: 1, start_time: '18:00', end_time: '10:00' }] }).success).toBe(false);
    expect(WorkingHoursBody.safeParse({ hours: [{ weekday: 7, start_time: '10:00', end_time: '18:00' }] }).success).toBe(false);
  });

  it('keeps service durations in 5-minute steps and slugs URL-friendly', () => {
    const service = { slug: 'deep-clean', name_en: 'Deep clean', name_ar: 'تنظيف عميق', duration_minutes: 45, price_egp: 900 };
    expect(ServiceBody.safeParse(service).success).toBe(true);
    expect(ServiceBody.safeParse({ ...service, duration_minutes: 42 }).success).toBe(false);
    expect(ServiceBody.safeParse({ ...service, slug: 'Deep Clean' }).success).toBe(false);
  });
});
