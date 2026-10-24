import { pageRange, unwrap, unwrapPage } from './query.js';

/** Conversations the assistant handed to a human. Created by the chatbot (Part 2). */

const COLUMNS = 'id, conversation_id, patient_id, reason, urgency, status, resolved_by, resolved_at, created_at, updated_at';

export function list(db, { status, limit, offset }) {
  let query = db.from('escalations').select(COLUMNS, { count: 'exact' }).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}

export function findById(db, id) {
  return unwrap(db.from('escalations').select(COLUMNS).eq('id', id).maybeSingle());
}

/** Resolves an open escalation; returns null if it was already resolved (or not found). */
export function resolve(db, id, resolvedBy) {
  return unwrap(
    db
      .from('escalations')
      .update({ status: 'resolved', resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'open')
      .select(COLUMNS)
      .maybeSingle(),
  );
}
