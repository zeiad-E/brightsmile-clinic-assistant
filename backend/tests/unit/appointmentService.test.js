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
  clinicBranding: vi.fn(async () => ({ timeZone: 'Africa/Cairo', cancellationWindowHours: 24 })),
  clinicNameIn: () => 'BrightSmile',
}));
vi.mock('../../src/services/email/emailService.js', () => ({ sendEmailInBackground: vi.fn() }));
vi.mock('../../src/services/waitlistService.js', () => ({ announceOpening: vi.fn(async () => {}) }));

const appointmentModel = await import('../../src/models/appointmentModel.js');
const service = await import('../../src/services/appointmentService.js');
const waitlistService = await import('../../src/services/waitlistService.js');

const HOUR = 3_600_000;
const inHours = (h) => new Date(Date.now() + h * HOUR).toISOString();

const ctx = { user: { id: 'u', role: 'staff' }, db: { user: true } };
const patientCtx = { user: { id: 'u', role: 'patient', patientId: 'p' }, db: { user: true } };
const row = { id: 'a1', patient_id: 'p', staff_id: 'doc', service_id: 'svc', starts_at: '2026-12-01T08:00:00Z', status: 'booked' };

beforeEach(() => {
  vi.clearAllMocks();
  appointmentModel.findById.mockResolvedValue(row);
});

describe('cancel / reschedule', () => {
  it('cancels with the caller’s database client (so the audit log names them)', async () => {
    appointmentModel.cancel.mockResolvedValue({ ok: true });

    const result = await service.cancel(ctx, 'a1', 'Feeling better');

    expect(appointmentModel.cancel).toHaveBeenCalledWith(ctx.db, { id: 'a1', reason: 'Feeling better' });
    expect(result.id).toBe('a1');
  });

  it('explains the change window when a patient is too late', async () => {
    appointmentModel.findById.mockResolvedValue({ ...row, starts_at: inHours(23) });

    await expect(service.cancel(patientCtx, 'a1')).rejects.toMatchObject({ status: 409, code: 'too_late', details: { window_hours: 24 } });
    await expect(service.reschedule(patientCtx, 'a1', { starts_at: inHours(48) })).rejects.toMatchObject({ code: 'too_late' });
    expect(appointmentModel.cancel).not.toHaveBeenCalled();
    expect(appointmentModel.reschedule).not.toHaveBeenCalled();
  });

  it('lets a patient change their own booking while the window is open', async () => {
    appointmentModel.findById.mockResolvedValue({ ...row, starts_at: inHours(25) });
    appointmentModel.cancel.mockResolvedValue({ ok: true });

    await service.cancel(patientCtx, 'a1');

    expect(appointmentModel.cancel).toHaveBeenCalled();
  });

  it('lets staff change a booking at any time, even at the last minute', async () => {
    appointmentModel.findById.mockResolvedValue({ ...row, starts_at: inHours(1) });
    appointmentModel.cancel.mockResolvedValue({ ok: true });

    await service.cancel(ctx, 'a1');

    expect(appointmentModel.cancel).toHaveBeenCalled();
  });

  it('makes someone else’s booking look as if it doesn’t exist', async () => {
    appointmentModel.findById.mockResolvedValue({ ...row, patient_id: 'someone-else', starts_at: inHours(48) });

    await expect(service.cancel(patientCtx, 'a1')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(service.reschedule(patientCtx, 'a1', { starts_at: inHours(72) })).rejects.toMatchObject({ status: 404 });
    await expect(service.getMine(patientCtx, 'a1')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    expect(appointmentModel.cancel).not.toHaveBeenCalled();
  });

  it('shows a patient their own booking', async () => {
    expect((await service.getMine(patientCtx, 'a1')).id).toBe('a1');
  });

  it('refuses a booking that is missing or already closed', async () => {
    appointmentModel.findById.mockResolvedValue(null);
    await expect(service.cancel(ctx, 'a1')).rejects.toMatchObject({ status: 404, code: 'not_found' });

    appointmentModel.findById.mockResolvedValue({ ...row, status: 'cancelled' });
    await expect(service.cancel(ctx, 'a1')).rejects.toMatchObject({ status: 409, code: 'not_cancellable' });
  });

  it('passes on what the database refuses at the last moment', async () => {
    appointmentModel.cancel.mockResolvedValue({ ok: false, error: 'not_cancellable' });

    await expect(service.cancel(ctx, 'a1')).rejects.toMatchObject({ status: 409, code: 'not_cancellable' });
  });

  it('offers other times when the new time was just taken', async () => {
    appointmentModel.reschedule.mockResolvedValue({ ok: false, error: 'slot_taken' });

    await expect(service.reschedule(ctx, 'a1', { starts_at: '2026-12-01T09:00:00Z' })).rejects.toMatchObject({
      status: 409,
      code: 'slot_taken',
      details: { alternatives: [{ starts_at: 'x' }] },
    });
    expect(waitlistService.announceOpening).not.toHaveBeenCalled();
  });

  it('tells the waitlist that a cancelled time is free', async () => {
    appointmentModel.cancel.mockResolvedValue({ ok: true });
    appointmentModel.findForNotification.mockResolvedValueOnce({ ...row, patient: null });

    await service.cancel(ctx, 'a1');
    await vi.waitFor(() => expect(waitlistService.announceOpening).toHaveBeenCalled());

    expect(waitlistService.announceOpening).toHaveBeenCalledWith({ serviceId: 'svc', staffId: 'doc', startsAt: row.starts_at });
  });

  it('tells the waitlist about the OLD time after a reschedule', async () => {
    appointmentModel.reschedule.mockResolvedValue({ ok: true });
    appointmentModel.findById.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, starts_at: '2026-12-02T08:00:00Z' });

    await service.reschedule(ctx, 'a1', { starts_at: '2026-12-02T08:00:00Z' });

    expect(waitlistService.announceOpening).toHaveBeenCalledWith({ serviceId: 'svc', staffId: 'doc', startsAt: row.starts_at });
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
