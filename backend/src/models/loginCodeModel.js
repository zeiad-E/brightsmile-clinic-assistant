import { unwrap } from './query.js';

/** The 6-digit codes we email: one live code per purpose and email, stored only as a fingerprint. */

export function find(db, purpose, email) {
  return unwrap(db.from('login_codes').select('*').eq('purpose', purpose).eq('email', email).maybeSingle());
}

/** A new code replaces the old one and starts its tries again. */
export function save(db, row) {
  return unwrap(db.from('login_codes').upsert({ ...row, attempts: 0 }, { onConflict: 'purpose,email' }));
}

/** Counts a wrong try, only from the number we read, so two guesses at once can't share one. */
export function countWrongTry(db, row) {
  return unwrap(
    db.from('login_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id).eq('attempts', row.attempts).select('id').maybeSingle(),
  );
}

/** Uses the code up. Returns null if another request got there first, so a code works only once. */
export function consume(db, row) {
  return unwrap(db.from('login_codes').delete().eq('id', row.id).eq('attempts', row.attempts).select('id').maybeSingle());
}

export function remove(db, id) {
  return unwrap(db.from('login_codes').delete().eq('id', id));
}

export async function deleteExpired(db, { now = new Date() } = {}) {
  const rows = await unwrap(db.from('login_codes').delete().lt('expires_at', now.toISOString()).select('id'));
  return rows.length;
}
