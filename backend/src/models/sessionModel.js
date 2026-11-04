import { unwrap } from './query.js';

/** Signed-in devices. One row per session; only fingerprints of its refresh token are stored. */

const IDENTITY_COLUMNS = `id, profile_id, expires_at, revoked_at,
  profile:profile_id(id, role, full_name, email, preferred_language, disabled_at, must_change_password,
    patients(id, email, full_name, preferred_language), staff(id))`;

export function insert(db, row) {
  return unwrap(db.from('auth_sessions').insert(row).select('id').single());
}

export function findById(db, id) {
  return unwrap(db.from('auth_sessions').select('*, profile:profile_id(id, role, full_name, must_change_password)').eq('id', id).maybeSingle());
}

/** One query for everything a request needs: the session, the login, its patient or staff record. */
export function findWithIdentity(db, id) {
  return unwrap(db.from('auth_sessions').select(IDENTITY_COLUMNS).eq('id', id).maybeSingle());
}

/**
 * Swaps the refresh token, only if it is still the one we read. When two requests race, exactly
 * one matches; the other updates nothing and gets null.
 */
export function rotate(db, session, newHash, now) {
  return unwrap(
    db
      .from('auth_sessions')
      .update({ refresh_hash: newHash, previous_hash: session.refresh_hash, rotated_at: now, last_used_at: now, redeem_by: null })
      .eq('id', session.id)
      .eq('refresh_hash', session.refresh_hash)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle(),
  );
}

export function revoke(db, id, reason) {
  return unwrap(
    db.from('auth_sessions').update({ revoked_at: new Date().toISOString(), revoke_reason: reason }).eq('id', id).is('revoked_at', null),
  );
}

export function revokeAllFor(db, profileId, reason, { exceptId = null } = {}) {
  let query = db
    .from('auth_sessions')
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
    .eq('profile_id', profileId)
    .is('revoked_at', null);
  if (exceptId) query = query.neq('id', exceptId);
  return unwrap(query);
}

/** For the nightly clean-up: sessions that ended a while ago are only clutter. */
export async function deleteEnded(db, { now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const rows = await unwrap(db.from('auth_sessions').delete().or(`expires_at.lt.${cutoff},revoked_at.lt.${cutoff}`).select('id'));
  return rows.length;
}
