import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../src/auth/passwords.js';
import { emailCodeFingerprint } from '../../src/auth/emailCodes.js';

/** Every way to sign in, with the database replaced by fakes. */
const sent = [];

vi.mock('../../src/db/supabase.js', () => ({ requireAdmin: () => ({}), adminAs: () => ({}) }));
vi.mock('../../src/models/patientModel.js', () => ({
  findByEmail: vi.fn(),
  findForPhoneLogin: vi.fn(),
  recordWrongPhoneLogin: vi.fn(),
  unlockLogin: vi.fn(),
  findById: vi.fn(),
}));
vi.mock('../../src/models/profileModel.js', () => ({ findTeamLogin: vi.fn(), findLogin: vi.fn(), recordWrongPassword: vi.fn(), updateLogin: vi.fn(), findById: vi.fn() }));
vi.mock('../../src/models/staffModel.js', () => ({ findById: vi.fn() }));
vi.mock('../../src/models/loginCodeModel.js', () => ({
  find: vi.fn(),
  save: vi.fn(),
  countWrongTry: vi.fn(),
  consume: vi.fn(async () => ({ id: 'row' })),
  remove: vi.fn(),
}));
vi.mock('../../src/services/accountService.js', () => ({ ensurePatientAccount: vi.fn(async (patient) => ({ id: patient.profile_id ?? 'profile-new', role: 'patient' })), setPassword: vi.fn() }));
vi.mock('../../src/services/personalCodeService.js', () => ({ findPatientByCode: vi.fn(), currentOrNewCode: vi.fn(async () => ({ code: 'K7Q4-9M2X', replaced: false })) }));
vi.mock('../../src/services/catalogService.js', () => ({ clinicBranding: vi.fn(async () => ({})), clinicNameIn: () => 'BrightSmile' }));
vi.mock('../../src/services/email/emailService.js', () => ({ sendEmailInBackground: vi.fn((mail) => sent.push(mail)) }));
vi.mock('../../src/auth/sessions.js', () => ({ revokeAllFor: vi.fn() }));
vi.mock('../../src/auth/attemptLimiter.js', () => ({ attempts: { assertAllowed: vi.fn(), recordFailure: vi.fn() } }));

const patientModel = await import('../../src/models/patientModel.js');
const profileModel = await import('../../src/models/profileModel.js');
const loginCodeModel = await import('../../src/models/loginCodeModel.js');
const accountService = await import('../../src/services/accountService.js');
const personalCodeService = await import('../../src/services/personalCodeService.js');
const sessions = await import('../../src/auth/sessions.js');
const { attempts } = await import('../../src/auth/attemptLimiter.js');
const authService = await import('../../src/services/authService.js');

const PASSWORD = 'correct horse battery';
const PASSWORD_HASH = await hashPassword(PASSWORD);
const mariam = { id: 'pat-1', profile_id: 'prof-1', full_name: 'مريم حسن', date_of_birth: '1995-03-02', email: 'mariam@x.co', preferred_language: 'ar', login_failed_attempts: 0, login_locked_until: null };
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  loginCodeModel.find.mockResolvedValue(null);
  loginCodeModel.consume.mockResolvedValue({ id: 'row' });
  attempts.assertAllowed.mockImplementation(() => {});
});

