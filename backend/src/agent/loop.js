import { llmClient } from '../llm/LlmClient.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { detectLanguage, LIMITS, looksBroken, pricesIn } from './guardrails.js';
import { maskDeep, unmaskValue } from './masking.js';
import { clip } from './trace.js';
import { toolDefinitions as defaultDefinitions, toolsByName as defaultTools } from './tools/index.js';

/**
 * The agent loop (hand-rolled, no framework): ask the AI → run the tools it asks for →
 * give it the results → repeat, until it writes a reply.
 *
 * Safety limits enforced here, whatever the AI does:
 *  - at most `maxIterations` tool rounds and a hard deadline per turn
 *  - unknown tools, invalid or duplicate calls are refused (the AI gets an error to read)
 *  - arguments are validated against each tool's zod schema
 *  - signed-in-only tools refuse guests
 *  - placeholders are swapped to real values only inside tools, and tool results are
 *    masked again before the AI reads them
 *  - a reply with broken text, or in the wrong language, is sent back once to be rewritten;
 *    broken text that survives the rewrite never reaches the patient (status 'broken')
 *  - the finished reply goes to `review` (a second AI), which can send it back with feedback
 *  - a price that isn't the clinic's (ctx.knownPrices, this turn's tool results or the patient's
 *    own message) is sent back once; if it stays, the turn fails rather than quote it
 *  - while rewriting, the AI may not decline: it was answering a clinic question
 *  - with a `trace` (see agent/trace.js), every step is written down for debugging
 *
 * Once a finished reply exists it is never lost: if a rewrite fails or time runs out, that
 * reply goes out.
 *
 * Returns how the turn ended; throws only if the AI itself can't be reached
 * (the caller retries once, then hands over to staff).
 */
const MAX_REWRITES = 2;
const MIN_REVIEW_MS = 15_000; // enough for a review and a rewrite; with less, the reply just goes out

