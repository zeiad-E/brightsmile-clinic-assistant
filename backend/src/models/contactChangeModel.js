import { unwrap } from './query.js';

/** A patient's pending email / phone change, waiting for the code (G10). Backend only. */

const COLUMNS = 'id, patient_id, field, new_value, code_hmac, attempts, expires_at';

/** Starts (or restarts) the change: one pending change per field, a new code each time. */
export function upsert(db, { patientId, field, newValue, codeHmac, expiresAt }) {
  return unwrap(
    db
      .from('contact_changes')
      .upsert(
        { patient_id: patientId, field, new_value: newValue, code_hmac: codeHmac, attempts: 0, expires_at: expiresAt },
        { onConflict: 'patient_id,field' },
      )
      .select(COLUMNS)
      .single(),
  );
}

export function find(db, patientId, field) {
  return unwrap(db.from('contact_changes').select(COLUMNS).eq('patient_id', patientId).eq('field', field).maybeSingle());
}

export function countWrongTry(db, id, attempts) {
  return unwrap(db.from('contact_changes').update({ attempts }).eq('id', id));
}

export function remove(db, id) {
  return unwrap(db.from('contact_changes').delete().eq('id', id));
}
