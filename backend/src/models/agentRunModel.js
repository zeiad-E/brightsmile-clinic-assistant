import { unwrap } from './query.js';

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
