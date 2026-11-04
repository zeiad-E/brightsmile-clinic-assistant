import { unwrap, viewName } from './query.js';

/** Accounts and their roles. Passwords and lockouts are read only by the sign-in code. */

const PROFILE_COLUMNS = 'id, role, full_name, email, phone, preferred_language, must_change_password, disabled_at, last_sign_in_at, created_at';
const LOGIN_COLUMNS = `${PROFILE_COLUMNS}, password_hash, failed_login_attempts, locked_until`;
const TEAM_ROLES = ['owner', 'staff', 'viewer'];

/** Everything authenticate() needs about the caller: the profile (role), plus the linked patient or staff record. */
export async function findIdentity(db, userId) {
  const [profile, patient, staff] = await Promise.all([
    unwrap(db.from('profiles').select('id, role, full_name, email, preferred_language').eq('id', userId).maybeSingle()),
    unwrap(db.from('patients').select('id, email, full_name, preferred_language').eq('profile_id', userId).maybeSingle()),
    unwrap(db.from('staff').select('id').eq('profile_id', userId).maybeSingle()),
  ]);
  if (!profile) return null;

  return {
    id: profile.id,
    role: profile.role,
    email: patient?.email ?? profile.email,
    fullName: patient?.full_name ?? profile.full_name,
    preferredLanguage: patient?.preferred_language ?? profile.preferred_language,
    patientId: patient?.id ?? null,
    staffId: staff?.id ?? null,
  };
}

export function findById(db, id) {
  return unwrap(db.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle());
}

export function findByEmail(db, email) {
  return unwrap(db.from('profiles').select(PROFILE_COLUMNS).eq('email', email).in('role', TEAM_ROLES).maybeSingle());
}

/** A team account with its password hash, for signing in. */
export function findTeamLogin(db, email) {
  return unwrap(db.from('profiles').select(LOGIN_COLUMNS).eq('email', email).in('role', TEAM_ROLES).maybeSingle());
}

export function findLogin(db, id) {
  return unwrap(db.from('profiles').select(LOGIN_COLUMNS).eq('id', id).maybeSingle());
}

/** Counts a wrong password, only from the number we read, so guesses at once can't share one. */
export function recordWrongPassword(db, profile, patch) {
  return unwrap(db.from('profiles').update(patch).eq('id', profile.id).eq('failed_login_attempts', profile.failed_login_attempts));
}

export function updateLogin(db, id, patch) {
  return unwrap(db.from('profiles').update(patch).eq('id', id));
}

/** A patient's account: their name is copied for screens; sign-in details stay on the patient. */
/** Returns null if a team account already uses this email. */
export async function createTeamProfile(db, row) {
  const { data, error } = await db.from('profiles').insert(row).select(PROFILE_COLUMNS).single();
  if (error?.code === '23505') return null;
  if (error) throw error;
  return data;
}

/** Team members (everyone who isn't a patient). The viewer reads the masked view. */
export function listTeam(db) {
  return unwrap(
    db
      .from(viewName(db, 'v_profiles'))
      .select('id, role, full_name, email, phone, preferred_language, must_change_password, disabled_at, last_sign_in_at, created_at')
      .in('role', TEAM_ROLES)
      .order('created_at'),
  );
}

/**
 * id → full name, for "who wrote this" labels. Dashboard callers pass `masked: true`, so the
 * viewer reads the masked view.
 */
export async function namesByIds(db, ids, { masked = false } = {}) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await unwrap(db.from(masked ? viewName(db, 'v_profiles') : 'profiles').select('id, full_name').in('id', unique));
  return new Map(rows.map((row) => [row.id, row.full_name]));
}

/** Name / phone / language of a login: the member themself (G6) or the owner (G7). */
export function updateDetails(db, id, patch) {
  return unwrap(db.from('profiles').update(patch).eq('id', id).select(PROFILE_COLUMNS).maybeSingle());
}

export function updateRole(db, id, role) {
  return unwrap(db.from('profiles').update({ role }).eq('id', id).select(PROFILE_COLUMNS).maybeSingle());
}

export function updateLanguage(db, id, preferredLanguage) {
  return unwrap(
    db
      .from('profiles')
      .update({ preferred_language: preferredLanguage })
      .eq('id', id)
      .select('id, preferred_language')
      .maybeSingle(),
  );
}
