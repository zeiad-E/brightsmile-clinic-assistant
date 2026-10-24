import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Booking rules, with the database replaced by fakes:
 * race re-offer, replays, auto sign-in only for new guests, identity from the login.
 */
vi.mock('../../src/db/supabase.js', () => ({
  requireAdmin: () => ({ admin: true }),
  adminAs: (actorId, via) => ({ actorId, via }),
}));
vi.mock('../../src/models/appointmentModel.js', () => ({ book: vi.fn(), findById: vi.fn() }));
vi.mock('../../src/models/patientModel.js', () => ({ findById: vi.fn() }));
vi.mock('../../src/services/accountService.js', () => ({ ensurePatientLogin: vi.fn() }));
vi.mock('../../src/services/personalCodeService.js', () => ({ issueCode: vi.fn(async () => 'K7Q4-9M2X') }));
vi.mock('../../src/services/sessionService.js', () => ({
  mintSession: vi.fn(async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600, expires_at: 1 })),
}));
vi.mock('../../src/services/availabilityService.js', () => ({
  nextFreeSlots: vi.fn(async () => [{ starts_at: '2026-12-01T08:15:00Z', ends_at: '2026-12-01T08:45:00Z' }]),
}));
vi.mock('../../src/services/catalogService.js', () => ({
  clinicBranding: vi.fn(async () => ({ nameEn: 'BrightSmile', nameAr: 'برايت سمايل', timeZone: 'Africa/Cairo' })),
  clinicNameIn: (brand, lang) => (lang === 'ar' ? brand.nameAr : brand.nameEn),
}));
vi.mock('../../src/services/email/emailService.js', () => ({ sendEmailInBackground: vi.fn() }));

const appointmentModel = await import('../../src/models/appointmentModel.js');
const patientModel = await import('../../src/models/patientModel.js');
const accountService = await import('../../src/services/accountService.js');
const personalCodeService = await import('../../src/services/personalCodeService.js');
const sessionService = await import('../../src/services/sessionService.js');
const emailService = await import('../../src/services/email/emailService.js');
const { bookAsVisitor, bookAsStaff } = await import('../../src/services/bookingService.js');

const KEY = '11111111-2222-4333-8444-555555555555';
const guestInput = {
  service_id: 'svc',
  staff_id: 'doc',
  starts_at: '2026-12-01T10:00:00+02:00',
  full_name: 'Mona Ali',
  date_of_birth: '1990-01-01',
  email: 'mona@example.com',
  preferred_language: 'en',
};
const patientRow = {
  id: 'pat-1',
  profile_id: null,
  full_name: 'Mona Ali',
  date_of_birth: '1990-01-01',
  email: 'mona@example.com',
  phone: null,
  preferred_language: 'en',
};
const appointmentRow = {
  id: 'appt-1',
  starts_at: '2026-12-01T08:00:00Z',
  ends_at: '2026-12-01T08:30:00Z',
  status: 'booked',
  source: 'website',
  doctor: { id: 'doc', full_name_en: 'Dr. Sarah', full_name_ar: 'د. سارة', title: 'dentist' },
  service: { id: 'svc', slug: 'cleaning', name_en: 'Cleaning', name_ar: 'تنظيف', duration_minutes: 30, price_egp: '800.00' },
};

beforeEach(() => {
  vi.clearAllMocks();
  appointmentModel.findById.mockResolvedValue(appointmentRow);
  patientModel.findById.mockResolvedValue(patientRow);
  accountService.ensurePatientLogin.mockResolvedValue({ profileId: 'user-1', email: 'mona@example.com' });
});

const ok = (extra = {}) => ({ ok: true, replayed: false, appointment_id: 'appt-1', patient_id: 'pat-1', is_new_patient: true, ...extra });

