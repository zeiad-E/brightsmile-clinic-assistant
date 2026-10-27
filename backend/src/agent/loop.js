import { llmClient } from '../llm/LlmClient.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { LIMITS } from './guardrails.js';
import { maskDeep, unmaskValue } from './masking.js';
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
 *
 * Returns how the turn ended; throws only if the AI itself can't be reached
 * (the caller retries once, then hands over to staff).
 */
export async function runAgentTurn({
  messages,
  ctx,
  model,
  maxIterations = 5,
  timeoutMs = 30_000,
  tools = defaultTools,
  definitions = defaultDefinitions,
}) {
  const convo = [...messages];
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  const usage = { in: 0, out: 0 };
  const toolCalls = [];
  let usedModel = null;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (Date.now() > deadline) return { status: 'timeout', iterations: iteration, toolCalls, usage, model: usedModel };

    const res = await llmClient.chat({ messages: convo, tools: definitions, model, maxTokens: LIMITS.maxTokens, deadline, skipAuto: true });
    usedModel = res.model ?? usedModel;
    usage.in += res.usage?.prompt_tokens ?? 0;
    usage.out += res.usage?.completion_tokens ?? 0;
    const message = res.choices?.[0]?.message;
    if (!message) throw new Error('The AI returned no message');

    if (!message.tool_calls?.length) {
      return { status: 'ok', reply: message.content ?? '', iterations: iteration, toolCalls, usage, model: usedModel };
    }

    convo.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls });

    for (const call of message.tool_calls) {
      ctx.onProgress?.({ stage: 'tool', tool: call.function?.name });
      const result = await runTool(call, { ctx, tools, seen });
      toolCalls.push({ name: call.function?.name, ok: !result?.error });
      const forAi = maskDeep(result, ctx.map);
      ctx.toolLog.push({ name: call.function?.name, args: safeJson(call.function?.arguments), result: truncate(forAi) });
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(forAi) });
    }

    // A tool can end the turn with a fixed reply written by the code (e.g. decline_request).
    if (ctx.endTurn) return { status: 'ended', iterations: iteration + 1, toolCalls, usage, model: usedModel };
  }

  logger.warn('Agent hit the tool-round limit');
  return { status: 'max_iterations', iterations: maxIterations, toolCalls, usage, model: usedModel };
}

async function runTool(call, { ctx, tools, seen }) {
  const name = call.function?.name;
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
