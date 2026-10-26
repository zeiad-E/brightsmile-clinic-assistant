import { pageRange, unwrap, unwrapPage } from './query.js';

/** Chat threads. Each one belongs to an assistant (patient/staff) and, once known, a patient. */

const LIST_COLUMNS = 'id, assistant, status, title, language, profile_id, patient_id, turn_count, last_message_at, created_at, reviewed_at';
const FULL_COLUMNS = `${LIST_COLUMNS}, state, off_topic_count, blocked_until, summary, review_note`;

export function create(db, { assistant = 'patient', profileId = null, patientId = null, language = 'en' }) {
  return unwrap(
    db
      .from('conversations')
      .insert({ assistant, profile_id: profileId, patient_id: patientId, language })
      .select(FULL_COLUMNS)
      .single(),
  );
}

export function findById(db, id) {
  return unwrap(db.from('conversations').select(FULL_COLUMNS).eq('id', id).maybeSingle());
}

export function update(db, id, patch) {
  return unwrap(db.from('conversations').update(patch).eq('id', id).select(FULL_COLUMNS).single());
}

/** The signed-in patient's own chats (Row Level Security limits it to their login). */
export function listMine(db, { limit, offset }) {
  return unwrapPage(
    db
      .from('conversations')
      .select('id, status, title, language, last_message_at, created_at', { count: 'exact' })
      .eq('assistant', 'patient')
      .order('last_message_at', { ascending: false })
      .range(...pageRange({ limit, offset })),
  );
}

/** Staff/owner list, newest activity first, optionally by status. */
export function listForStaff(db, { status, patientId, limit, offset }) {
  let query = db
    .from('conversations')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('assistant', 'patient')
    .order('last_message_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (patientId) query = query.eq('patient_id', patientId);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}
