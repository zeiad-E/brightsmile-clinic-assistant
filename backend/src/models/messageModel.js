import { unwrap } from './query.js';

/**
 * Messages of a conversation. Text is stored already masked ([PHONE_1], [CODE_1]…);
 * tool calls are stored too (role 'tool'), so the owner can see exactly what the agent did.
 */

export function insertMany(db, rows) {
  if (!rows.length) return [];
  return unwrap(db.from('messages').insert(rows).select('id'));
}

/**
 * The last `limit` dialogue messages, oldest first — the agent's short-term memory.
 * Team members' replies are included (the assistant should know what the clinic already said);
 * the empty 'joined' / 'left' markers are not.
 */
export async function recentDialogue(db, conversationId, limit) {
  const rows = await unwrap(
    db
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .in('role', ['user', 'assistant', 'staff'])
      .neq('content', '')
      .order('id', { ascending: false })
      .limit(limit),
  );
  return rows.reverse();
}

/** A team member's message in a patient's chat; `event` 'joined' / 'left' marks a take-over (no text). */
export function insertStaff(db, { conversationId, authorId, content = '', event = null }) {
  return unwrap(
    db
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'staff', author_id: authorId, content, tool_name: event })
      .select('id, role, content, tool_name, author_id, created_at')
      .single(),
  );
}

/** Full history for display: the patient's own (admin client after an ownership check). */
export function listForConversation(db, conversationId, { includeTools = false } = {}) {
  let query = db
    .from('messages')
    .select('id, role, content, tool_name, tool_payload, author_id, created_at')
    .eq('conversation_id', conversationId)
    .order('id');
  if (!includeTools) query = query.in('role', ['user', 'assistant', 'staff']);
  return unwrap(query);
}

/** Staff view (masked for the viewer by the v_messages view). */
export function listForStaff(db, conversationId) {
  return unwrap(
    db
      .from('v_messages')
      .select('id, role, content, tool_name, tool_payload, author_id, created_at')
      .eq('conversation_id', conversationId)
      .order('id'),
  );
}
