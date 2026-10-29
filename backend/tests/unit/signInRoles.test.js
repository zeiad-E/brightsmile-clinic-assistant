import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Patient sign-in can NEVER open a clinic team account.
 *
 * Found by Zeiad (2026-10-29): on the Patient tab he typed his own email, which is the owner's
 * login, got an emailed code, and landed on the owner dashboard. An emailed code proves you can
 * read the inbox, not that you know the password, so team accounts must not accept one.
 * These tests replay that case at every door: sending the code, checking it, the one place that
 * makes server sessions, and the chat's sign-in tool.
 */

const authClient = { auth: { signInWithOtp: vi.fn(), verifyOtp: vi.fn() } };
const admin = { auth: { admin: { generateLink: vi.fn(), signOut: vi.fn(async () => ({ error: null })) } } };
const profiles = {
  'owner@clinic.test': { id: 'u-owner', role: 'owner' },
  'staff@clinic.test': { id: 'u-staff', role: 'staff' },
  'mariam@mail.test': { id: 'u-patient', role: 'patient' },
};
const byId = Object.fromEntries(Object.values(profiles).map((p) => [p.id, p]));

vi.mock('../../src/db/supabase.js', () => ({ requireAdmin: () => admin, adminAs: () => admin }));
vi.mock('../../src/db/userClient.js', () => ({ createAuthClient: () => authClient, createUserClient: vi.fn(), anonClient: vi.fn() }));
vi.mock('../../src/models/profileModel.js', () => ({
  findByEmail: vi.fn(async (_db, email) => profiles[email] ?? null),
  findById: vi.fn(async (_db, id) => byId[id] ?? null),
  findIdentity: vi.fn(),
}));

const authService = await import('../../src/services/authService.js');
const sessionService = await import('../../src/services/sessionService.js');
const { verifyEmailCode: verifyEmailCodeTool } = await import('../../src/agent/tools/accountTools.js');

const sessionFor = (id) => ({ data: { session: { access_token: `tok-${id}`, refresh_token: 'r', expires_in: 3600, expires_at: 1 }, user: { id, email: 'x' } }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  authClient.auth.signInWithOtp.mockResolvedValue({ error: null });
});

describe('sending an email code (patient sign-in, step 1)', () => {
  it('sends nothing to the owner or staff, but answers exactly the same', async () => {
    const owner = await authService.startEmailCode({ email: 'owner@clinic.test' });
    const staff = await authService.startEmailCode({ email: 'staff@clinic.test' });
    const patient = await authService.startEmailCode({ email: 'mariam@mail.test' });
    expect(owner).toEqual(patient);
    expect(staff).toEqual(patient);
    expect(authClient.auth.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(authClient.auth.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ email: 'mariam@mail.test' }));
  });

  it('sends nothing for an unknown email either', async () => {
    await authService.startEmailCode({ email: 'nobody@mail.test' });
    expect(authClient.auth.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe('checking an email code (patient sign-in, step 2)', () => {
  it("turns the owner away even with a correct code, and closes the session it just made", async () => {
    authClient.auth.verifyOtp.mockResolvedValueOnce(sessionFor('u-owner'));
    await expect(authService.verifyEmailCode({ email: 'owner@clinic.test', code: '123456' })).rejects.toMatchObject({
      status: 403,
      code: 'team_account',
    });
    expect(admin.auth.admin.signOut).toHaveBeenCalledWith('tok-u-owner', 'local');
  });

  it('signs a patient in, as a patient', async () => {
    authClient.auth.verifyOtp.mockResolvedValueOnce(sessionFor('u-patient'));
    const result = await authService.verifyEmailCode({ email: 'mariam@mail.test', code: '123456' });
    expect(result.user.role).toBe('patient');
    expect(admin.auth.admin.signOut).not.toHaveBeenCalled();
  });
});

describe('the one place the server makes sessions (phone, personal code, booking)', () => {
  it('refuses a team login before asking Supabase for anything', async () => {
    await expect(sessionService.mintSession('owner@clinic.test')).rejects.toMatchObject({ status: 403, code: 'login_unavailable' });
    await expect(sessionService.mintSession('staff@clinic.test')).rejects.toMatchObject({ code: 'login_unavailable' });
    await expect(sessionService.mintSession('nobody@mail.test')).rejects.toMatchObject({ code: 'login_unavailable' });
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled();
  });

  it('still works for a patient', async () => {
    admin.auth.admin.generateLink.mockResolvedValueOnce({ data: { properties: { hashed_token: 'h' } }, error: null });
    authClient.auth.verifyOtp.mockResolvedValueOnce(sessionFor('u-patient'));
    const session = await sessionService.mintSession('mariam@mail.test');
    expect(session.access_token).toBe('tok-u-patient');
  });
});

describe("the chat's sign-in tool", () => {
  it('reports "not available" when the chat refuses a non-patient login', async () => {
    authClient.auth.verifyOtp.mockResolvedValueOnce(sessionFor('u-patient'));
    const ctx = { isPatient: false, state: { emailForCode: 'mariam@mail.test' }, signedIn: vi.fn(async () => null) };
    const result = await verifyEmailCodeTool.run({ code: '123456' }, ctx);
    expect(result).toMatchObject({ error: 'login_unavailable' });
  });

  it('a team email code is refused before the chat is even asked', async () => {
    authClient.auth.verifyOtp.mockResolvedValueOnce(sessionFor('u-owner'));
    const ctx = { isPatient: false, state: { emailForCode: 'owner@clinic.test' }, signedIn: vi.fn() };
    const result = await verifyEmailCodeTool.run({ code: '123456' }, ctx);
    expect(result.error).toBe('team_account');
    expect(ctx.signedIn).not.toHaveBeenCalled();
  });
});