export async function runAgentTurn({
  messages,
  ctx,
  model,
  maxIterations = 8,
  timeoutMs = 30_000,
  tools = defaultTools,
  definitions = defaultDefinitions,
  review = null,
  trace = null,
}) {
  const convo = [...messages];
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  const usage = { in: 0, out: 0 };
  const toolCalls = [];
  let usedModel = null;
  let languageFixed = false;
  let cleaned = false;
  let pricesFixed = false;
  let rewriting = false;
  let rewrites = 0;
  let draft = null;
  let verdict = null;
  const note = (step) => trace?.note(step);
  const wrongPrices = (text) => {
    if (!ctx.knownPrices) return [];
    const allowed = new Set([...ctx.knownPrices, ...pricesIn(JSON.stringify(ctx.toolLog.map((t) => t.result))), ...pricesIn(messages.at(-1)?.content)]);
    return pricesIn(text).filter((price) => !allowed.has(price));
  };
  const finished = (iterations) =>
    looksBroken(draft) || wrongPrices(draft).length
      ? { status: looksBroken(draft) ? 'broken' : 'wrong_price', iterations, toolCalls, usage, model: usedModel }
      : { status: 'ok', reply: draft, iterations, toolCalls, usage, model: usedModel, review: verdict };

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (Date.now() > deadline) return draft === null ? { status: 'timeout', iterations: iteration, toolCalls, usage, model: usedModel } : finished(iteration);

    let res;
    const chain = [];
    const asked = Date.now();
    try {
      res = await llmClient.chat({ messages: convo, tools: definitions, model, maxTokens: LIMITS.maxTokens, deadline, skipAuto: true, attempts: chain });
      if (!res.choices?.[0]?.message) throw new Error('The AI returned no message');
    } catch (err) {
      note({ type: 'ai', iteration, ms: Date.now() - asked, chain, error: err.message });
      if (draft === null) throw err;
      logger.warn(`Rewrite failed, sending the last reply: ${err.message}`);
      return finished(iteration);
    }
    usedModel = res.model ?? usedModel;
    usage.in += res.usage?.prompt_tokens ?? 0;
    usage.out += res.usage?.completion_tokens ?? 0;
    const { message, finish_reason: finish } = res.choices[0];
    note({
      type: 'ai',
      iteration,
      model: res.model ?? null,
      ms: Date.now() - asked,
      chain,
      finish: finish ?? null,
      tokens: { in: res.usage?.prompt_tokens ?? null, out: res.usage?.completion_tokens ?? null },
      content: clip(message.content),
      reasoning: clip(message.reasoning ?? message.reasoning_content, 2000),
      toolCalls: (message.tool_calls ?? []).map((c) => ({ name: c.function?.name, args: clip(c.function?.arguments, 1000) })),
    });

    if (!message.tool_calls?.length) {
      draft = message.content || draft || '';
      const canRewrite = iteration + 1 < maxIterations && Date.now() < deadline;
      const sendBack = (instruction) => {
        rewriting = true;
        convo.push({ role: 'assistant', content: draft }, { role: 'user', content: instruction });
      };

      // Free models sometimes write broken text. One chance to fix it; if it stays broken, the
      // turn fails (the caller retries with a fresh attempt) rather than show it to the patient.
      if (looksBroken(draft)) {
        note({ type: 'check', check: 'broken', action: !canRewrite || cleaned ? 'give_up' : 'rewrite' });
        if (!canRewrite || cleaned) return finished(iteration);
        cleaned = true;
        sendBack(`That reply has broken text: words in other alphabets, a character repeated many times, or English glued to Arabic. Write it again cleanly, in ${ctx.language === 'ar' ? 'Arabic' : 'English'}.`);
        continue;
      }

      // A price the clinic doesn't have (the model guessed it) gets one chance to be fixed.
      const unknown = wrongPrices(draft);
      if (unknown.length) {
        note({ type: 'check', check: 'price', found: unknown, action: !canRewrite || pricesFixed ? 'give_up' : 'rewrite' });
        if (!canRewrite || pricesFixed) return finished(iteration);
        pricesFixed = true;
        sendBack(`That reply quotes a price the clinic does not have (${unknown.join(', ')} EGP). Never guess prices: call list_services or search_knowledge and use only the prices they return. Write the full reply again.`);
        continue;
      }

      // Models sometimes drift to the language of the history. They get one chance to fix it.
      if (canRewrite && !languageFixed && ctx.language && detectLanguage(draft, ctx.language) !== ctx.language) {
        note({ type: 'check', check: 'language', wanted: ctx.language, action: 'rewrite' });
        languageFixed = true;
        sendBack(`Write that reply again, in ${ctx.language === 'ar' ? 'Arabic' : 'English'}.`);
        continue;
      }

      verdict = null;
      if (review && deadline - Date.now() <= MIN_REVIEW_MS) note({ type: 'review', skipped: `only ${deadline - Date.now()} ms left in the turn` });
      if (review && deadline - Date.now() > MIN_REVIEW_MS) {
        ctx.onProgress?.({ stage: 'reviewing' });
        verdict = await review({ messages, toolLog: ctx.toolLog, reply: draft, language: ctx.language, writer: usedModel, note });
        if (verdict) {
          usage.in += verdict.usage?.prompt_tokens ?? 0;
          usage.out += verdict.usage?.completion_tokens ?? 0;
          toolCalls.push({ name: '_review', ok: verdict.approved, reason: verdict.feedback });
        } else {
          toolCalls.push({ name: '_review', ok: null, reason: 'no verdict' });
        }
        if (verdict && !verdict.approved && canRewrite && rewrites < MAX_REWRITES) {
          rewrites += 1;
          note({ type: 'rewrite', reason: 'review', feedback: verdict.feedback });
          sendBack(`A reviewer sent your draft back (the patient has not seen it): ${verdict.feedback}
Write the full reply again with that fixed. Write only what the patient should read, and don't mention the review.`);
          continue;
        }
      }
      return finished(iteration);
    }

    convo.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls });

    for (const call of message.tool_calls) {
      ctx.onProgress?.({ stage: 'tool', tool: call.function?.name });
      const toolStarted = Date.now();
      const result = await runTool(call, { ctx, tools, seen, rewriting });
      toolCalls.push({ name: call.function?.name, ok: !result?.error });
      const forAi = maskDeep(result, ctx.map);
      note({ type: 'tool', name: call.function?.name, ok: !result?.error, ms: Date.now() - toolStarted, args: clip(call.function?.arguments, 1000), result: clip(forAi, 3000) });
      ctx.toolLog.push({ name: call.function?.name, args: safeJson(call.function?.arguments), result: truncate(forAi) });
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(forAi) });
    }

    // A tool can end the turn with a fixed reply written by the code (e.g. decline_request).
    if (ctx.endTurn) return { status: 'ended', iterations: iteration + 1, toolCalls, usage, model: usedModel };
  }

  if (draft !== null) return finished(maxIterations);
  logger.warn('Agent hit the tool-round limit');
  return { status: 'max_iterations', iterations: maxIterations, toolCalls, usage, model: usedModel };
}

async function runTool(call, { ctx, tools, seen, rewriting }) {
  const name = call.function?.name;
  // A rewrite only fixes how a clinic answer is written; it is never a reason to refuse the patient.
  if (rewriting && name === 'decline_request') {
    return { error: 'not_now', message: 'You are rewriting an answer to a clinic question. Do not decline it: write the fixed answer.' };
  }
  const rawArgs = call.function?.arguments || '{}';
  const signature = `${name}:${rawArgs}`;
  if (seen.has(signature)) return { error: 'duplicate_call', message: 'You already made this exact call this turn.' };
  seen.add(signature);

  const tool = tools.get(name);
  if (!tool) return { error: 'unknown_tool', message: `There is no tool called ${name}.` };
  if (tool.signedIn && !ctx.isPatient) {
    return { error: 'sign_in_required', message: 'This needs a signed-in patient. Offer to sign them in first.' };
  }

  let args;
  try {
    args = JSON.parse(rawArgs);
  } catch {
    return { error: 'invalid_arguments', message: 'Arguments were not valid JSON.' };
  }
  const parsed = tool.schema.safeParse(unmaskValue(args, ctx.map));
  if (!parsed.success) {
    return {
      error: 'invalid_arguments',
      message: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`).join('; '),
    };
  }

  try {
    return await tool.run(parsed.data, ctx);
  } catch (err) {
    if (err instanceof AppError) return { error: err.code, message: err.message };
    logger.error(`Tool ${name} failed: ${err.message}`);
    return { error: 'tool_failed', message: 'This action failed. Apologise and offer to connect them with staff.' };
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return { raw: String(text).slice(0, 200) };
  }
}

function truncate(value) {
  const json = JSON.stringify(value ?? null);
  return json.length > 2000 ? { truncated: json.slice(0, 2000) } : value;
}
