import { unwrap } from './query.js';

/** The assistant's per-turn debug record (see agent/trace.js). Backend-only; deleted with its conversation. */

const COLUMNS = 'id, conversation_id, turn, outcome, latency_ms, trace, created_at';

export function insert(db, { conversationId, turn, outcome, latencyMs, trace }) {
  return unwrap(db.from('agent_traces').insert({ conversation_id: conversationId, turn, outcome, latency_ms: latencyMs, trace }));
}

export function listForConversation(db, conversationId) {
  return unwrap(db.from('agent_traces').select(COLUMNS).eq('conversation_id', conversationId).order('created_at'));
}

export function latest(db, limit) {
  return unwrap(db.from('agent_traces').select(COLUMNS).order('created_at', { ascending: false }).limit(limit));
}

/** "Forget me" keeps the current chat; its traces still go (they hold the patient's notes). */
export function removeForConversation(db, conversationId) {
  return unwrap(db.from('agent_traces').delete().eq('conversation_id', conversationId));
}
