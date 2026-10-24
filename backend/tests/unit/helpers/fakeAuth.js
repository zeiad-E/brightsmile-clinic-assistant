/**
 * Fake sign-in for route tests: the token IS the role.
 * `Authorization: Bearer patient.x.y` signs you in as a patient, `owner.x.y` as the owner…
 * (three dot-separated parts, like a real JWT). No database or Supabase involved.
 */
export const ROLE_IDS = {
  patient: '00000000-0000-4000-a000-0000000000a4',
  staff: '00000000-0000-4000-a000-0000000000a2',
  owner: '00000000-0000-4000-a000-0000000000a1',
  viewer: '00000000-0000-4000-a000-0000000000a3',
};

export const tokenFor = (role) => `${role}.fake.token`;

export function fakeIdentity(role) {
  return {
    id: ROLE_IDS[role],
    role,
    email: `${role}@test.local`,
    fullName: `Test ${role}`,
    preferredLanguage: 'en',
    patientId: role === 'patient' ? '00000000-0000-4000-a000-0000000000f1' : null,
    staffId: role === 'owner' ? '00000000-0000-4000-a000-0000000000b1' : null,
  };
}

/** Use inside vi.mock factories for the two modules authenticate() depends on. */
export const fakeUserClientModule = () => ({
  createUserClient: (token) => ({ fakeDbFor: token }),
  createAuthClient: () => ({}),
  anonClient: () => ({
    fakeDbFor: 'anon',
    auth: {
      getClaims: async (token) => {
        const role = token.split('.')[0];
        return ROLE_IDS[role] ? { data: { claims: { sub: ROLE_IDS[role] } }, error: null } : { data: null, error: new Error('bad') };
      },
    },
  }),
});
