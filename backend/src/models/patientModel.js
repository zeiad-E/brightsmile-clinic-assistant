import { pageRange, searchTerm, unwrap, unwrapPage } from './query.js';

/**
 * Patient records.
 *
 * Columns are always listed by name: logged-in users are not allowed to read the
 * sign-in secrets (code_hmac, lockout counters), so `select('*')` would be refused.
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

/** Staff search by name, email or phone (masked for the viewer by v_patients). */
export function search(db, { q, limit, offset }) {
  let query = db
    .from('v_patients')
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
      .from('v_patients')
      .select('id, profile_id, full_name, date_of_birth, email, phone, preferred_language, notes, created_at')
      .eq('id', id)
      .maybeSingle(),
  );
}

export function update(db, id, patch) {
  return unwrap(db.from('patients').update(patch).eq('id', id).select(COLUMNS).maybeSingle());
}

/**
 * Links a login to the patient — only if no login is linked yet. If two requests race,
 * exactly one wins; the other gets null and re-reads the winner's link.
 */
export function linkProfile(db, patientId, profileId) {
  return unwrap(
    db
      .from('patients')
      .update({ profile_id: profileId })
      .eq('id', patientId)
      .is('profile_id', null)
      .select(COLUMNS)
      .maybeSingle(),
  );
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

export function setCodeHmac(db, id, codeHmac) {
  return unwrap(db.from('patients').update({ code_hmac: codeHmac }).eq('id', id).select('id').maybeSingle());
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

/** verify_patient_by_phone → { ok, patient_id, profile_id } | { ok:false, error, locked_until? } */
export function verifyByPhone(db, { phone, fullName, dateOfBirth }) {
  return unwrap(
    db.rpc('verify_patient_by_phone', { p_phone: phone, p_full_name: fullName, p_date_of_birth: dateOfBirth }),
  );
}

/** find_patient_by_code → { ok, patient_id, profile_id } | { ok:false, error } */
export function findByCodeHmac(db, codeHmac) {
  return unwrap(db.rpc('find_patient_by_code', { p_code_hmac: codeHmac }));
}

/** id → name for list screens (masked for the viewer by v_patients). */
export async function namesByIds(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await unwrap(db.from('v_patients').select('id, full_name').in('id', unique));
  return new Map(rows.map((row) => [row.id, row.full_name]));
}
