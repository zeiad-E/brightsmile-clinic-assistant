import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/utils/AppError.js';

/**
 * Creating an account. The risky part is the record that already exists: a stranger must never get
 * into it, or attach their own email to it, by filling in a form.
 */
vi.mock('../../src/db/supabase.js', () => ({ requireAdmin: () => ({}), adminAs: () => ({}) }));
vi.mock('../../src/models/patientModel.js', () => ({ findByEmail: vi.fn(), findByPhone: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock('../../src/models/profileModel.js', () => ({ updateLogin: vi.fn() }));
vi.mock('../../src/services/accountService.js', () => ({ ensurePatientAccount: vi.fn(async () => ({ id: 'profile-1', role: 'patient' })) }));
vi.mock('../../src/services/authService.js', () => ({ sendEmailCode: vi.fn(), checkEmailCode: vi.fn(), phoneLogin: vi.fn(), sendCurrentCode: vi.fn() }));
vi.mock('../../src/services/personalCodeService.js', () => ({ issueCode: vi.fn(async () => 'K7Q4-9M2X') }));

const { finishRegistration, startRegistration } = await import('../../src/services/registrationService.js');
const authService = await import('../../src/services/authService.js');
const patientModel = await import('../../src/models/patientModel.js');
const personalCodeService = await import('../../src/services/personalCodeService.js');

const FORM = { full_name: 'Ahmed Ali', date_of_birth: '1990-01-01', phone: '+201001234567', preferred_language: 'ar' };
const finish = () => finishRegistration({ email: 'a@b.co', code: '123456' }, { visitor: '1.2.3.4' });

beforeEach(() => {
  vi.clearAllMocks();
  authService.checkEmailCode.mockResolvedValue({ payload: FORM });
  patientModel.findByEmail.mockResolvedValue(null);
  patientModel.findByPhone.mockResolvedValue(null);
  patientModel.create.mockResolvedValue({ id: 'patient-1', ...FORM });
});

describe('starting', () => {
  it('keeps the form with the code, and creates nothing yet', async () => {
    const answer = await startRegistration({ ...FORM, email: 'a@b.co' });

    expect(answer).toEqual({ sent: true });
    expect(authService.sendEmailCode).toHaveBeenCalledWith({ purpose: 'sign_up', email: 'a@b.co', language: 'ar', payload: FORM });
    expect(patientModel.create).not.toHaveBeenCalled();
  });
});

describe('finishing', () => {
  it('creates a new patient with a personal code, and emails it', async () => {
    const result = await finish();

    expect(patientModel.create).toHaveBeenCalledWith(expect.anything(), { ...FORM, email: 'a@b.co' });
    expect(result).toMatchObject({ method: 'sign_up', personalCode: 'K7Q4-9M2X', profile: { id: 'profile-1' } });
    expect(authService.sendCurrentCode).toHaveBeenCalled();
  });

  it('creates nothing when the emailed code is wrong', async () => {
    authService.checkEmailCode.mockRejectedValue(AppError.unauthorized('invalid_code', 'Wrong.'));

    await expect(finish()).rejects.toMatchObject({ code: 'invalid_code' });
    expect(patientModel.create).not.toHaveBeenCalled();
  });

  it('same email: enters that record, fills only what is empty, and keeps their code', async () => {
    patientModel.findByEmail.mockResolvedValue({ id: 'old', full_name: 'Ahmed A.', date_of_birth: '1980-05-05', phone: null });

    const result = await finish();

    expect(patientModel.update).toHaveBeenCalledWith(expect.anything(), 'old', { phone: FORM.phone });
    expect(patientModel.create).not.toHaveBeenCalled();
    expect(personalCodeService.issueCode).not.toHaveBeenCalled();
    expect(result.personalCode).toBeNull();
  });

  it('same email: does not take a phone that is on someone else’s record', async () => {
    patientModel.findByEmail.mockResolvedValue({ id: 'old', date_of_birth: '1980-05-05', phone: null });
    patientModel.findByPhone.mockResolvedValue({ id: 'someone-else' });

    await finish();

    expect(patientModel.update).not.toHaveBeenCalled();
  });

  it('same phone with no email: must pass the phone check before the email is attached', async () => {
    patientModel.findByPhone.mockResolvedValue({ id: 'old', email: null });
    authService.phoneLogin.mockResolvedValue({ profile: { id: 'old-profile' } });

    const result = await finish();

    expect(authService.phoneLogin).toHaveBeenCalledWith(FORM, { visitor: '1.2.3.4' });
    expect(patientModel.update).toHaveBeenCalledWith(expect.anything(), 'old', { email: 'a@b.co' });
    expect(result.profile.id).toBe('old-profile');
  });

  it('same phone, wrong name or birthday: refused, and nothing changes', async () => {
    patientModel.findByPhone.mockResolvedValue({ id: 'old', email: null });
    authService.phoneLogin.mockRejectedValue(AppError.unauthorized('invalid_credentials', 'No match.'));

    await expect(finish()).rejects.toMatchObject({ status: 409, code: 'phone_in_use' });
    expect(patientModel.update).not.toHaveBeenCalled();
  });

  it('same phone with another email: refused without even trying the phone check', async () => {
    patientModel.findByPhone.mockResolvedValue({ id: 'old', email: 'other@b.co' });

    await expect(finish()).rejects.toMatchObject({ code: 'phone_in_use' });
    expect(authService.phoneLogin).not.toHaveBeenCalled();
  });

  it('someone takes the phone a moment earlier: the same refusal, not a server error', async () => {
    patientModel.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));

    await expect(finish()).rejects.toMatchObject({ code: 'phone_in_use' });
  });
});
