import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/utils/AppError.js';

/** Creating an account by chatting. The personal code goes to the patient's screen, never to the AI. */
vi.mock('../../src/services/registrationService.js', () => ({ startRegistration: vi.fn(), finishRegistration: vi.fn() }));
vi.mock('../../src/services/authService.js', () => ({}));

const { finishSignUp, startSignUp } = await import('../../src/agent/tools/accountTools.js');
const registrationService = await import('../../src/services/registrationService.js');

const DETAILS = { full_name: 'Ahmed Ali', date_of_birth: '1990-01-01', phone: '+201001234567', email: 'a@b.co' };
const chat = (state = {}) => ({
  state,
  map: {},
  language: 'ar',
  visitor: '1.2.3.4',
  isPatient: false,
  emit: vi.fn(),
  signIn: vi.fn(async () => ({ fullName: 'Ahmed Ali' })),
});

beforeEach(() => vi.clearAllMocks());

describe('start_sign_up', () => {
  it('works on a first visit, and remembers the email for the next step', async () => {
    const ctx = chat({ firstVisit: true });

    expect(await startSignUp.run(DETAILS, ctx)).toMatchObject({ sent: true });
    expect(registrationService.startRegistration).toHaveBeenCalledWith({ ...DETAILS, preferred_language: 'ar' });
    expect(ctx.state.emailForSignUp).toBe('a@b.co');
  });

  it('shows the sign-up form, filled in, for a bad detail instead of sending anything', async () => {
    const ctx = chat();
    const result = await startSignUp.run({ ...DETAILS, phone: 'nope' }, ctx);

    expect(result).toMatchObject({ form_shown: true, purpose: 'sign_up' });
    expect(ctx.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'details_form', purpose: 'sign_up', values: expect.objectContaining({ full_name: 'Ahmed Ali', phone: 'nope' }) }));
    // The AI only learns that the form is up, never the values in it.
    expect(JSON.stringify(result)).not.toContain('a@b.co');
    expect(registrationService.startRegistration).not.toHaveBeenCalled();
  });

  it('takes the details the patient already gave from the notebook', async () => {
    const ctx = chat();
    ctx.state.notebook = { patient: { full_name: 'Ahmed Ali', phone: '[PHONE_1]', email: '[EMAIL_1]', date_of_birth: '[DOB_1]' }, booking: {} };
    Object.assign(ctx.map, { '[PHONE_1]': '01001234567', '[EMAIL_1]': 'a@b.co', '[DOB_1]': '1/1/1990' });

    expect(await startSignUp.run({}, ctx)).toMatchObject({ sent: true });
    expect(registrationService.startRegistration).toHaveBeenCalledWith({ ...DETAILS, preferred_language: 'ar' });
  });

  it('has nothing to do for someone already signed in', async () => {
    expect(await startSignUp.run(DETAILS, { ...chat(), isPatient: true })).toEqual({ already_signed_in: true });
  });
});

describe('finish_sign_up', () => {
  it('needs start_sign_up first', async () => {
    expect(await finishSignUp.run({ code: '123456' }, chat())).toMatchObject({ error: 'sign_up_not_started' });
  });

  it('shows the code on the screen and keeps it out of what the AI gets back', async () => {
    registrationService.finishRegistration.mockResolvedValue({ profile: { id: 'p' }, method: 'sign_up', personalCode: 'K7Q4-9M2X' });
    const ctx = chat({ emailForSignUp: 'a@b.co' });

    const result = await finishSignUp.run({ code: '123 456' }, ctx);

    expect(registrationService.finishRegistration).toHaveBeenCalledWith({ email: 'a@b.co', code: '123456' }, { via: 'patient_assistant', visitor: '1.2.3.4' });
    expect(ctx.emit).toHaveBeenCalledWith({ type: 'personal_code', code: 'K7Q4-9M2X' });
    expect(JSON.stringify(result)).not.toContain('K7Q4');
    expect(result).toMatchObject({ signed_in: true });
    expect(ctx.state.emailForSignUp).toBeUndefined();
  });

  it('tells the AI to offer sign-in when the phone is taken', async () => {
    registrationService.finishRegistration.mockRejectedValue(AppError.conflict('phone_in_use', 'Taken.'));

    expect(await finishSignUp.run({ code: '123456' }, chat({ emailForSignUp: 'a@b.co' }))).toMatchObject({ error: 'phone_in_use' });
  });

  it('counts a wrong code as a failed try', async () => {
    registrationService.finishRegistration.mockRejectedValue(AppError.unauthorized('invalid_code', 'Wrong.'));
    const ctx = chat({ emailForSignUp: 'a@b.co' });

    expect(await finishSignUp.run({ code: '123456' }, ctx)).toMatchObject({ error: 'invalid_code' });
    expect(ctx.state.signInAttempts).toBe(1);
    expect(ctx.state.emailForSignUp).toBe('a@b.co');
  });
});
