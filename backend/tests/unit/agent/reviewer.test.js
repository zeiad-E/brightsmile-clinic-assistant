import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/llm/LlmClient.js', () => ({ llmClient: { chat: vi.fn() } }));

const { llmClient } = await import('../../../src/llm/LlmClient.js');
const { reviewReply } = await import('../../../src/agent/reviewer.js');
const { config } = await import('../../../src/config/index.js');

const answers = (content) => llmClient.chat.mockResolvedValue({ usage: { prompt_tokens: 900, completion_tokens: 12 }, choices: [{ message: { content } }] });
const input = {
  messages: [
    { role: 'system', content: 'SECRET RULES' },
    ...Array.from({ length: 26 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i}` })),
  ],
  toolLog: [{ name: 'list_services', args: {}, result: { services: [{ slug: 'whitening', duration_minutes: 60 }] } }],
  reply: 'جلسة التبييض 90 دقيقة',
  language: 'ar',
  writer: `openai/${config.llm.chatModels[0]}`,
};

beforeEach(() => vi.clearAllMocks());

describe('reviewer', () => {
  it('approves', async () => {
    answers('{"approved":true}');
    expect(await reviewReply(input)).toMatchObject({ approved: true, feedback: null });
  });

  it('returns the feedback when it rejects, even inside extra text', async () => {
    answers('Here you go: {"approved":false,"feedback":"Whitening takes 60 minutes."} done');
    expect(await reviewReply(input)).toMatchObject({ approved: false, feedback: 'Whitening takes 60 minutes.' });
  });

  it('sees recent messages, tool results and the reply, but not the assistant’s instructions', async () => {
    answers('{"approved":true}');
    await reviewReply(input);

    const { messages, tools, maxTokens } = llmClient.chat.mock.calls[0][0];
    const text = messages[1].content;
    expect(text).toContain('duration_minutes');
    expect(text).toContain(input.reply);
    expect(text).toContain('Arabic');
    expect(text).toContain('message 6\n'); // the last 20
    expect(text).not.toContain('message 5\n');
    expect(text).not.toContain('SECRET RULES');
    expect(tools).toBeUndefined();
    expect(maxTokens).toBeLessThanOrEqual(800);
  });

  it('uses its own model when one is set, else a different model from the writer', async () => {
    answers('{"approved":true}');
    await reviewReply(input);

    expect(llmClient.chat.mock.calls[0][0].model).toBe('agnes-3.0-flash');

    const saved = config.llm.reviewModel;
    config.llm.reviewModel = '';
    await reviewReply(input);
    config.llm.reviewModel = saved;
    expect(llmClient.chat.mock.calls[1][0].model).toBe(config.llm.chatModels[1]);
  });

  it.each([['not json at all'], ['{"approved":"maybe"}'], ['']])('gives no verdict for a broken answer: %s', async (content) => {
    answers(content);
    expect(await reviewReply(input)).toBeNull();
  });

  it('gives the reviewer 12 seconds', async () => {
    answers('{"approved":true}');
    const before = Date.now();
    await reviewReply(input);
    const { deadline } = llmClient.chat.mock.calls[0][0];
    expect(deadline - before).toBeGreaterThanOrEqual(12_000);
    expect(deadline - before).toBeLessThan(13_000);
  });

  it('records its input, raw answer and verdict for the trace', async () => {
    llmClient.chat.mockResolvedValue({ model: 'openai/gpt-oss-20b', usage: { prompt_tokens: 900, completion_tokens: 12 }, choices: [{ finish_reason: 'stop', message: { content: '{"approved":false,"feedback":"60 minutes."}' } }] });
    const note = vi.fn();
    await reviewReply({ ...input, note });

    expect(note).toHaveBeenCalledWith(expect.objectContaining({
      type: 'review',
      requested: 'agnes-3.0-flash',
      model: 'openai/gpt-oss-20b',
      finish: 'stop',
      tokens: { in: 900, out: 12 },
      raw: '{"approved":false,"feedback":"60 minutes."}',
      verdict: { approved: false, feedback: '60 minutes.' },
    }));
    expect(note.mock.calls[0][0].input).toContain(input.reply);
  });

  it('says why there is no verdict: an answer cut short while the model was still thinking', async () => {
    llmClient.chat.mockResolvedValue({ model: 'openai/gpt-oss-20b', choices: [{ finish_reason: 'length', message: { content: '', reasoning: 'Let me check the duration…' } }] });
    const note = vi.fn();
    expect(await reviewReply({ ...input, note })).toBeNull();

    expect(note).toHaveBeenCalledWith(expect.objectContaining({ finish: 'length', raw: '', reasoning: 'Let me check the duration…', error: expect.stringContaining('unreadable answer') }));
  });

  it('says why there is no verdict: no model answered', async () => {
    llmClient.chat.mockRejectedValue(new Error('Request timed out.'));
    const note = vi.fn();
    expect(await reviewReply({ ...input, note })).toBeNull();

    expect(note).toHaveBeenCalledWith(expect.objectContaining({ type: 'review', error: 'no answer: Request timed out.' }));
  });

  it('gives no verdict when the AI is down', async () => {
    llmClient.chat.mockRejectedValue(new Error('all models failed'));
    expect(await reviewReply(input)).toBeNull();
  });
});

describe('reviewer verdict after thinking out loud', () => {
  it('reads the last verdict, even when the thinking quotes braces and JSON', async () => {
    answers('We need to check {the reply}. Maybe {"approved":true}? No: it says 90 minutes.\n{"approved":false,"feedback":"Whitening takes 60 minutes, not 90."}');
    expect(await reviewReply(input)).toMatchObject({ approved: false, feedback: 'Whitening takes 60 minutes, not 90.' });
  });

  it('gives it room to think before the verdict', async () => {
    answers('{"approved":true}');
    await reviewReply(input);
    expect(llmClient.chat.mock.calls[0][0].maxTokens).toBe(800);
  });
});
