import { pageRange, searchTerm, unwrap, unwrapPage, viewName } from './query.js';

/**
 * Patient records.
 *
 * Columns are always listed by name, so the sign-in secrets (code_hmac, lockout counters) can't
 * reach a view by accident.
 */
const COLUMNS = 'id, profile_id, full_name, date_of_birth, email, phone, preferred_language, notes, created_at, updated_at';

export function findById(db, id) {
  return unwrap(db.from('patients').select(COLUMNS).eq('id', id).maybeSingle());
}

export function findByProfileId(db, profileId) {
  return unwrap(db.from('patients').select(COLUMNS).eq('profile_id', profileId).maybeSingle());
}

export function findByPhone(db, phone) {
  return unwrap(db.from('patients').select(COLUMNS).eq('phone', phone).maybeSingle());
}

/** A new patient record (staff, G5). Unique email/phone clashes surface as error 23505. */
export function create(db, row) {
  return unwrap(db.from('patients').insert(row).select(COLUMNS).single());
}

export function findByEmail(db, email) {
  return unwrap(db.from('patients').select(COLUMNS).eq('email', email).maybeSingle());
}

/** Staff search by name, email or phone (the viewer searches the masked view). */
export function search(db, { q, limit, offset }) {
  let query = db
    .from(viewName(db, 'v_patients'))
    .select('id, profile_id, full_name, date_of_birth, email, phone, preferred_language, notes, created_at', {
      count: 'exact',
    })
    .order('full_name');
  const term = q ? searchTerm(q) : '';
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}

export function findInView(db, id) {
  return unwrap(
    db
      .from(viewName(db, 'v_patients'))
      .select('id, profile_id, full_name, date_of_birth, email, phone, preferred_language, notes, created_at')
      .eq('id', id)
      .maybeSingle(),
  );
}

export function update(db, id, patch) {
  return unwrap(db.from('patients').update(patch).eq('id', id).select(COLUMNS).maybeSingle());
}

/** Answers to the owner's intake questions (merged into what is already saved). */
export async function getIntake(db, id) {
  const row = await unwrap(db.from('patients').select('intake').eq('id', id).maybeSingle());
  return row?.intake ?? {};
}

export function setIntake(db, id, intake) {
  return unwrap(db.from('patients').update({ intake }).eq('id', id).select('id, intake').maybeSingle());
}

// ----- sign-in secrets: service role only -----

export function setCode(db, id, patch) {
  return unwrap(db.from('patients').update(patch).eq('id', id).select('id').maybeSingle());
}

export function findCode(db, id) {
  return unwrap(db.from('patients').select('code_hmac, code_ciphertext, code_key_id, code_issued_at').eq('id', id).maybeSingle());
}

/** The patient a code's fingerprint belongs to, or null. */
export function findByCodeHmac(db, codeHmac) {
  return unwrap(db.from('patients').select(COLUMNS).eq('code_hmac', codeHmac).maybeSingle());
}

/** The patient behind a phone number, with the fields phone sign-in checks and counts. */
export function findForPhoneLogin(db, phone) {
  return unwrap(db.from('patients').select(`${COLUMNS}, login_failed_attempts, login_locked_until`).eq('phone', phone).maybeSingle());
}

/** Counts a wrong try, only from the number we read, so guesses at once can't share one. */
export function recordWrongPhoneLogin(db, patient, patch) {
  return unwrap(db.from('patients').update(patch).eq('id', patient.id).eq('login_failed_attempts', patient.login_failed_attempts));
}

export function unlockLogin(db, id) {
  return unwrap(
    db
      .from('patients')
      .update({ login_failed_attempts: 0, login_locked_until: null })
      .eq('id', id)
      .select('id')
      .maybeSingle(),
  );
}

export function loginStatus(db, id) {
  return unwrap(
    db.from('patients').select('id, code_hmac, login_locked_until').eq('id', id).maybeSingle(),
  ).then((row) => row && { id: row.id, hasCode: Boolean(row.code_hmac), lockedUntil: row.login_locked_until });
}

/** id → name for list screens (the viewer reads the masked view). */
export async function namesByIds(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await unwrap(db.from(viewName(db, 'v_patients')).select('id, full_name').in('id', unique));
  return new Map(rows.map((row) => [row.id, row.full_name]));
}