describe('team sign-in', () => {
  const password = PASSWORD;
  const hash = PASSWORD_HASH;
  const member = (extra = {}) => ({ id: 's1', role: 'staff', full_name: 'Sam', password_hash: hash, failed_login_attempts: 0, locked_until: null, disabled_at: null, ...extra });

  it('signs in with the right password and records it', async () => {
    profileModel.findTeamLogin.mockResolvedValue(member({ failed_login_attempts: 2 }));

    const result = await authService.staffLogin({ email: 's@x.co', password });

    expect(result).toMatchObject({ method: 'password', profile: { id: 's1', role: 'staff' } });
    expect(profileModel.updateLogin).toHaveBeenCalledWith({}, 's1', expect.objectContaining({ failed_login_attempts: 0, locked_until: null, last_sign_in_at: expect.any(String) }));
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    profileModel.findTeamLogin.mockResolvedValueOnce(member());
    const wrong = await authService.staffLogin({ email: 's@x.co', password: 'nope' }).catch((e) => e);
    profileModel.findTeamLogin.mockResolvedValueOnce(null);
    const unknown = await authService.staffLogin({ email: 'x@x.co', password: 'nope' }).catch((e) => e);

    expect(wrong).toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(unknown).toMatchObject({ status: 401, code: 'invalid_credentials', message: wrong.message });
  });

  it('refuses an account that has no password yet', async () => {
    profileModel.findTeamLogin.mockResolvedValue(member({ password_hash: null }));

    await expect(authService.staffLogin({ email: 's@x.co', password })).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('locks the account on the 5th wrong password', async () => {
    profileModel.findTeamLogin.mockResolvedValue(member({ failed_login_attempts: 4 }));

    await expect(authService.staffLogin({ email: 's@x.co', password: 'nope' })).rejects.toMatchObject({ code: 'invalid_credentials' });

    expect(profileModel.recordWrongPassword).toHaveBeenCalledWith({}, expect.anything(), { failed_login_attempts: 0, locked_until: expect.any(String) });
  });

  it('refuses a locked account, even with the right password', async () => {
    profileModel.findTeamLogin.mockResolvedValue(member({ locked_until: inMinutes(10) }));

    await expect(authService.staffLogin({ email: 's@x.co', password })).rejects.toMatchObject({ status: 423, code: 'account_locked' });
  });

  it('says an account is disabled only after the right password', async () => {
    profileModel.findTeamLogin.mockResolvedValue(member({ disabled_at: inMinutes(-1) }));

    await expect(authService.staffLogin({ email: 's@x.co', password })).rejects.toMatchObject({ status: 403, code: 'account_disabled' });
    await expect(authService.staffLogin({ email: 's@x.co', password: 'nope' })).rejects.toMatchObject({ status: 401 });
  });

  it('changes a password only with the current one, keeping this device signed in', async () => {
    profileModel.findLogin.mockResolvedValue(member());
    const user = { id: 's1', sessionId: 'this-device' };

    await expect(authService.changePassword({ user }, { current_password: 'nope', new_password: 'a-new-password' })).rejects.toMatchObject({ code: 'wrong_password' });
    expect(accountService.setPassword).not.toHaveBeenCalled();

    await authService.changePassword({ user }, { current_password: password, new_password: 'a-new-password' });
    expect(accountService.setPassword).toHaveBeenCalledWith('s1', 'a-new-password', { mustChange: false });
    expect(sessions.revokeAllFor).toHaveBeenCalledWith('s1', 'password_changed', { exceptId: 'this-device' });
  });
});

describe('email codes', () => {
  const savedRow = (code, extra = {}) => ({
    id: 'row',
    code_hmac: emailCodeFingerprint('sign_in', 'mariam@x.co', code),
    attempts: 0,
    expires_at: inMinutes(5),
    created_at: inMinutes(-5),
    send_count: 1,
    window_started_at: inMinutes(-5),
    ...extra,
  });

  it('emails a patient a code, storing only its fingerprint', async () => {
    patientModel.findByEmail.mockResolvedValue(mariam);

    expect(await authService.startEmailCode({ email: 'mariam@x.co' })).toMatchObject({ sent: true });

    const { code } = sent[0].data;
    expect(sent[0]).toMatchObject({ template: 'email_code', to: 'mariam@x.co', language: 'ar' });
    expect(code).toMatch(/^\d{6}$/);
    const row = loginCodeModel.save.mock.calls[0][1];
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.code_hmac).toBe(emailCodeFingerprint('sign_in', 'mariam@x.co', code));
  });

  it('answers identically for an unknown or team email, and sends nothing', async () => {
    patientModel.findByEmail.mockResolvedValueOnce(mariam);
    const known = await authService.startEmailCode({ email: 'mariam@x.co' });
    sent.length = 0;
    patientModel.findByEmail.mockResolvedValueOnce(null);
    const unknown = await authService.startEmailCode({ email: 'owner@clinic.co' });

    expect(unknown).toEqual(known);
    expect(sent).toEqual([]);
  });

  it('won’t resend within a minute, or more than 5 times an hour', async () => {
    patientModel.findByEmail.mockResolvedValue(mariam);

    loginCodeModel.find.mockResolvedValueOnce(savedRow('123456', { created_at: inMinutes(-0.5) }));
    await authService.startEmailCode({ email: 'mariam@x.co' });
    loginCodeModel.find.mockResolvedValueOnce(savedRow('123456', { send_count: 5 }));
    await authService.startEmailCode({ email: 'mariam@x.co' });

    expect(sent).toEqual([]);
  });

  it('starts counting sends again after an hour', async () => {
    patientModel.findByEmail.mockResolvedValue(mariam);
    loginCodeModel.find.mockResolvedValueOnce(savedRow('123456', { send_count: 5, window_started_at: inMinutes(-61) }));

    await authService.startEmailCode({ email: 'mariam@x.co' });

    expect(loginCodeModel.save.mock.calls[0][1].send_count).toBe(1);
  });

  it('signs in with the right code, using it up', async () => {
    loginCodeModel.find.mockResolvedValue(savedRow('123456'));
    patientModel.findByEmail.mockResolvedValue(mariam);

    expect(await authService.verifyEmailCode({ email: 'mariam@x.co', code: '123456' })).toMatchObject({ method: 'email_code', profile: { id: 'prof-1', role: 'patient' } });
    expect(loginCodeModel.consume).toHaveBeenCalled();
  });

  it('counts a wrong code', async () => {
    loginCodeModel.find.mockResolvedValue(savedRow('123456'));

    await expect(authService.verifyEmailCode({ email: 'mariam@x.co', code: '000000' })).rejects.toMatchObject({ status: 401, code: 'invalid_code' });
    expect(loginCodeModel.countWrongTry).toHaveBeenCalled();
  });

  it('refuses an expired code, a used-up one, and when none was sent, the same way', async () => {
    loginCodeModel.find.mockResolvedValueOnce(savedRow('123456', { expires_at: inMinutes(-1) }));
    await expect(authService.verifyEmailCode({ email: 'mariam@x.co', code: '123456' })).rejects.toMatchObject({ code: 'invalid_code' });

    loginCodeModel.find.mockResolvedValueOnce(null);
    await expect(authService.verifyEmailCode({ email: 'mariam@x.co', code: '123456' })).rejects.toMatchObject({ code: 'invalid_code' });

    loginCodeModel.find.mockResolvedValueOnce(savedRow('123456', { attempts: 5 }));
    await expect(authService.verifyEmailCode({ email: 'mariam@x.co', code: '123456' })).rejects.toMatchObject({ code: 'invalid_code' });
    expect(loginCodeModel.remove).toHaveBeenCalled();
  });

  it('lets a code work only once when two requests race', async () => {
    loginCodeModel.find.mockResolvedValue(savedRow('123456'));
    loginCodeModel.consume.mockResolvedValue(null);

    await expect(authService.verifyEmailCode({ email: 'mariam@x.co', code: '123456' })).rejects.toMatchObject({ code: 'invalid_code' });
  });
});

describe('phone + full name + date of birth', () => {
  const login = (extra = {}) => authService.phoneLogin({ phone: '+201000000001', full_name: 'مريم حسن', date_of_birth: '1995-03-02', ...extra }, { visitor: '1.1.1.1' });

  it('signs in, however the name is typed', async () => {
    patientModel.findForPhoneLogin.mockResolvedValue({ ...mariam, full_name: 'أحمد إبراهيم' });

    expect(await login({ full_name: '  احمد   ابراهيم ' })).toMatchObject({ method: 'phone', profile: { role: 'patient' } });
  });

  it('makes an account for a patient who had none', async () => {
    patientModel.findForPhoneLogin.mockResolvedValue({ ...mariam, profile_id: null });

    expect((await login()).profile.id).toBe('profile-new');
  });

  it('clears earlier wrong tries on success', async () => {
    patientModel.findForPhoneLogin.mockResolvedValue({ ...mariam, login_failed_attempts: 3 });

    await login();

    expect(patientModel.unlockLogin).toHaveBeenCalledWith({}, 'pat-1');
  });

  it('refuses wrong details and counts them', async () => {
    patientModel.findForPhoneLogin.mockResolvedValue(mariam);

    await expect(login({ date_of_birth: '1999-09-09' })).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(patientModel.recordWrongPhoneLogin).toHaveBeenCalledWith({}, mariam, { login_failed_attempts: 1 });
    expect(attempts.recordFailure).toHaveBeenCalledWith('phone', '1.1.1.1');
  });

  it('locks the record for 15 minutes on the 5th wrong try', async () => {
    patientModel.findForPhoneLogin.mockResolvedValue({ ...mariam, login_failed_attempts: 4 });

    await expect(login({ full_name: 'Someone Else' })).rejects.toMatchObject({ code: 'invalid_credentials' });

    expect(patientModel.recordWrongPhoneLogin.mock.calls[0][2]).toEqual({ login_failed_attempts: 0, login_locked_until: expect.any(String) });
  });

  it('refuses a locked record, even with the right details', async () => {
    const until = inMinutes(10);
    patientModel.findForPhoneLogin.mockResolvedValue({ ...mariam, login_locked_until: until });

    await expect(login()).rejects.toMatchObject({ status: 423, code: 'account_locked', details: { locked_until: until } });
  });

  it('gives an unknown phone the same answer as wrong details', async () => {
    patientModel.findForPhoneLogin.mockResolvedValue(null);

    await expect(login()).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(attempts.recordFailure).toHaveBeenCalled();
  });

  it('stops a visitor who used up their tries', async () => {
    attempts.assertAllowed.mockImplementation(() => {
      throw Object.assign(new Error('x'), { status: 429 });
    });

    await expect(login()).rejects.toMatchObject({ status: 429 });
    expect(patientModel.findForPhoneLogin).not.toHaveBeenCalled();
  });
});

describe('personal code', () => {
  it('signs in with a known code', async () => {
    personalCodeService.findPatientByCode.mockResolvedValue(mariam);

    expect(await authService.codeLogin({ code: 'K7Q4-9M2X' }, { visitor: '1.1.1.1' })).toMatchObject({ method: 'personal_code', profile: { role: 'patient' } });
  });

  it('refuses an unknown code and counts the failure', async () => {
    personalCodeService.findPatientByCode.mockResolvedValue(null);

    await expect(authService.codeLogin({ code: 'AAAA-AAAA' }, { visitor: '1.1.1.1' })).rejects.toMatchObject({ status: 401, code: 'invalid_code' });
    expect(attempts.recordFailure).toHaveBeenCalledWith('personal_code', '1.1.1.1');
  });

  it('emails the current code in the patient’s language, and answers the same for anyone', async () => {
    patientModel.findByEmail.mockResolvedValueOnce(mariam);
    const known = await authService.resendCode({ email: 'mariam@x.co' });
    expect(sent[0]).toMatchObject({ template: 'login_code', language: 'ar', data: { personalCode: 'K7Q4-9M2X', replaced: false } });

    sent.length = 0;
    patientModel.findByEmail.mockResolvedValueOnce(null);
    expect(await authService.resendCode({ email: 'nobody@x.co' })).toEqual(known);
    expect(sent).toEqual([]);
  });
});
