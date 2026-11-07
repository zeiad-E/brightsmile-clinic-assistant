/**
 * The trace: a step-by-step record of one assistant turn, kept for debugging. Like a flight
 * recorder, it never changes what happens; it writes down what the AI was given, every model
 * call, tool, check, review and rewrite, and what reached the patient.
 *
 * Saved in agent_traces (backend-only, deleted with the conversation). Read it with
 * `npm run trace -- <conversation id>` or `npm run trace -- --last 5`.
 */

const CLIP = 4000;

/** Long text is cut (with a note saying how much), so one turn can't grow a huge row. */
export function clip(value, max = CLIP) {
  if (value === undefined || value === null) return value ?? null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}… [+${text.length - max} chars]` : text;
}

export function startTrace({ turn, language, message }) {
  return { version: 1, startedAt: new Date().toISOString(), turn, language, input: { message: clip(message) }, attempts: [], notes: [] };
}

/** A new attempt (the caller retries once on failure); its `note` adds a timed step. */
export function startAttempt(trace, details) {
  const started = Date.now();
  const attempt = { attempt: trace.attempts.length + 1, ...details, steps: [] };
  attempt.note = (step) => attempt.steps.push({ at: Date.now() - started, ...step });
  trace.attempts.push(attempt);
  return attempt;
}

/** The trace as saved: the attempts' `note` helpers are dropped. */
export function finishTrace(trace, output) {
  return { ...trace, attempts: trace.attempts.map(({ note: _note, ...rest }) => rest), output };
}

const seconds = (ms) => `${((ms ?? 0) / 1000).toFixed(1)}s`;

function describeStep(step) {
  switch (step.type) {
    case 'ai': {
      if (step.error) return `ai(error: ${clip(step.error, 80)})`;
      const tools = step.toolCalls?.length ? ` → ${step.toolCalls.map((t) => t.name).join('+')}` : '';
      return `ai(${step.model ?? '?'} ${seconds(step.ms)} ${step.finish ?? '?'}${tools})`;
    }
    case 'tool':
      return `tool(${step.name} ${step.ok ? 'ok' : 'failed'})`;
    case 'check':
      return `check(${step.check} → ${step.action})`;
    case 'review':
      if (step.skipped) return `review(skipped: ${step.skipped})`;
      if (step.error) return `review(${step.model ?? step.requested} no verdict: ${clip(step.error, 60)})`;
      return `review(${step.model} ${seconds(step.ms)} ${step.verdict?.approved ? 'approved' : 'rejected'})`;
    case 'end':
      return `end(${step.status})`;
    default:
      return step.type;
  }
}

/** One line for the server log: enough to spot a problem, with the full trace in the database. */
export function summarizeTrace(trace, { conversationId, outcome, latencyMs }) {
  const attempts = trace.attempts.map((a) => `#${a.attempt} ${a.steps.map(describeStep).join(' ')}`).join(' | ');
  const notes = trace.notes.length ? ` | ${trace.notes.join('; ')}` : '';
  return `[trace] ${conversationId} turn ${trace.turn} ${outcome} ${seconds(latencyMs)} | ${attempts || 'no AI'}${notes}`;
}
