import { unwrap } from './query.js';

/** Logins (one profile per Supabase Auth user) and their roles. */

const PROFILE_COLUMNS = 'id, role, full_name, email, phone, preferred_language, created_at';

/**
 * Everything authenticate() needs about the caller, read AS the caller: the profile
 * (role), plus the linked patient record or staff record if there is one.
 */
export async function findIdentity(db, userId) {
  const [profile, patient, staff] = await Promise.all([
    unwrap(db.from('profiles').select('id, role, full_name, email, preferred_language').eq('id', userId).maybeSingle()),
    unwrap(db.from('patients').select('id').eq('profile_id', userId).maybeSingle()),
    unwrap(db.from('staff').select('id').eq('profile_id', userId).maybeSingle()),
  ]);
  if (!profile) return null;

  return {
    id: profile.id,
    role: profile.role,
    email: profile.email,
    fullName: profile.full_name,
    preferredLanguage: profile.preferred_language,
    patientId: patient?.id ?? null,
    staffId: staff?.id ?? null,
  };
}

export function findById(db, id) {
  return unwrap(db.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle());
}

export function findByEmail(db, email) {
  return unwrap(db.from('profiles').select(PROFILE_COLUMNS).eq('email', email).maybeSingle());
}

/** Team members (everyone who isn't a patient). Masked for the viewer by the view. */
export function listTeam(db) {
  return unwrap(
    db
      .from('v_profiles')
      .select('id, role, full_name, email, phone, preferred_language, created_at')
      .in('role', ['owner', 'staff', 'viewer'])
      .order('created_at'),
  );
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
