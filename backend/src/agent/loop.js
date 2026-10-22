import { llmClient } from '../llm/LlmClient.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { toolDefinitions, toolHandlers } from './tools/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getCachedAnswer } from '../cache/faqCache.js';

/**
 * Hand-rolled tool-calling loop (no LangChain/LangGraph).
 *
 * Safety limits (FR-13c–e):
 *  - hard cap on tool-call iterations per turn
 *  - reject repeated identical tool calls
 *  - overall per-turn timeout
 */
export async function runAgentTurn({ messages, context = {} }) {
  // 0) FAQ cache shortcut for common questions (speed + fewer LLM calls).
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const cached = lastUser && getCachedAnswer(lastUser.content);
  if (cached) return { reply: cached, cached: true };

  const convo = [
    { role: 'system', content: buildSystemPrompt(context) },
    ...messages,
  ];

  const seenToolCalls = new Set();
  const deadline = Date.now() + config.agent.turnTimeoutMs;

  for (let i = 0; i < config.agent.maxToolIterations; i++) {
    if (Date.now() > deadline) {
      logger.warn('Agent turn timed out');
      return { reply: fallbackMessage(context), timedOut: true };
    }

    const res = await llmClient.chat({ messages: convo, tools: toolDefinitions });
    const choice = res.choices[0];
    const msg = choice.message;

    // No tool call → final answer.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: msg.content ?? '', iterations: i };
    }

    convo.push(msg);

    for (const call of msg.tool_calls) {
      const sig = `${call.function.name}:${call.function.arguments}`;
      if (seenToolCalls.has(sig)) {
        // Reject repeated identical calls to prevent loops.
        convo.push(toolResult(call.id, { error: 'duplicate_call_ignored' }));
        continue;
      }
      seenToolCalls.add(sig);

      const handler = toolHandlers[call.function.name];
      if (!handler) {
        convo.push(toolResult(call.id, { error: 'unknown_tool' }));
        continue;
      }

      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        convo.push(toolResult(call.id, { error: 'invalid_arguments' }));
        continue;
      }

      try {
        const result = await handler(args, context);
        convo.push(toolResult(call.id, result));
      } catch (err) {
        logger.error(`Tool ${call.function.name} failed: ${err.message}`);
        convo.push(toolResult(call.id, { error: 'tool_failed' }));
      }
    }
  }

  // Exceeded iteration cap → stop gracefully.
  logger.warn('Agent hit max tool iterations');
  return { reply: fallbackMessage(context), maxedOut: true };
}

function toolResult(toolCallId, content) {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify(content),
  };
}

function fallbackMessage(context) {
  const ar = context.language === 'ar';
  return ar
    ? 'عذرًا، لم أتمكن من إكمال طلبك الآن. سأحوّلك إلى أحد موظفينا لمساعدتك.'
    : "I'm sorry — I couldn't complete that just now. Let me connect you with a staff member to help.";
}
