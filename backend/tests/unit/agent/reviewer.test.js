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
    expect(maxTokens).toBeLessThan(200);
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

  it('gives no verdict when the AI is down', async () => {
    llmClient.chat.mockRejectedValue(new Error('all models failed'));
    expect(await reviewReply(input)).toBeNull();
  });
});
