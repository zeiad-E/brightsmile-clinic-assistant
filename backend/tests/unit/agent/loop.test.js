import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * The agent loop with a scripted "AI": each call returns the next pre-written response,
 * so every safety rule can be tested deterministically.
 */
const script = [];
vi.mock('../../../src/llm/LlmClient.js', () => ({
  llmClient: { chat: vi.fn(async () => script.shift()) },
}));

const { llmClient } = await import('../../../src/llm/LlmClient.js');
const { runAgentTurn } = await import('../../../src/agent/loop.js');
const { defineTool, toOpenAiDefinition } = await import('../../../src/agent/tools/define.js');

const say = (content) => ({ model: 'fake', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ message: { content } }] });
const call = (...calls) => ({
  model: 'fake',
  usage: { prompt_tokens: 10, completion_tokens: 5 },
  choices: [{ message: { content: '', tool_calls: calls.map(([name, args, id = name]) => ({ id, function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } })) } }],
});

const seen = [];
const echo = defineTool({
  name: 'echo',
  description: 'echo',
  schema: z.object({ phone: z.string() }),
  run: async (args) => {
    seen.push(args);
    return { got: args.phone, email: 'secret@example.com' };
  },
});
const mine = defineTool({ name: 'mine', description: 'signed in only', signedIn: true, run: async () => ({ ok: true }) });
const stop = defineTool({
  name: 'stop',
  description: 'ends the turn',
  run: async (_a, ctx) => {
    ctx.endTurn = { kind: 'off_topic' };
    return { declined: true };
  },
});
const boom = defineTool({ name: 'boom', description: 'fails', run: async () => { throw new Error('db down'); } });
const tools = new Map([echo, mine, stop, boom].map((t) => [t.name, t]));
const definitions = [echo, mine, stop, boom].map(toOpenAiDefinition);

const newCtx = (overrides = {}) => ({ map: { '[PHONE_1]': '+201001234567' }, toolLog: [], isPatient: false, ...overrides });
const run = (ctx, extra = {}) => runAgentTurn({ messages: [{ role: 'user', content: 'hi' }], ctx, tools, definitions, ...extra });
const toolMessages = () => llmClient.chat.mock.calls.at(-1)[0].messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));

beforeEach(() => {
  script.length = 0;
  seen.length = 0;
  vi.clearAllMocks();
});

describe('reply language', () => {
  it('asks once for a rewrite when the reply is in the wrong language', async () => {
    script.push(say('ألف سلامة عليك يا فندم، هشوفلك أقرب معاد فورًا.'), say("I'm so sorry you're in pain."));
    const result = await run(newCtx({ language: 'en' }));

    expect(result).toMatchObject({ status: 'ok', reply: "I'm so sorry you're in pain." });
    expect(llmClient.chat.mock.calls.at(-1)[0].messages.at(-1)).toEqual({ role: 'user', content: 'Write that reply again, in English.' });
  });

  it('accepts the second answer whatever its language', async () => {
    script.push(say('هشوفلك أقرب معاد فورًا يا فندم'), say('تمام يا فندم هشوفلك أقرب معاد'));
    const result = await run(newCtx({ language: 'en' }));

    expect(result.reply).toBe('تمام يا فندم هشوفلك أقرب معاد');
    expect(llmClient.chat).toHaveBeenCalledTimes(2);
  });

  it('leaves a reply alone when it keeps a term from the other language', async () => {
    script.push(say('تكلفة ال whitening أربعة آلاف وخمسمية جنيه يا فندم'));
    await run(newCtx({ language: 'ar' }));

    expect(llmClient.chat).toHaveBeenCalledTimes(1);
  });

  it('keeps the reply when there is no round left to rewrite it', async () => {
    script.push(say('هشوفلك أقرب معاد فورًا يا فندم'));
    const result = await run(newCtx({ language: 'en' }), { maxIterations: 1 });

    expect(result).toMatchObject({ status: 'ok', reply: 'هشوفلك أقرب معاد فورًا يا فندم' });
  });
});

describe('agent loop', () => {
  it('returns the AI’s reply when it needs no tools', async () => {
    script.push(say('Hello!'));
    const result = await run(newCtx());

    expect(result).toMatchObject({ status: 'ok', reply: 'Hello!', iterations: 0, usage: { in: 10, out: 5 } });
  });

  it('runs a tool with real values but gives the AI masked results', async () => {
    script.push(call(['echo', { phone: '[PHONE_1]' }]), say('Done'));
    const ctx = newCtx();
    const result = await run(ctx);

    expect(seen).toEqual([{ phone: '+201001234567' }]); // the tool saw the real number
    expect(toolMessages()[0]).toEqual({ got: '[PHONE_1]', email: '[EMAIL_1]' }); // the AI saw placeholders
    expect(result.toolCalls).toEqual([{ name: 'echo', ok: true }]);
    expect(ctx.toolLog[0]).toMatchObject({ name: 'echo', args: { phone: '[PHONE_1]' } });
  });

  it('refuses unknown tools, bad JSON and wrong arguments without crashing', async () => {
    script.push(call(['nope', {}, 'a'], ['echo', '{bad json', 'b'], ['echo', { phone: 42 }, 'c']), say('Sorry'));
    await run(newCtx());

    expect(toolMessages().map((m) => m.error)).toEqual(['unknown_tool', 'invalid_arguments', 'invalid_arguments']);
  });

  it('ignores an identical repeated call in the same turn', async () => {
    script.push(call(['echo', { phone: '1' }, 'a']), call(['echo', { phone: '1' }, 'b']), say('ok'));
    await run(newCtx());

    expect(seen).toHaveLength(1);
    expect(toolMessages().at(-1).error).toBe('duplicate_call');
  });

  it('keeps signed-in tools away from guests', async () => {
    script.push(call(['mine', {}]), say('Please sign in'));
    await run(newCtx({ isPatient: false }));

    expect(toolMessages()[0].error).toBe('sign_in_required');
  });

  it('lets a tool end the turn with a fixed reply', async () => {
    script.push(call(['stop', {}]));
    const ctx = newCtx();
    const result = await run(ctx);

    expect(result.status).toBe('ended');
    expect(ctx.endTurn).toEqual({ kind: 'off_topic' });
    expect(llmClient.chat).toHaveBeenCalledTimes(1);
  });

  it('turns a crashing tool into a readable error for the AI', async () => {
    script.push(call(['boom', {}]), say('Sorry'));
    await run(newCtx());

    expect(toolMessages()[0].error).toBe('tool_failed');
  });

  it('stops after the maximum number of tool rounds', async () => {
    script.push(call(['echo', { phone: '1' }, 'a']), call(['echo', { phone: '2' }, 'b']), call(['echo', { phone: '3' }, 'c']));
    const result = await run(newCtx(), { maxIterations: 2 });

    expect(result.status).toBe('max_iterations');
    expect(llmClient.chat).toHaveBeenCalledTimes(2);
  });

  it('throws when the AI cannot be reached (the caller retries)', async () => {
    llmClient.chat.mockRejectedValueOnce(new Error('all models down'));
    await expect(run(newCtx())).rejects.toThrow('all models down');
  });
});
