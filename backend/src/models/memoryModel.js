import { pageRange, unwrap, unwrapPage } from './query.js';

/** The agent's notes about a patient (preferences, communication style, logistics). */

const COLUMNS = 'id, patient_id, kind, content, source, conversation_id, created_at, updated_at';

export function listForPatient(db, patientId, limit = 15) {
  return unwrap(
    db
      .from('patient_memories')
      .select(COLUMNS)
      .eq('patient_id', patientId)
      .order('updated_at', { ascending: false })
      .limit(limit),
  );
}

/** Owner screen: all notes, newest first, with the patient's name. */
export function listAll(db, { patientId, limit, offset }) {
  let query = db
    .from('patient_memories')
    .select(`${COLUMNS}, patient:patient_id(id, full_name)`, { count: 'exact' })
    .order('updated_at', { ascending: false });
  if (patientId) query = query.eq('patient_id', patientId);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}

export function insert(db, row) {
  return unwrap(db.from('patient_memories').insert(row).select(COLUMNS).single());
}

export function update(db, id, patch) {
  return unwrap(db.from('patient_memories').update(patch).eq('id', id).select(COLUMNS).maybeSingle());
}

export async function remove(db, id) {
  const rows = await unwrap(db.from('patient_memories').delete().eq('id', id).select('id'));
  return rows.length > 0;
}

export function removeForPatient(db, patientId, { source } = {}) {
  let query = db.from('patient_memories').delete().eq('patient_id', patientId);
  if (source) query = query.eq('source', source);
  return unwrap(query);
}
