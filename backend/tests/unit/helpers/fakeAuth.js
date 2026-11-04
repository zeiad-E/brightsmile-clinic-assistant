import { signAccessToken } from '../../../src/auth/tokens.js';

/**
 * Fake sign-in for route tests: real signed tokens, one per role, with the session store replaced
 * by `fakeSessionsModule`. No database involved.
 */
export const ROLE_IDS = {
  patient: '00000000-0000-4000-a000-0000000000a4',
  staff: '00000000-0000-4000-a000-0000000000a2',
  owner: '00000000-0000-4000-a000-0000000000a1',
  viewer: '00000000-0000-4000-a000-0000000000a3',
};

/** role → a valid access token for that role. */
export async function signedTokens() {
  const entries = await Promise.all(
    Object.keys(ROLE_IDS).map(async (role) => {
      const { token } = await signAccessToken({ sub: ROLE_IDS[role], sid: `session-${role}`, role });
      return [role, token];
    }),
  );
  return Object.fromEntries(entries);
}

export function fakeIdentity(role) {
  return {
    id: ROLE_IDS[role],
    role,
    sessionId: `session-${role}`,
    email: `${role}@test.local`,
    fullName: `Test ${role}`,
    preferredLanguage: 'en',
    patientId: role === 'patient' ? '00000000-0000-4000-a000-0000000000f1' : null,
    staffId: role === 'owner' ? '00000000-0000-4000-a000-0000000000b1' : null,
    mustChangePassword: false,
  };
}

/** Use inside vi.mock factories for the modules authenticate() depends on. */
export const fakeSupabaseModule = () => ({
  supabaseAdmin: null,
  serverClientOptions: {},
  requireAdmin: () => ({ fakeDbFor: 'admin' }),
  adminAs: () => ({ fakeDbFor: 'admin' }),
  dbFor: (user) => ({ fakeDbFor: user.role }),
  publicDb: () => ({ fakeDbFor: 'visitor' }),
});

export const fakeSessionsModule = () => ({
  identityFor: async (claims) => fakeIdentity(claims.role),
  issue: async () => ({ sessionId: 'session-new', refreshToken: 'session-new.secret', maxAgeMs: 60_000 }),
  rotate: async () => ({ sessionId: 'session-new', profile: { id: ROLE_IDS.patient, role: 'patient' }, refreshToken: 'session-new.secret', maxAgeMs: 60_000 }),
  revoke: async () => {},
  revokeByToken: async () => {},
  revokeAllFor: async () => {},
});
