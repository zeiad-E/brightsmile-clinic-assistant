import { pageRange, unwrap, unwrapPage } from './query.js';

/** "The assistant got this wrong" reports from the team (G4): the owner's problem queue. */

const COLUMNS = 'id, conversation_id, message_id, kind, note, status, reported_by, resolved_by, resolved_at, owner_note, created_at';

export function create(db, { conversationId, messageId = null, kind, note, reportedBy }) {
  return unwrap(
    db
      .from('assistant_reports')
      .insert({ conversation_id: conversationId, message_id: messageId, kind, note, reported_by: reportedBy })
      .select(COLUMNS)
      .single(),
  );
}

export function list(db, { status, limit, offset }) {
  let query = db.from('assistant_reports').select(COLUMNS, { count: 'exact' }).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}

export function forConversation(db, conversationId) {
  return unwrap(db.from('assistant_reports').select(COLUMNS).eq('conversation_id', conversationId).order('created_at'));
}

/** Resolves an open report; null if it was already resolved (or not found). */
export function resolve(db, id, { resolvedBy, ownerNote = null }) {
  return unwrap(
    db
      .from('assistant_reports')
      .update({ status: 'resolved', resolved_by: resolvedBy, resolved_at: new Date().toISOString(), owner_note: ownerNote })
      .eq('id', id)
      .eq('status', 'open')
      .select(COLUMNS)
      .maybeSingle(),
  );
}
