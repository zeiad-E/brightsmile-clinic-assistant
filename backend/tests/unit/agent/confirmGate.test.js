import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/utils/AppError.js';

/** The confirmation gate: nothing is booked or changed until the patient replied. */
vi.mock('../../../src/db/supabase.js', () => ({ requireAdmin: () => ({}), adminAs: () => ({}) }));
vi.mock('../../../src/services/bookingService.js', () => ({ bookAsVisitor: vi.fn() }));
vi.mock('../../../src/services/appointmentService.js', () => ({ cancel: vi.fn(), reschedule: vi.fn(), listMine: vi.fn() }));

const bookingService = await import('../../../src/services/bookingService.js');
const appointmentService = await import('../../../src/services/appointmentService.js');
const { confirmPendingAction } = await import('../../../src/agent/tools/bookingTools.js');

const pendingBooking = (proposedAtTurn) => ({
  type: 'book',
  proposedAtTurn,
  input: { service_id: 's', staff_id: 'd', starts_at: '2026-12-01T08:00:00.000Z', full_name: 'Mona Ali', email: 'mona@example.com' },
  summary: { service: 'Check-up', doctor: 'Dr. Sarah', date: '2026-12-01', weekday: 'Tuesday', time: '10:00', price_egp: 400 },
});

const ctxWith = (pending, turnNumber) => ({
  conversation: { id: 'conv-1' },
  state: { pending },
  turnNumber,
  timeZone: 'Africa/Cairo',
  isPatient: false,
  user: null,
  db: {},
  events: {},
  emit: vi.fn(),
  signIn: vi.fn(async () => ({ fullName: 'Mona Ali' })),
});

beforeEach(() => vi.clearAllMocks());

describe('confirm_pending_action', () => {
  it('refuses to book in the same turn the booking was proposed', async () => {
    const ctx = ctxWith(pendingBooking(3), 3);
    const result = await confirmPendingAction.run({}, ctx);

    expect(result.error).toBe('needs_patient_confirmation');
    expect(bookingService.bookAsVisitor).not.toHaveBeenCalled();
    expect(ctx.state.pending).toBeDefined();
  });

  it('books once the patient has replied, signs a new patient in, and clears the pending action', async () => {
    bookingService.bookAsVisitor.mockResolvedValue({
      status: 201,
      body: { appointment: { id: 'appt-1' }, is_new_patient: true, personal_code: 'K7Q4-9M2X' },
      signIn: { profile: { id: 'u1', role: 'patient' }, method: 'booking' },
    });
    const ctx = ctxWith(pendingBooking(3), 4);
    const result = await confirmPendingAction.run({}, ctx);

    expect(result).toMatchObject({ booked: true, service: 'Check-up' });
    expect(ctx.signIn).toHaveBeenCalled();
    // The code goes to the patient's screen, never to the AI.
    expect(ctx.emit).toHaveBeenCalledWith({ type: 'personal_code', code: 'K7Q4-9M2X' });
    expect(JSON.stringify(result)).not.toContain('K7Q4-9M2X');
    expect(ctx.events.booked).toBe(true);
    expect(ctx.state.pending).toBeUndefined();
  });

  it('still reports the booking if the sign-in after it fails', async () => {
    bookingService.bookAsVisitor.mockResolvedValue({
      status: 201,
      body: { appointment: { id: 'appt-1' }, is_new_patient: true },
      signIn: { profile: { id: 'u1', role: 'patient' }, method: 'booking' },
    });
    const ctx = ctxWith(pendingBooking(3), 4);
    ctx.signIn.mockRejectedValue(new Error('session store down'));

    expect(await confirmPendingAction.run({}, ctx)).toMatchObject({ booked: true });
  });

  it('uses the same retry key for the same pending booking (a retried confirm can never book twice)', async () => {
    bookingService.bookAsVisitor.mockResolvedValue({ status: 201, body: { appointment: { id: 'a' }, is_new_patient: false } });
    await confirmPendingAction.run({}, ctxWith(pendingBooking(1), 2));
    await confirmPendingAction.run({}, ctxWith(pendingBooking(1), 2));

    const [first, second] = bookingService.bookAsVisitor.mock.calls.map((c) => c[2]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('passes "slot taken" back to the AI with alternatives in clinic time', async () => {
    bookingService.bookAsVisitor.mockRejectedValue(
      new AppError(409, 'slot_taken', 'Taken.', { alternatives: [{ starts_at: '2026-12-01T08:15:00Z' }] }),
    );
    const ctx = ctxWith(pendingBooking(1), 2);
    const result = await confirmPendingAction.run({}, ctx);

    expect(result).toMatchObject({ error: 'slot_taken', alternatives: [{ date: '2026-12-01', time: '10:15' }] });
    expect(ctx.state.pending).toBeUndefined();
  });

  it('cancels as the signed-in patient, so the booking rules apply to them', async () => {
    appointmentService.cancel.mockResolvedValue({});
    const ctx = ctxWith({ type: 'cancel', proposedAtTurn: 1, input: { id: 'appt-9', reason: 'busy' }, summary: {} }, 2);
    const result = await confirmPendingAction.run({}, ctx);

    expect(result.cancelled).toBe(true);
    expect(appointmentService.cancel).toHaveBeenCalledWith({ user: ctx.user, db: ctx.db }, 'appt-9', 'busy');
  });

  it('says so when there is nothing to confirm', async () => {
    expect((await confirmPendingAction.run({}, ctxWith(undefined, 2))).error).toBe('nothing_pending');
  });
});
