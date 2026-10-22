import { supabase } from '../db/supabase.js';

/** Escalations service. TODO: implement against Supabase. */
export async function createEscalation({ reason, urgency, conversation_id }) {
  // TODO: insert into escalations (status = 'open').
  return { id: 'esc_demo', reason, urgency, conversation_id, status: 'open' };
}

export async function listOpenEscalations() {
  // TODO: select escalations where status = 'open' for the staff queue.
  return [];
}
