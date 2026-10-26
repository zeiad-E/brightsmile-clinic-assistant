import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The model chain respects the turn's deadline and can skip the unpredictable "auto" router. */
const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.chat = { completions: { create } };
    }
  },
}));
vi.mock('../../../src/llm/engineAuth.js', () => ({ resolveEngineApiKey: vi.fn(async () => 'key') }));

const { llmClient } = await import('../../../src/llm/LlmClient.js');
const { config } = await import('../../../src/config/index.js');

async function errorOf(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err;
  }
}

beforeEach(() => {
  create.mockReset();
  create.mockImplementation(async () => {
    throw new Error('model down');
  });
});

describe('LlmClient.chat', () => {
  it('skips "auto" when asked', async () => {
    const error = await errorOf(llmClient.chat({ messages: [], skipAuto: true }));

    expect(error?.message).toBe('model down');
    const tried = create.mock.calls.map((c) => c[0].model);
    expect(tried).toEqual(config.llm.chatModels.filter((m) => m !== 'auto'));
  });

  it('stops trying more models once the deadline has passed', async () => {
    const error = await errorOf(llmClient.chat({ messages: [], deadline: Date.now() + 1000 }));

    expect(error?.message).toBe('Turn deadline reached');
    expect(create).not.toHaveBeenCalled();
  });

  it('gives a model no more time than what is left of the turn', async () => {
    create.mockImplementation(async () => ({ choices: [{ message: { content: 'ok' } }] }));
    await llmClient.chat({ messages: [], deadline: Date.now() + 5000 });

    expect(create.mock.calls[0][1].timeout).toBeLessThanOrEqual(5000);
  });
});
