/**
 * Reads the assistant's traces (agent_traces) and prints them as a timeline: what the patient
 * wrote, every model call, tool, check, review and rewrite, and what reached the patient.
 *
 *   npm run trace -- <conversation id>     every turn of one conversation
 *   npm run trace -- --last 5              the 5 most recent turns, any conversation
 *   add --full                             also the system prompt, the history the AI saw,
 *                                          full tool results and the reviewer's input
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env. Traces hold masked chat text
 * and patient notes: read them to debug, don't paste them anywhere public.
 */
import { supabaseAdmin as db } from '../src/db/supabase.js';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const lastAt = args.indexOf('--last');
const conversationId = args.find((a) => /^[0-9a-f-]{36}$/i.test(a));

if (!db) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.');
if (!conversationId && lastAt === -1) {
  console.log('Usage: npm run trace -- <conversation id> [--full]   or   npm run trace -- --last 5 [--full]');
  process.exit(1);
}

const s = (ms) => `${((ms ?? 0) / 1000).toFixed(1)}s`;
const indent = (text, pad = '              ') => String(text ?? '').split('\n').join(`\n${pad}`);
const short = (text, max = 300) => {
  const value = String(text ?? '');
  return FULL || value.length <= max ? value : `${value.slice(0, max)}… (--full for all)`;
};

function printStep(step) {
  const at = `+${s(step.at)}`.padStart(7);
  const tried = step.chain?.length ? `\n              tried: ${step.chain.map((c) => `${c.model} ${c.ok ? 'ok' : `FAILED (${c.error})`} ${s(c.ms)}`).join(' → ')}` : '';
  switch (step.type) {
    case 'ai':
      if (step.error) return console.log(`${at}  AI     ERROR ${s(step.ms)}: ${step.error}${tried}`);
      console.log(`${at}  AI     ${step.model} ${s(step.ms)} finish=${step.finish} tokens ${step.tokens?.in}→${step.tokens?.out}${tried}`);
      if (step.reasoning) console.log(`              thinking: ${indent(short(step.reasoning))}`);
      if (step.content) console.log(`              wrote: ${indent(short(step.content, 600))}`);
      for (const call of step.toolCalls ?? []) console.log(`              → ${call.name}(${short(call.args, 200)})`);
      return;
    case 'tool':
      console.log(`${at}  TOOL   ${step.name} ${step.ok ? 'ok' : 'FAILED'} ${step.ms}ms  args ${short(step.args, 200)}`);
      return console.log(`              result: ${indent(short(step.result, 400))}`);
    case 'check':
      return console.log(`${at}  CHECK  ${step.check} → ${step.action}`);
    case 'rewrite':
      return console.log(`${at}  REWRITE asked by the reviewer: ${step.feedback}`);
    case 'review': {
      if (step.skipped) return console.log(`${at}  REVIEW skipped: ${step.skipped}`);
      const result = step.verdict ? (step.verdict.approved ? 'APPROVED' : `REJECTED: ${step.verdict.feedback}`) : `NO VERDICT: ${step.error}`;
      console.log(`${at}  REVIEW asked ${step.requested}, answered by ${step.model ?? '-'} ${s(step.ms)} finish=${step.finish ?? '-'} tokens ${step.tokens?.in ?? '-'}→${step.tokens?.out ?? '-'}${tried}`);
      console.log(`              ${result}`);
      if (step.raw !== undefined) console.log(`              raw answer: ${indent(short(step.raw, 400))}`);
      if (step.reasoning) console.log(`              thinking: ${indent(short(step.reasoning))}`);
      if (FULL) console.log(`              its input:\n              ${indent(step.input)}`);
      return;
    }
    default:
      return console.log(`${at}  ${JSON.stringify(step)}`);
  }
}

function printTrace(row) {
  const t = row.trace;
  console.log(`\n═══ Turn ${row.turn} · ${row.outcome} · ${s(row.latency_ms)} · ${row.created_at.slice(0, 19).replace('T', ' ')} UTC · conversation ${row.conversation_id}`);
  console.log(`Language ${t.language}${t.input.safeMode ? ' · SAFE MODE' : ''} · chat models: ${(t.input.chatModels ?? []).join(', ') || '-'} · reviewer: ${t.input.reviewModel ?? 'chain'}`);
  console.log(`Patient: ${indent(t.input.message, '         ')}`);
  if (FULL && t.input.systemPrompt) console.log(`\n--- system prompt ---\n${t.input.systemPrompt}\n--- history (${t.input.history?.length ?? 0}) ---\n${(t.input.history ?? []).map((m) => `${m.role}: ${m.content}`).join('\n')}\n---`);
  for (const attempt of t.attempts ?? []) {
    console.log(`Attempt ${attempt.attempt} (${attempt.model}, ${attempt.historyMessages} past messages) → ${attempt.status ?? '?'}${attempt.error ? `: ${attempt.error}` : ''}`);
    for (const step of attempt.steps ?? []) printStep(step);
  }
  for (const note of t.notes ?? []) console.log(`Note: ${note}`);
  console.log(`Reply: ${indent(t.output?.reply, '       ')}`);
  console.log(`Tokens ${t.output?.tokens?.in ?? '-'}→${t.output?.tokens?.out ?? '-'} · retries ${t.output?.retries ?? 0}`);
}

const query = db.from('agent_traces').select('conversation_id, turn, outcome, latency_ms, trace, created_at');
const { data, error } = conversationId
  ? await query.eq('conversation_id', conversationId).order('created_at')
  : await query.order('created_at', { ascending: false }).limit(Number(args[lastAt + 1]) || 5);
if (error) throw error;
if (!data.length) console.log('No traces found.');
for (const row of conversationId ? data : [...data].reverse()) printTrace(row);
process.exit(0);
