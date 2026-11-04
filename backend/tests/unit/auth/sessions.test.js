import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Sessions, with the table kept in memory: rotation, stolen tokens, expiry, and who may sign in how. */
const rows = new Map();

vi.mock('../../../src/db/supabase.js', () => ({ requireAdmin: () => ({}) }));
vi.mock('../../../src/models/sessionModel.js', () => ({
  insert: vi.fn(async (_db, row) => {
    rows.set(row.id, { revoked_at: null, previous_hash: null, rotated_at: null, last_used_at: new Date().toISOString(), profile_id: row.profile_id, ...row });
    return { id: row.id };
  }),
  findById: vi.fn(async (_db, id) => {
    const row = rows.get(id);
    return row ? { ...row, profile: row.profile ?? { id: row.profile_id, role: 'patient' } } : null;
  }),
  findWithIdentity: vi.fn(async (_db, id) => rows.get(id) ?? null),
  rotate: vi.fn(async (_db, session, newHash, now) => {
    const row = rows.get(session.id);
    if (row.refresh_hash !== session.refresh_hash || row.revoked_at) return null;
    Object.assign(row, { previous_hash: row.refresh_hash, refresh_hash: newHash, rotated_at: now, last_used_at: now, redeem_by: null });
    return { id: row.id };
  }),
  revoke: vi.fn(async (_db, id, reason) => {
    Object.assign(rows.get(id), { revoked_at: new Date().toISOString(), revoke_reason: reason });
  }),
  revokeAllFor: vi.fn(),
}));

const sessions = await import('../../../src/auth/sessions.js');

const patient = { id: 'profile-1', role: 'patient', full_name: 'Mona' };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const start = (profile = patient, options = {}) => sessions.issue({ profile, method: profile.role === 'patient' ? 'phone' : 'password', ...options });
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const rowOf = (token) => rows.get(token.split('.')[0]);

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
});

describe('starting a session', () => {
  it('stores only a fingerprint of the token', async () => {
    const { refreshToken } = await start();
    const [id, secret] = refreshToken.split('.');

    expect(rows.get(id).refresh_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows.get(id))).not.toContain(secret);
  });

  it.each([
    ['patient', 30],
    ['staff', 7],
    ['owner', 7],
    ['viewer', 1],
  ])('keeps a %s signed in for at most %i day(s)', async (role, days) => {
    const { refreshToken } = await sessions.issue({ profile: { id: 'p', role }, method: role === 'patient' ? 'phone' : role === 'viewer' ? 'demo' : 'password' });
    const lasts = new Date(rowOf(refreshToken).expires_at) - Date.now();

    expect(Math.round(lasts / DAY)).toBe(days);
  });

  it('gives a chat ticket only 2 minutes to be used', async () => {
    const { refreshToken } = await start(patient, { ticket: true });
    const left = new Date(rowOf(refreshToken).redeem_by) - Date.now();

    expect(left).toBeGreaterThan(MINUTE);
    expect(left).toBeLessThanOrEqual(2 * MINUTE);
  });
});

describe('only the right way in opens an account', () => {
  it.each(['email_code', 'phone', 'personal_code', 'sign_up', 'booking'])('%s can never open a team account', async (method) => {
    for (const role of ['owner', 'staff', 'viewer']) {
      await expect(sessions.issue({ profile: { id: 'p', role }, method })).rejects.toMatchObject({ status: 403, code: 'login_unavailable' });
    }
    expect(rows.size).toBe(0);
  });

  it('a password can never open a patient account', async () => {
    await expect(sessions.issue({ profile: patient, method: 'password' })).rejects.toMatchObject({ code: 'login_unavailable' });
  });

  it('the demo button can only open a viewer', async () => {
    await expect(sessions.issue({ profile: { id: 'p', role: 'owner' }, method: 'demo' })).rejects.toMatchObject({ code: 'login_unavailable' });
    await expect(sessions.issue({ profile: { id: 'p', role: 'viewer' }, method: 'demo' })).resolves.toBeTruthy();
  });

  it('an unknown method opens nothing', async () => {
    await expect(sessions.issue({ profile: patient, method: 'magic' })).rejects.toMatchObject({ code: 'login_unavailable' });
  });
});

