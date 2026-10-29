import { pageRange, unwrap, unwrapPage } from './query.js';

/** Chat threads. Each one belongs to an assistant (patient/staff) and, once known, a patient. */

const LIST_COLUMNS =
  'id, assistant, status, title, language, profile_id, patient_id, turn_count, last_message_at, created_at, reviewed_at, review_note, taken_over_by, taken_over_at';
const FULL_COLUMNS = `${LIST_COLUMNS}, state, off_topic_count, blocked_until, summary, reviewed_by`;

/** "Live" on the dashboard = a message in the last 10 minutes. */
export const LIVE_MINUTES = 10;

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

/** Past conversations most similar to a question (one patient only; vector search on summaries). */
export async function matchSummaries(db, { patientId, embedding, limit = 2 }) {
  return (
    (await unwrap(
      db.rpc('match_conversation_summaries', {
        p_patient_id: patientId,
        query_embedding: JSON.stringify(embedding),
        match_count: limit + 1,
      }),
    )) ?? []
  );
}

/** For "forget me": the patient's conversations that may be deleted (none with an open escalation). */
export async function deletableForPatient(db, patientId) {
  const [conversations, escalations] = await Promise.all([
    unwrap(db.from('conversations').select('id').eq('patient_id', patientId)),
    unwrap(db.from('escalations').select('conversation_id').eq('patient_id', patientId).eq('status', 'open')),
  ]);
  const keep = new Set(escalations.map((e) => e.conversation_id));
  return conversations.map((c) => c.id).filter((id) => !keep.has(id));
}

export async function removeMany(db, ids) {
  if (!ids.length) return 0;
  // Messages go with their conversation; agent_runs stay (no personal data) for the owner's stats.
  const rows = await unwrap(db.from('conversations').delete().in('id', ids).select('id'));
  return rows.length;
}

/** Staff/owner list, newest activity first, with the dashboard's filters. */
export function listForStaff(db, { status, patientId, live, reviewed, withTeam, limit, offset }, now = new Date()) {
  let query = db
    .from('conversations')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('assistant', 'patient')
    .order('last_message_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (patientId) query = query.eq('patient_id', patientId);
  if (live) query = query.gte('last_message_at', new Date(now.getTime() - LIVE_MINUTES * 60_000).toISOString());
  if (reviewed === 'yes') query = query.not('reviewed_at', 'is', null);
  if (reviewed === 'no') query = query.is('reviewed_at', null);
  if (withTeam) query = query.not('taken_over_by', 'is', null);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}