describe('bookAsVisitor', () => {
  it('books a new guest, emails a personal code, and signs them in', async () => {
    appointmentModel.book.mockResolvedValue(ok());

    const { status, body } = await bookAsVisitor({ user: null }, guestInput, KEY);

    expect(status).toBe(201);
    expect(body.is_new_patient).toBe(true);
    expect(body.session.access_token).toBe('a');
    expect(body.appointment.service.price_egp).toBe(800);
    expect(appointmentModel.book).toHaveBeenCalledWith(
      { actorId: null, via: 'dashboard' },
      expect.objectContaining({ source: 'website', idempotencyKey: KEY, fullName: 'Mona Ali' }),
    );
    expect(personalCodeService.issueCode).toHaveBeenCalledWith('pat-1');
    expect(emailService.sendEmailInBackground).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'booking_confirmed', to: 'mona@example.com', data: expect.objectContaining({ personalCode: 'K7Q4-9M2X' }) }),
    );
  });

  it('does NOT sign in a guest who matched an existing patient', async () => {
    appointmentModel.book.mockResolvedValue(ok({ is_new_patient: false }));

    const { status, body } = await bookAsVisitor({ user: null }, guestInput, KEY);

    expect(status).toBe(201);
    expect(body.session).toBeNull();
    expect(sessionService.mintSession).not.toHaveBeenCalled();
    expect(personalCodeService.issueCode).not.toHaveBeenCalled();
  });

  it('answers a replayed request with the first booking and does nothing else', async () => {
    appointmentModel.book.mockResolvedValue(ok({ replayed: true, is_new_patient: false }));

    const { status, body } = await bookAsVisitor({ user: null }, guestInput, KEY);

    expect(status).toBe(200);
    expect(body.replayed).toBe(true);
    expect(accountService.ensurePatientLogin).not.toHaveBeenCalled();
    expect(emailService.sendEmailInBackground).not.toHaveBeenCalled();
  });

  it('offers the next free times when the slot was just taken (race re-offer)', async () => {
    appointmentModel.book.mockResolvedValue({ ok: false, error: 'slot_taken' });

    await expect(bookAsVisitor({ user: null }, guestInput, KEY)).rejects.toMatchObject({
      status: 409,
      code: 'slot_taken',
      details: { alternatives: [{ starts_at: '2026-12-01T08:15:00Z', ends_at: '2026-12-01T08:45:00Z' }] },
    });
  });

  it.each([
    ['slot_unavailable', 422],
    ['identity_mismatch', 409],
    ['contact_conflict', 409],
    ['patient_has_overlap', 409],
    ['invalid_phone', 400],
  ])('turns %s into HTTP %i', async (error, status) => {
    appointmentModel.book.mockResolvedValue({ ok: false, error });

    await expect(bookAsVisitor({ user: null }, guestInput, KEY)).rejects.toMatchObject({ status, code: error });
  });

  it('asks a guest for their details', async () => {
    await expect(bookAsVisitor({ user: null }, { ...guestInput, email: undefined }, KEY)).rejects.toMatchObject({
      status: 400,
      code: 'details_required',
    });
    expect(appointmentModel.book).not.toHaveBeenCalled();
  });

  it("uses a signed-in patient's own record and ignores typed details", async () => {
    appointmentModel.book.mockResolvedValue(ok({ is_new_patient: false }));
    const user = { id: 'user-1', role: 'patient', patientId: 'pat-1' };

    const { body } = await bookAsVisitor({ user }, { ...guestInput, full_name: 'Someone Else', email: 'other@x.com' }, KEY);

    expect(appointmentModel.book).toHaveBeenCalledWith(
      { actorId: 'user-1', via: 'dashboard' },
      expect.objectContaining({ fullName: 'Mona Ali', email: 'mona@example.com', createdBy: 'user-1' }),
    );
    expect(body.session).toBeNull();
  });

  it('sends team members to the staff booking screen', async () => {
    await expect(bookAsVisitor({ user: { id: 'u', role: 'staff' } }, guestInput, KEY)).rejects.toMatchObject({
      status: 403,
      code: 'use_staff_booking',
    });
  });

  it('keeps the booking even if the login setup fails afterwards', async () => {
    appointmentModel.book.mockResolvedValue(ok());
    accountService.ensurePatientLogin.mockRejectedValue(new Error('auth down'));

    const { status, body } = await bookAsVisitor({ user: null }, guestInput, KEY);

    expect(status).toBe(201);
    expect(body.appointment.id).toBe('appt-1');
    expect(body.session).toBeNull();
  });
});

describe('bookAsStaff', () => {
  it('records the booking as made in the dashboard by that staff member, without a session', async () => {
    appointmentModel.book.mockResolvedValue(ok());

    const { status, body } = await bookAsStaff({ user: { id: 'staff-1', role: 'staff' } }, guestInput, KEY);

    expect(status).toBe(201);
    expect(body.session).toBeUndefined();
    expect(appointmentModel.book).toHaveBeenCalledWith(
      { actorId: 'staff-1', via: 'dashboard' },
      expect.objectContaining({ source: 'dashboard', createdBy: 'staff-1' }),
    );
  });
});
