import { pageRange, unwrap, unwrapPage } from './query.js';

/** One row per assistant turn: model, speed, tools used, outcome, tokens. Feeds the owner's AI stats. */
export function insert(db, run) {
  return unwrap(
    db.from('agent_runs').insert({
      conversation_id: run.conversationId,
      assistant: run.assistant ?? 'patient',
      model: run.model ?? null,
      latency_ms: run.latencyMs,
      iterations: run.iterations ?? 0,
      tool_calls: run.toolCalls ?? [],
      outcome: run.outcome,
      tokens_in: run.tokensIn ?? null,
      tokens_out: run.tokensOut ?? null,
      retries: run.retries ?? 0,
    }),
  );
}

/** What the assistant DID (booked, changed, handed over, failed), newest first (G3). */
export function listActions(db, { limit, offset }) {
  return unwrapPage(
    db
      .from('agent_runs')
      .select('id, conversation_id, outcome, tool_calls, latency_ms, created_at', { count: 'exact' })
      .eq('assistant', 'patient')
      .in('outcome', ['booked', 'changed_data', 'escalated', 'fallback'])
      .order('created_at', { ascending: false })
      .range(...pageRange({ limit, offset })),
  );
}
