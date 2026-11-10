import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The notebook (short memory for one chat) and the details form (agent/notebook.js, agent/detailsForm.js). */
vi.mock('../../../src/db/supabase.js', () => ({ requireAdmin: () => ({}), adminAs: () => ({}) }));
vi.mock('../../../src/services/bookingService.js', () => ({ bookAsVisitor: vi.fn() }));
vi.mock('../../../src/services/appointmentService.js', () => ({ cancel: vi.fn(), reschedule: vi.fn(), listMine: vi.fn() }));
vi.mock('../../../src/services/catalogService.js', () => ({
  listServices: vi.fn(async () => [{ id: 's', slug: 'check-up', name_en: 'Check-up', name_ar: 'كشف', duration_minutes: 30, price_egp: 400 }]),
  listDoctors: vi.fn(async () => [{ id: 'd', full_name_en: 'Sarah Mansour', full_name_ar: 'سارة منصور', service_ids: ['s'] }]),
}));
// 10:00 Cairo on 1 Dec 2026 is free
vi.mock('../../../src/models/availabilityModel.js', () => ({ slotsFor: vi.fn(async () => [{ slot_start: '2026-12-01T08:00:00.000Z' }]) }));
vi.mock('../../../src/services/availabilityService.js', () => ({ nextFreeSlots: vi.fn(async () => []), forRange: vi.fn() }));
vi.mock('../../../src/models/patientModel.js', () => ({ findById: vi.fn(), findByPhone: vi.fn(async () => null), findByEmail: vi.fn(async () => null) }));
vi.mock('../../../src/services/authService.js', () => ({ phoneLogin: vi.fn() }));
const patientModel = await import('../../../src/models/patientModel.js');
const authService = await import('../../../src/services/authService.js');
const { AppError } = await import('../../../src/utils/AppError.js');

const { describeNotebook, note, noteFromMessage, patientDetails } = await import('../../../src/agent/notebook.js');
const { proposeBooking } = await import('../../../src/agent/tools/bookingTools.js');
const { noteDetails, showDetailsFormTool } = await import('../../../src/agent/tools/formTools.js');
const { maskText } = await import('../../../src/agent/masking.js');

const chat = (state = {}) => ({
  conversation: { id: 'conv-1' },
  state,
  map: {},
  turnNumber: 2,
  language: 'en',
  timeZone: 'Africa/Cairo',
  isPatient: false,
  user: null,
  db: {},
  events: {},
  emit: vi.fn(),
});
const choice = { service: 'check-up', doctor: 'Sarah', date: '2026-12-01', time: '10:00' };
const cardOf = (ctx, type) => ctx.emit.mock.calls.map(([card]) => card).find((card) => card.type === type);

beforeEach(() => vi.clearAllMocks());

describe('the notebook', () => {
  it('writes down a phone, email and birth date the moment the patient types them', () => {
    const ctx = chat();
    const masked = maskText('I am Mona, 0100 123 4567, mona@example.com, born 15/3/1990', ctx.map, { now: new Date('2026-11-10') });
    noteFromMessage(ctx.state, masked);

    expect(ctx.state.notebook.patient).toEqual({ phone: '[PHONE_1]', email: '[EMAIL_1]', date_of_birth: '[DOB_1]' });
    expect(patientDetails(ctx.state, ctx.map)).toEqual({ phone: '01001234567', email: 'mona@example.com', date_of_birth: '15/3/1990' });
  });

  it('keeps real values out of what the AI reads', () => {
    const ctx = chat();
    note(ctx.state, { patient: { full_name: 'Mona Ali', phone: '+201001234567', date_of_birth: '2025-06-01' } }, ctx.map);

    const text = describeNotebook(ctx.state.notebook);
    expect(text).toContain('full name: Mona Ali');
    expect(text).toContain('phone: [PHONE_1]');
    // even a birth date too recent for the "is this a birth date?" pattern stays hidden
    expect(text).toContain('date of birth: [DOB_1]');
    expect(text).toContain('not given yet: email');
    expect(text).not.toMatch(/\+20|2025-06-01/);
  });

  it('starts the choice over when the service changes, and drops a booking still waiting for "yes"', () => {
    const state = { pending: { type: 'book' } };
    note(state, { booking: { service: 'Check-up', doctor: 'Sarah Mansour', date: '2026-12-01', time: '10:00' } });
    state.pending = { type: 'book' };

    note(state, { booking: { service: 'Check-up', time: '10:00' } }); // same choice again: nothing changes
    expect(state.pending).toEqual({ type: 'book' });

    note(state, { booking: { service: 'Whitening' } });
    expect(state.notebook.booking).toEqual({ service: 'Whitening' });
    expect(state.pending).toBeUndefined(); // "yes" can't book the old check-up any more
  });

  it('shows a signed-in patient only the booking choice (their details come from the account)', () => {
    const text = describeNotebook({ patient: { full_name: 'Mona Ali' }, booking: { service: 'Check-up' } }, { signedIn: true });
    expect(text).toBe('- Booking choice: service: Check-up');
  });
});

