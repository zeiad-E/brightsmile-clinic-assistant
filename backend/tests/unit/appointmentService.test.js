import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/supabase.js', () => ({ requireAdmin: () => ({ admin: true }) }));
vi.mock('../../src/models/appointmentModel.js', () => ({
  cancel: vi.fn(),
  reschedule: vi.fn(),
  findById: vi.fn(),
  findForNotification: vi.fn(async () => null),
  findForStaff: vi.fn(),
  updateStatus: vi.fn(),
  listForPatient: vi.fn(),
}));
vi.mock('../../src/services/availabilityService.js', () => ({ nextFreeSlots: vi.fn(async () => [{ starts_at: 'x' }]) }));
vi.mock('../../src/services/catalogService.js', () => ({
  clinicBranding: vi.fn(async () => ({ timeZone: 'Africa/Cairo' })),
  clinicNameIn: () => 'BrightSmile',
}));
vi.mock('../../src/services/email/emailService.js', () => ({ sendEmailInBackground: vi.fn() }));

const appointmentModel = await import('../../src/models/appointmentModel.js');
const service = await import('../../src/services/appointmentService.js');

const ctx = { user: { id: 'u', patientId: 'p' }, db: { user: true } };
const row = { id: 'a1', staff_id: 'doc', service_id: 'svc', starts_at: '2026-12-01T08:00:00Z', status: 'booked' };

beforeEach(() => {
  vi.clearAllMocks();
  appointmentModel.findById.mockResolvedValue(row);
});

describe('cancel / reschedule', () => {
  it('cancels with the caller’s own database client (so the database applies the role rules)', async () => {
    appointmentModel.cancel.mockResolvedValue({ ok: true });

    const result = await service.cancel(ctx, 'a1', 'Feeling better');

    expect(appointmentModel.cancel).toHaveBeenCalledWith(ctx.db, { id: 'a1', reason: 'Feeling better' });
    expect(result.id).toBe('a1');
  });

  it('explains the 24-hour rule when a patient is too late', async () => {
    appointmentModel.cancel.mockResolvedValue({ ok: false, error: 'too_late', window_hours: 24 });

    await expect(service.cancel(ctx, 'a1')).rejects.toMatchObject({ status: 409, code: 'too_late', details: { window_hours: 24 } });
  });

  it.each([
    ['not_found', 404],
    ['read_only', 403],
    ['not_cancellable', 409],
  ])('turns %s into HTTP %i', async (error, status) => {
    appointmentModel.cancel.mockResolvedValue({ ok: false, error });
    await expect(service.cancel(ctx, 'a1')).rejects.toMatchObject({ status, code: error });
  });

  it('offers other times when the new time was just taken', async () => {
    appointmentModel.reschedule.mockResolvedValue({ ok: false, error: 'slot_taken' });

    await expect(service.reschedule(ctx, 'a1', { starts_at: '2026-12-01T09:00:00Z' })).rejects.toMatchObject({
      status: 409,
      code: 'slot_taken',
      details: { alternatives: [{ starts_at: 'x' }] },
    });
  });
});

describe('setStatus', () => {
  it('refuses to close a booking that has not started yet', async () => {
    appointmentModel.findForStaff.mockResolvedValue({ ...row, starts_at: new Date(Date.now() + 3_600_000).toISOString() });

    await expect(service.setStatus(ctx, 'a1', 'completed')).rejects.toMatchObject({ status: 409, code: 'not_started' });
    expect(appointmentModel.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses to close a cancelled booking', async () => {
    appointmentModel.findForStaff.mockResolvedValue({ ...row, status: 'cancelled' });

    await expect(service.setStatus(ctx, 'a1', 'no_show')).rejects.toMatchObject({ status: 409 });
  });

  it('detects that someone else changed the booking at the same moment', async () => {
    appointmentModel.findForStaff.mockResolvedValue({ ...row, starts_at: '2020-01-01T08:00:00Z' });
    appointmentModel.updateStatus.mockResolvedValue(null);

    await expect(service.setStatus(ctx, 'a1', 'completed')).rejects.toMatchObject({ status: 409 });
  });
});

describe('listMine', () => {
  it('returns an empty page for a login without a patient record', async () => {
    const page = await service.listMine({ user: { patientId: null }, db: {} }, { scope: 'upcoming', limit: 50, offset: 0 });

    expect(page).toEqual({ data: [], meta: { limit: 50, offset: 0, total: 0 } });
  });
});
