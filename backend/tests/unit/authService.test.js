import { beforeEach, describe, expect, it, vi } from 'vitest';

const authClient = {
  auth: { signInWithPassword: vi.fn(), signInWithOtp: vi.fn(), verifyOtp: vi.fn() },
};

vi.mock('../../src/db/supabase.js', () => ({ requireAdmin: () => ({ admin: true }) }));
vi.mock('../../src/db/userClient.js', () => ({ createAuthClient: () => authClient }));
vi.mock('../../src/models/patientModel.js', () => ({ verifyByPhone: vi.fn(), findById: vi.fn(), findByEmail: vi.fn() }));
vi.mock('../../src/models/profileModel.js', () => ({ findById: vi.fn(async () => ({ role: 'staff' })), findByEmail: vi.fn(async () => ({ role: 'patient' })) }));
vi.mock('../../src/models/staffModel.js', () => ({ findById: vi.fn() }));
vi.mock('../../src/services/sessionService.js', () => ({
  mintSession: vi.fn(async () => ({ access_token: 'minted', refresh_token: 'r', expires_in: 3600, expires_at: 1 })),
}));
vi.mock('../../src/services/accountService.js', () => ({
  ensurePatientLogin: vi.fn(async () => ({ profileId: 'user-1', email: 'p@x.com' })),
  changePassword: vi.fn(),
}));
vi.mock('../../src/services/personalCodeService.js', () => ({ findPatientByCode: vi.fn(), issueCode: vi.fn(async () => 'NEW1-CODE') }));
vi.mock('../../src/services/catalogService.js', () => ({ clinicBranding: vi.fn(async () => ({})), clinicNameIn: () => 'Clinic' }));
vi.mock('../../src/services/email/emailService.js', async () => {
  const actual = await vi.importActual('../../src/services/email/emailService.js');
  return { isPlaceholderEmail: actual.isPlaceholderEmail, sendEmailInBackground: vi.fn() };
});

const patientModel = await import('../../src/models/patientModel.js');
const personalCodeService = await import('../../src/services/personalCodeService.js');
const emailService = await import('../../src/services/email/emailService.js');
const accountService = await import('../../src/services/accountService.js');
const authService = await import('../../src/services/authService.js');

beforeEach(() => {
  vi.clearAllMocks();
  patientModel.findById.mockResolvedValue({ id: 'pat-1', email: 'p@x.com', preferred_language: 'en' });
});

describe('phone sign-in', () => {
  const body = { phone: '+201001234567', full_name: 'Ahmed Ali', date_of_birth: '1990-01-01' };

  it('signs in when the details match', async () => {
    patientModel.verifyByPhone.mockResolvedValue({ ok: true, patient_id: 'pat-1' });

    const session = await authService.phoneLogin(body);

    expect(session.access_token).toBe('minted');
    expect(session.user.role).toBe('patient');
  });

  it('says "locked" (423) with the unlock time after too many tries', async () => {
    patientModel.verifyByPhone.mockResolvedValue({ ok: false, error: 'locked', locked_until: '2026-10-25T10:15:00Z' });

    await expect(authService.phoneLogin(body)).rejects.toMatchObject({
      status: 423,
      code: 'account_locked',
      details: { locked_until: '2026-10-25T10:15:00Z' },
    });
  });

  it('gives one generic answer for wrong details', async () => {
    patientModel.verifyByPhone.mockResolvedValue({ ok: false, error: 'invalid_credentials' });

    await expect(authService.phoneLogin(body)).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
  });

  it('refuses when no login can be linked (e.g. the email belongs to a team member)', async () => {
    patientModel.verifyByPhone.mockResolvedValue({ ok: true, patient_id: 'pat-1' });
    accountService.ensurePatientLogin.mockResolvedValueOnce(null);

    await expect(authService.phoneLogin(body)).rejects.toMatchObject({ status: 403, code: 'login_unavailable' });
  });
});

describe('personal code sign-in', () => {
  it('refuses an unknown code', async () => {
    personalCodeService.findPatientByCode.mockResolvedValue(null);
    await expect(authService.codeLogin({ code: 'AAAA-BBBB' })).rejects.toMatchObject({ status: 401, code: 'invalid_code' });
  });

  it('signs in with a known code', async () => {
    personalCodeService.findPatientByCode.mockResolvedValue({ patientId: 'pat-1' });
    expect((await authService.codeLogin({ code: 'AAAA-BBBB' })).access_token).toBe('minted');
  });
});

describe('privacy: the same answer whether or not an email is registered', () => {
  it('email code: same answer even when Supabase refuses (unknown email)', async () => {
    authClient.auth.signInWithOtp.mockResolvedValue({ error: { code: 'otp_disabled', message: 'Signups not allowed' } });

    expect(await authService.startEmailCode({ email: 'nobody@x.com' })).toMatchObject({ sent: true });
  });

  it('never sends a code to an internal placeholder address', async () => {
    await authService.startEmailCode({ email: 'patient-1@patients.brightsmile.app' });
    expect(authClient.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('resend code: same answer for an unknown email, and nothing is sent', async () => {
    patientModel.findByEmail.mockResolvedValue(null);

    expect(await authService.resendCode({ email: 'nobody@x.com' })).toMatchObject({ sent: true });
    expect(personalCodeService.issueCode).not.toHaveBeenCalled();
  });

  it('resend code: a known patient gets a fresh code by email', async () => {
    patientModel.findByEmail.mockResolvedValue({ id: 'pat-1', email: 'p@x.com', preferred_language: 'ar' });

    await authService.resendCode({ email: 'p@x.com' });

    expect(emailService.sendEmailInBackground).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'login_code', language: 'ar', data: expect.objectContaining({ personalCode: 'NEW1-CODE' }) }),
    );
  });
});

describe('team sign-in', () => {
  it('says "disabled" for a banned account', async () => {
    authClient.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'user_banned' } });
    await expect(authService.staffLogin({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({ status: 403, code: 'account_disabled' });
  });

  it('gives one generic answer for a wrong email or password', async () => {
    authClient.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials' } });
    await expect(authService.staffLogin({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({ status: 401 });
  });

  it('requires the current password before changing it', async () => {
    authClient.auth.signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials' } });

    await expect(
      authService.changePassword({ user: { id: 'u', email: 'a@b.co' } }, { current_password: 'wrong', new_password: 'a-new-password' }),
    ).rejects.toMatchObject({ status: 401, code: 'wrong_password' });
    expect(accountService.changePassword).not.toHaveBeenCalled();
  });
});