describe('note_details', () => {
  it('notes the name and preference, with the service by its real name', async () => {
    const ctx = chat();
    const result = await noteDetails.run({ full_name: 'Mona Ali', service: 'check up', preference: 'afternoons only' }, ctx);

    expect(result).toEqual({ noted: ['full_name', 'service', 'preference'] });
    expect(ctx.state.notebook).toEqual({ patient: { full_name: 'Mona Ali' }, booking: { service: 'Check-up', preference: 'afternoons only' } });
  });
});

describe('show_details_form', () => {
  it('shows the booking form filled in from the notebook, with the chosen time on top', async () => {
    const ctx = chat({ notebook: { patient: { full_name: 'Mona Ali', phone: '[PHONE_1]' }, booking: {} } });
    ctx.map['[PHONE_1]'] = '0100 123 4567';

    const result = await showDetailsFormTool.run({ purpose: 'booking', ...choice }, ctx);

    expect(result).toMatchObject({ form_shown: true, already_filled: ['full_name', 'phone'], still_needed: ['date_of_birth'] });
    expect(JSON.stringify(result)).not.toContain('100 123'); // the AI never gets the values
    expect(cardOf(ctx, 'details_form')).toMatchObject({
      purpose: 'booking',
      values: { full_name: 'Mona Ali', phone: '+201001234567' }, // tidied for the form
      booking: { service: 'Check-up', doctor: 'Sarah Mansour', doctor_ar: 'سارة منصور', date: '2026-12-01', weekday: 'Tuesday', time: '10:00' },
    });
    expect(ctx.state.notebook.booking).toMatchObject({ service: 'Check-up', doctor: 'Sarah Mansour', date: '2026-12-01', time: '10:00' });
  });

  it('waits until a service, doctor and time are chosen', async () => {
    const result = await showDetailsFormTool.run({ purpose: 'booking', service: 'check-up' }, chat());
    expect(result).toMatchObject({ error: 'choose_first', missing: ['doctor', 'date', 'time'] });
  });

  it('refuses a time that is not free, before the patient types anything', async () => {
    const ctx = chat();
    const result = await showDetailsFormTool.run({ purpose: 'booking', ...choice, time: '11:00' }, ctx);
    expect(result).toMatchObject({ error: 'time_not_available' });
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('sends a first-time patient to the booking form and a returning one to sign in', async () => {
    expect(await showDetailsFormTool.run({ purpose: 'sign_in' }, chat({ firstVisit: true }))).toMatchObject({ error: 'first_visit' });
    expect(await showDetailsFormTool.run({ purpose: 'booking', ...choice }, chat({ firstVisit: false }))).toMatchObject({ error: 'returning_patient' });
    expect(await showDetailsFormTool.run({ purpose: 'sign_in' }, chat({ firstVisit: false }))).toMatchObject({ form_shown: true, purpose: 'sign_in' });
  });

  it('has nothing to show a signed-in patient', async () => {
    const ctx = { ...chat(), isPatient: true };
    expect(await showDetailsFormTool.run({ purpose: 'booking', ...choice }, ctx)).toMatchObject({ error: 'signed_in' });
    expect(await showDetailsFormTool.run({ purpose: 'sign_in' }, ctx)).toEqual({ already_signed_in: true });
  });
});

describe('propose_booking with the notebook', () => {
  it('takes the details the AI left out from the notebook (no "please tell me your name again")', async () => {
    const ctx = chat({ notebook: { patient: { full_name: 'Mona Ali', date_of_birth: '[DOB_1]', phone: '[PHONE_1]' }, booking: {} } });
    Object.assign(ctx.map, { '[DOB_1]': '15/3/1990', '[PHONE_1]': '1001234567' });

    const result = await proposeBooking.run({ service: 'check-up', doctor: 'Sarah', date: '2026-12-01', time: '10:00' }, ctx);

    expect(result.pending).toBe(true);
    expect(ctx.state.pending.input).toMatchObject({ full_name: 'Mona Ali', date_of_birth: '1990-03-15', phone: '+201001234567' });
    // the summary card shows the patient their own details too; the AI's result doesn't carry them
    expect(cardOf(ctx, 'booking_summary')).toMatchObject({ patient_name: 'Mona Ali', patient_phone: '+201001234567', patient_dob: '1990-03-15' });
    expect(JSON.stringify(result)).not.toContain('1001234567');
  });

  it('shows the form instead of asking, when a detail is missing or wrong', async () => {
    const ctx = chat({ notebook: { patient: { full_name: 'Mona Ali', phone: '[PHONE_1]' }, booking: {} } });
    ctx.map['[PHONE_1]'] = '010000000000'; // one digit too many

    const result = await proposeBooking.run({ service: 'check-up', doctor: 'Sarah', date: '2026-12-01', time: '10:00' }, ctx);

    expect(result).toMatchObject({ form_shown: true, purpose: 'booking', still_needed: ['date_of_birth'] });
    expect(result.error).toBeUndefined();
    expect(ctx.state.pending).toBeUndefined();
    // the form opens with the number as typed (tidied), so the patient sees what to fix
    expect(cardOf(ctx, 'details_form').values).toMatchObject({ full_name: 'Mona Ali', phone: '+2010000000000' });
  });

  describe('a guest who already has a file (same phone or email)', () => {
    const FILE = { id: 'p1', full_name: 'Mona Ali', date_of_birth: '1990-03-15', phone: '+201001234567', email: 'mona@example.com', preferred_language: 'en' };
    const filledIn = () => {
      const ctx = chat({ firstVisit: true, notebook: { patient: { full_name: 'Mona Ali', date_of_birth: '[DOB_1]', phone: '[PHONE_1]' }, booking: {} } });
      Object.assign(ctx.map, { '[DOB_1]': '1990-03-15', '[PHONE_1]': '01001234567' });
      ctx.signIn = vi.fn(async () => {
        Object.assign(ctx, { isPatient: true, user: { patientId: 'p1' } });
        return { fullName: 'Mona Ali' };
      });
      return ctx;
    };
    const book = (ctx) => proposeBooking.run({ service: 'check-up', doctor: 'Sarah', date: '2026-12-01', time: '10:00' }, ctx);

    it('signs them in when name, birth date and phone match the file, and books on their account', async () => {
      patientModel.findByPhone.mockResolvedValueOnce(FILE);
      patientModel.findById.mockResolvedValueOnce(FILE);
      authService.phoneLogin.mockResolvedValueOnce({ profile: { id: 'u1' }, method: 'phone' });
      const ctx = filledIn();

      const result = await book(ctx);

      expect(authService.phoneLogin).toHaveBeenCalledWith({ phone: '+201001234567', full_name: 'Mona Ali', date_of_birth: '1990-03-15' }, expect.anything());
      expect(ctx.signIn).toHaveBeenCalled();
      expect(result).toMatchObject({ pending: true, signed_in: true });
      expect(ctx.state.pending.input).toMatchObject({ full_name: 'Mona Ali', email: 'mona@example.com' }); // the file's own details
    });

    it('brings the form back at once (not at "yes, book it") when the birth date or name does not match', async () => {
      patientModel.findByPhone.mockResolvedValueOnce(FILE);
      authService.phoneLogin.mockRejectedValueOnce(new AppError(401, 'invalid_credentials', "These details don't match our records."));
      const ctx = filledIn();

      const result = await book(ctx);

      expect(result).toMatchObject({ form_shown: true, on_file: true });
      expect(result.next).toMatch(/Never say which detail is wrong/);
      expect(cardOf(ctx, 'details_form')).toMatchObject({ notice: 'file_mismatch' });
      expect(ctx.signIn).not.toHaveBeenCalled();
      expect(ctx.state.pending).toBeUndefined();
    });

    it('never treats an email on someone else’s file as proof', async () => {
      patientModel.findByEmail.mockResolvedValueOnce({ ...FILE, id: 'p2' });
      const ctx = filledIn();
      ctx.state.notebook.patient.email = '[EMAIL_1]';
      ctx.map['[EMAIL_1]'] = 'mona@example.com';

      expect(await book(ctx)).toMatchObject({ form_shown: true, on_file: true });
      expect(authService.phoneLogin).not.toHaveBeenCalled();
    });
  });

  it('asks a returning guest to sign in to their own file instead', async () => {
    const result = await proposeBooking.run({ service: 'check-up', doctor: 'Sarah', date: '2026-12-01', time: '10:00' }, chat({ firstVisit: false }));
    expect(result).toMatchObject({ form_shown: true, purpose: 'sign_in' });
  });
});
