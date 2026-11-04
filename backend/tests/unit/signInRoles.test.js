import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Only a password can open a team account. Email codes, phone, personal codes, the chat and
 * bookings look at patient records alone, so a team member's email reaches nothing there. And if
 * something ever did slip through, auth/sessions.js refuses it (tested in auth/sessions.test.js).
 */
const sent = [];

vi.mock('../../src/db/supabase.js', () => ({ requireAdmin: () => ({}), adminAs: () => ({}), dbFor: () => ({}), publicDb: () => ({}) }));
vi.mock('../../src/models/patientModel.js', () => ({ findByEmail: vi.fn(async () => null), findForPhoneLogin: vi.fn() }));
vi.mock('../../src/models/profileModel.js', () => ({ findTeamLogin: vi.fn(), updateLogin: vi.fn(), findIdentity: vi.fn() }));
vi.mock('../../src/models/loginCodeModel.js', () => ({ find: vi.fn(async () => null), save: vi.fn() }));
vi.mock('../../src/services/catalogService.js', () => ({ clinicBranding: vi.fn(async () => ({})), clinicNameIn: () => 'BrightSmile' }));
vi.mock('../../src/services/email/emailService.js', () => ({ sendEmailInBackground: vi.fn((mail) => sent.push(mail)) }));
vi.mock('../../src/services/accountService.js', () => ({ ensurePatientAccount: vi.fn() }));
vi.mock('../../src/services/personalCodeService.js', () => ({ findPatientByCode: vi.fn() }));

const authService = await import('../../src/services/authService.js');
const patientModel = await import('../../src/models/patientModel.js');
const profileModel = await import('../../src/models/profileModel.js');
const { signInWithCode } = await import('../../src/agent/tools/accountTools.js');
const personalCodeService = await import('../../src/services/personalCodeService.js');

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
});

describe('patient sign-in can’t reach a team account', () => {
  it('sends no code to an email that is only on a team account', async () => {
    profileModel.findTeamLogin.mockResolvedValue({ id: 'owner', role: 'owner' });

    await authService.startEmailCode({ email: 'owner@clinic.test' });

    expect(sent).toEqual([]);
    expect(profileModel.findTeamLogin).not.toHaveBeenCalled();
  });

  it('refuses the demo button unless the account really is a viewer', async () => {
    const { config } = await import('../../src/config/index.js');
    config.auth.demoViewerEmail = 'demo@clinic.test';
    profileModel.findTeamLogin.mockResolvedValue({ id: 'owner', role: 'owner' });

    await expect(authService.demoLogin()).rejects.toMatchObject({ status: 404, code: 'demo_unavailable' });

    config.auth.demoViewerEmail = '';
    await expect(authService.demoLogin()).rejects.toMatchObject({ status: 404 });
  });

  it('never gives the password route to a patient', async () => {
    profileModel.findTeamLogin.mockResolvedValue(null); // only team accounts are looked up there

    await expect(authService.staffLogin({ email: 'mariam@mail.test', password: 'whatever-it-is' })).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(patientModel.findByEmail).not.toHaveBeenCalled();
  });
});

describe('the assistant’s sign-in tools', () => {
  const chat = (signIn) => ({ isPatient: false, state: {}, visitor: '1.1.1.1', signIn });

  it('report "not available" when the sign-in is refused', async () => {
    personalCodeService.findPatientByCode.mockResolvedValue({ id: 'pat-1', profile_id: 'p' });
    const accountService = await import('../../src/services/accountService.js');
    accountService.ensurePatientAccount.mockResolvedValue({ id: 'p', role: 'patient' });

    expect(await signInWithCode.run({ code: 'K7Q4-9M2X' }, chat(async () => null))).toMatchObject({ error: 'login_unavailable' });
  });

  it('tell the AI only the first name, never anything that signs in', async () => {
    personalCodeService.findPatientByCode.mockResolvedValue({ id: 'pat-1', profile_id: 'p' });
    const accountService = await import('../../src/services/accountService.js');
    accountService.ensurePatientAccount.mockResolvedValue({ id: 'p', role: 'patient' });

    const result = await signInWithCode.run({ code: 'K7Q4-9M2X' }, chat(async () => ({ fullName: 'Mariam Hassan' })));

    expect(result).toEqual({ signed_in: true, first_name: 'Mariam' });
  });

  it('count a failed code as a wrong try', async () => {
    personalCodeService.findPatientByCode.mockResolvedValue(null);
    const ctx = chat(vi.fn());

    expect(await signInWithCode.run({ code: 'AAAA-AAAA' }, ctx)).toMatchObject({ error: 'invalid_code', attempts_left: 4 });
    expect(ctx.signIn).not.toHaveBeenCalled();
  });

  it('share the website’s limits, so a new chat gives no fresh tries', async () => {
    const { attempts } = await import('../../src/auth/attemptLimiter.js');
    personalCodeService.findPatientByCode.mockResolvedValue(null);
    for (let i = 0; i < 5; i += 1) attempts.recordFailure('personal_code', '2.2.2.2');

    const result = await signInWithCode.run({ code: 'AAAA-AAAA' }, { ...chat(vi.fn()), visitor: '2.2.2.2' });

    expect(result).toMatchObject({ error: 'too_many_attempts' });
    expect(personalCodeService.findPatientByCode).not.toHaveBeenCalled();
  });
});