describe('refreshing', () => {
  it('swaps the token for a new one', async () => {
    const first = await start();
    const second = await sessions.rotate(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.sessionId).toBe(first.sessionId);
    await expect(sessions.rotate(second.refreshToken)).resolves.toBeTruthy();
  });

  it('asks a second tab to try again when both refresh at once, and ends nothing', async () => {
    const first = await start();
    await sessions.rotate(first.refreshToken);

    await expect(sessions.rotate(first.refreshToken)).rejects.toMatchObject({ code: 'refresh_superseded' });
    expect(rowOf(first.refreshToken).revoked_at).toBeNull();
  });

  it('ends the session when an old token turns up later: someone is replaying a stolen one', async () => {
    const first = await start();
    const second = await sessions.rotate(first.refreshToken);
    rowOf(first.refreshToken).rotated_at = ago(MINUTE);

    await expect(sessions.rotate(first.refreshToken)).rejects.toMatchObject({ code: 'invalid_refresh_token' });
    expect(rowOf(first.refreshToken).revoke_reason).toBe('refresh_reuse');
    await expect(sessions.rotate(second.refreshToken)).rejects.toMatchObject({ code: 'invalid_refresh_token' });
  });

  it('ends nothing for a made-up secret: knowing a session id must not let anyone sign someone out', async () => {
    const { sessionId, refreshToken } = await start();

    await expect(sessions.rotate(`${sessionId}.made-up-secret`)).rejects.toMatchObject({ code: 'invalid_refresh_token' });
    expect(rowOf(refreshToken).revoked_at).toBeNull();
    await expect(sessions.rotate(refreshToken)).resolves.toBeTruthy();
  });

  it.each([[null], [''], ['no-dot-here'], ['not-a-uuid.secret']])('refuses a malformed token: %s', async (token) => {
    await expect(sessions.rotate(token)).rejects.toMatchObject({ status: 401, code: 'invalid_refresh_token' });
  });

  it('ends a session left idle too long', async () => {
    const { refreshToken } = await start();
    rowOf(refreshToken).last_used_at = ago(8 * DAY);

    await expect(sessions.rotate(refreshToken)).rejects.toMatchObject({ code: 'invalid_refresh_token' });
    expect(rowOf(refreshToken).revoke_reason).toBe('expired');
  });

  it('ends a session past its final date, however active it is', async () => {
    const { refreshToken } = await start();
    rowOf(refreshToken).expires_at = ago(1);

    await expect(sessions.rotate(refreshToken)).rejects.toMatchObject({ code: 'invalid_refresh_token' });
  });

  it('refuses a ticket after its 2 minutes, and clears the deadline once swapped', async () => {
    const late = await start(patient, { ticket: true });
    rowOf(late.refreshToken).redeem_by = ago(1);
    await expect(sessions.rotate(late.refreshToken)).rejects.toMatchObject({ code: 'invalid_refresh_token' });

    const onTime = await start(patient, { ticket: true });
    await sessions.rotate(onTime.refreshToken);
    expect(rowOf(onTime.refreshToken).redeem_by).toBeNull();
  });

  it('refuses a session that was ended', async () => {
    const { sessionId, refreshToken } = await start();
    await sessions.revoke(sessionId, 'sign_out');

    await expect(sessions.rotate(refreshToken)).rejects.toMatchObject({ code: 'invalid_refresh_token' });
  });
});

describe('signing out with only the cookie', () => {
  it('ends the session when the token is genuine', async () => {
    const { refreshToken } = await start();
    await sessions.revokeByToken(refreshToken);

    expect(rowOf(refreshToken).revoke_reason).toBe('sign_out');
  });

  it('ignores a forged or missing token', async () => {
    const { sessionId, refreshToken } = await start();
    await sessions.revokeByToken(`${sessionId}.forged`);
    await sessions.revokeByToken(null);

    expect(rowOf(refreshToken).revoked_at).toBeNull();
  });
});

describe('the check on every request', () => {
  const claims = { sub: 'profile-1', sid: 'sid-1', role: 'staff' };
  const saved = (session = {}, profile = {}) =>
    rows.set('sid-1', {
      id: 'sid-1',
      revoked_at: null,
      expires_at: new Date(Date.now() + DAY).toISOString(),
      ...session,
      profile: { id: 'profile-1', role: 'staff', full_name: 'Sam', email: 's@x.co', preferred_language: 'en', disabled_at: null, must_change_password: false, patients: null, staff: [{ id: 'staff-1' }], ...profile },
    });

  it('returns who is calling, with the role from the database', async () => {
    saved();

    expect(await sessions.identityFor(claims)).toMatchObject({ id: 'profile-1', role: 'staff', sessionId: 'sid-1', staffId: 'staff-1', patientId: null, email: 's@x.co' });
  });

  it('takes a patient’s details from their patient record', async () => {
    saved({}, { role: 'patient', full_name: null, email: null, patients: { id: 'pat-1', email: 'm@x.co', full_name: 'Mona', preferred_language: 'ar' }, staff: null });

    expect(await sessions.identityFor({ ...claims, role: 'patient' })).toMatchObject({ patientId: 'pat-1', email: 'm@x.co', fullName: 'Mona', preferredLanguage: 'ar' });
  });

  it('refuses straight away after sign-out', async () => {
    saved({ revoked_at: ago(1) });
    await expect(sessions.identityFor(claims)).rejects.toMatchObject({ status: 401, code: 'invalid_token' });
  });

  it('refuses straight away after a role change', async () => {
    saved({}, { role: 'viewer' });
    await expect(sessions.identityFor(claims)).rejects.toMatchObject({ status: 401, code: 'invalid_token' });
  });

  it('refuses a disabled account', async () => {
    saved({}, { disabled_at: ago(1) });
    await expect(sessions.identityFor(claims)).rejects.toMatchObject({ status: 403, code: 'account_disabled' });
  });

  it('refuses a session past its date, one that is gone, or one that belongs to someone else', async () => {
    saved({ expires_at: ago(1) });
    await expect(sessions.identityFor(claims)).rejects.toMatchObject({ code: 'invalid_token' });

    await expect(sessions.identityFor({ ...claims, sid: 'gone' })).rejects.toMatchObject({ code: 'invalid_token' });

    saved();
    await expect(sessions.identityFor({ ...claims, sub: 'another-profile' })).rejects.toMatchObject({ code: 'invalid_token' });
  });
});
