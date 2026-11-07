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

describe('reviewer', () => {
  const approve = { approved: true, feedback: null, usage: { prompt_tokens: 100, completion_tokens: 5 } };
  const reject = (feedback) => ({ approved: false, feedback, usage: { prompt_tokens: 100, completion_tokens: 5 } });
  const reviewing = (...verdicts) => vi.fn(async () => verdicts.shift());
  const ctxWithStatus = () => newCtx({ language: 'en', onProgress: vi.fn() });

  it('sends an approved reply as it is, and counts the review', async () => {
    script.push(say('Whitening takes 60 minutes.'));
    const review = reviewing(approve);
    const ctx = ctxWithStatus();
    const result = await run(ctx, { review });

    expect(result).toMatchObject({ reply: 'Whitening takes 60 minutes.', review: { approved: true } });
    expect(result.usage).toEqual({ in: 110, out: 10 });
    expect(result.toolCalls).toContainEqual({ name: '_review', ok: true, reason: null });
    expect(ctx.onProgress).toHaveBeenCalledWith({ stage: 'reviewing' });
    expect(llmClient.chat).toHaveBeenCalledTimes(1);
  });

  it('shows the reviewer the messages, this turn’s tool results and the reply', async () => {
    script.push(call(['echo', { phone: '[PHONE_1]' }]), say('Done.'));
    const review = reviewing(approve);
    await run(ctxWithStatus(), { review });

    const seenByReviewer = review.mock.calls[0][0];
    expect(seenByReviewer).toMatchObject({ reply: 'Done.', language: 'en', messages: [{ role: 'user', content: 'hi' }] });
    expect(seenByReviewer.toolLog[0]).toMatchObject({ name: 'echo' });
    expect(JSON.stringify(seenByReviewer)).not.toContain('secret@example.com');
  });

  it('sends a rejected reply back with the feedback, then checks the new one', async () => {
    script.push(say('Whitening takes 90 minutes.'), say('Whitening takes 60 minutes.'));
    const review = reviewing(reject('It takes 60 minutes.'), approve);
    const result = await run(ctxWithStatus(), { review });

    expect(result).toMatchObject({ reply: 'Whitening takes 60 minutes.', review: { approved: true } });
    expect(review).toHaveBeenCalledTimes(2);
    expect(review.mock.calls[1][0].reply).toBe('Whitening takes 60 minutes.');
    expect(llmClient.chat.mock.calls[1][0].messages.at(-1).content).toContain('It takes 60 minutes.');
  });

  it('stops after two rewrites and sends the last reply, marked as rejected', async () => {
    script.push(say('one'), say('two'), say('three'), say('never asked for'));
    const review = reviewing(reject('a'), reject('b'), reject('c'));
    const result = await run(ctxWithStatus(), { review });

    expect(result).toMatchObject({ status: 'ok', reply: 'three', review: { approved: false, feedback: 'c' } });
    expect(llmClient.chat).toHaveBeenCalledTimes(3);
    expect(review).toHaveBeenCalledTimes(3);
  });

  it('sends the reply when the reviewer gives no verdict', async () => {
    script.push(say('Hello!'));
    const result = await run(ctxWithStatus(), { review: reviewing(null) });

    expect(result).toMatchObject({ status: 'ok', reply: 'Hello!', review: null });
  });

  it('skips the review when too little time is left', async () => {
    script.push(say('Hello!'));
    const review = reviewing(approve);
    const result = await run(ctxWithStatus(), { review, timeoutMs: 5000 });

    expect(review).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reply: 'Hello!', review: null });
  });

  it('keeps the rejected reply if the rewrite fails, instead of losing the answer', async () => {
    script.push(say('Whitening takes 90 minutes.'));
    llmClient.chat.mockImplementationOnce(async () => script.shift()).mockRejectedValueOnce(new Error('model down'));
    const result = await run(ctxWithStatus(), { review: reviewing(reject('It takes 60 minutes.')) });

    expect(result).toMatchObject({ status: 'ok', reply: 'Whitening takes 90 minutes.', review: { approved: false } });
  });

  it('never reviews a turn that a tool ended', async () => {
    script.push(call(['stop', {}]));
    const review = reviewing(approve);
    await run(ctxWithStatus(), { review });

    expect(review).not.toHaveBeenCalled();
  });
});

describe('trace', () => {
  const traced = () => {
    const steps = [];
    return { steps, note: (step) => steps.push({ at: 0, ...step }) };
  };

  it('writes down every model call, tool, review and rewrite', async () => {
    script.push(call(['echo', { phone: '[PHONE_1]' }]), say('Whitening takes 90 minutes.'), say('Whitening takes 60 minutes.'));
    const verdicts = [{ approved: false, feedback: 'It takes 60 minutes.' }, null];
    const review = vi.fn(async ({ note }) => {
      note({ type: 'review', requested: 'r' });
      return verdicts.shift();
    });
    const trace = traced();
    const result = await run(newCtx({ language: 'en' }), { review, trace });

    expect(trace.steps.map((s) => s.type)).toEqual(['ai', 'tool', 'ai', 'review', 'rewrite', 'ai', 'review']);
    expect(trace.steps[0]).toMatchObject({ model: 'fake', toolCalls: [{ name: 'echo' }], tokens: { in: 10, out: 5 } });
    expect(trace.steps[1]).toMatchObject({ name: 'echo', ok: true });
    expect(trace.steps[1].result).not.toContain('secret@example.com'); // what the AI saw: masked
    expect(trace.steps[2]).toMatchObject({ content: 'Whitening takes 90 minutes.' });
    expect(trace.steps[4]).toMatchObject({ reason: 'review', feedback: 'It takes 60 minutes.' });
    // A review that gave no verdict is counted too, so it can be measured.
    expect(result.toolCalls).toContainEqual({ name: '_review', ok: null, reason: 'no verdict' });
  });

  it('notes a broken reply, a language rewrite and a skipped review', async () => {
    script.push(say('لو عاوز ت预约 كشف'), say('مرحبا بك'), say('Welcome!'));
    const trace = traced();
    await run(newCtx({ language: 'en' }), { trace, review: vi.fn(), timeoutMs: 5000 });

    expect(trace.steps.filter((s) => s.type === 'check')).toEqual([
      expect.objectContaining({ check: 'broken', action: 'rewrite' }),
      expect.objectContaining({ check: 'language', action: 'rewrite' }),
    ]);
    expect(trace.steps.at(-1)).toMatchObject({ type: 'review', skipped: expect.stringContaining('left in the turn') });
  });

  it('notes a model call that failed', async () => {
    llmClient.chat.mockRejectedValueOnce(new Error('all models failed'));
    const trace = traced();
    await expect(run(newCtx(), { trace })).rejects.toThrow('all models failed');

    expect(trace.steps).toEqual([expect.objectContaining({ type: 'ai', error: 'all models failed' })]);
  });
});

describe('broken text', () => {
  const broken = 'تبيضة الأسنان تكلفتها ٤٥٠٠٠٠٠٠٠٠٠٠٠٠٠ و проверяется';

  it('sends broken text back once, before the reviewer sees it', async () => {
    script.push(say(broken), say('تكلفة التبييض 4,500 جنيه يا فندم.'));
    const review = vi.fn(async () => ({ approved: true, feedback: null }));
    const result = await run(newCtx({ language: 'ar', state: {} }), { review });

    expect(result).toMatchObject({ status: 'ok', reply: 'تكلفة التبييض 4,500 جنيه يا فندم.' });
    expect(llmClient.chat.mock.calls[1][0].messages.at(-1).content).toContain('broken text');
    expect(review).toHaveBeenCalledTimes(1);
    expect(review.mock.calls[0][0].reply).toBe('تكلفة التبييض 4,500 جنيه يا فندم.');
  });

  it('never returns text that is still broken after the rewrite', async () => {
    script.push(say(broken), say(broken));
    const result = await run(newCtx({ language: 'ar' }));

    expect(result.status).toBe('broken');
    expect(result.reply).toBeUndefined();
  });

  it('never falls back to a broken draft when the rewrite fails', async () => {
    script.push(say(broken));
    llmClient.chat.mockImplementationOnce(async () => script.shift()).mockRejectedValueOnce(new Error('model down'));
    const result = await run(newCtx({ language: 'ar' }));

    expect(result.status).toBe('broken');
  });
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
