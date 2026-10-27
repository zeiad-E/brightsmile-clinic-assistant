import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AppError } from '../../../src/utils/AppError.js';

/** POST /api/chat/stream: progress, cards and the checked reply as Server-Sent Events. */
vi.mock('../../../src/services/chatService.js', () => ({ sendMessage: vi.fn(), getConversation: vi.fn(), listMine: vi.fn() }));

const chatService = await import('../../../src/services/chatService.js');
const { createApp } = await import('../../../src/app.js');
const { replyChunks } = await import('../../../src/utils/eventStream.js');
const { progressEvent } = await import('../../../src/agent/progress.js');
const { createLimiter } = await import('../../../src/services/capacity/limiter.js');

const app = createApp({ rateLimit: false });

/** "event: x\ndata: {...}\n\n" blocks → [{ type, data }] (heartbeat comments are skipped). */
function parseEvents(text) {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => {
      const [, type] = /^event: (.+)$/m.exec(block);
      const [, data] = /^data: (.+)$/m.exec(block);
      return { type, data: JSON.parse(data) };
    });
}

const result = { conversation_id: 'c1', reply: 'Dr. Sarah is free on Sunday at 10:00.', cards: [{ type: 'slots' }], session: null, status: 'active' };

beforeEach(() => vi.clearAllMocks());

describe('chat stream', () => {
  it('sends progress and cards as they happen, then the reply in pieces, then done', async () => {
    chatService.sendMessage.mockImplementation(async ({ onEvent }) => {
      onEvent('conversation', { conversation_id: 'c1' });
      onEvent('status', { stage: 'tool', text: 'Checking free times…' });
      onEvent('card', { type: 'slots' });
      return result;
    });

    const res = await request(app).post('/api/chat/stream').send({ message: 'Any time on Sunday?' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseEvents(res.text);
    expect(events.map((e) => e.type).filter((t, i, all) => t !== all[i - 1])).toEqual(['conversation', 'status', 'card', 'token', 'done']);
    expect(events.filter((e) => e.type === 'token').map((e) => e.data.text).join('')).toBe(result.reply);
    expect(events.at(-1).data).toEqual(result);
  });

  it('passes the message, conversation and caller to the same chat service as the JSON endpoint', async () => {
    chatService.sendMessage.mockResolvedValue(result);
    const id = '11111111-2222-4333-8444-555555555555';

    await request(app).post('/api/chat/stream').send({ message: 'Hi', conversation_id: id, language: 'ar' });

    const [caller, input] = chatService.sendMessage.mock.calls[0];
    expect(input).toEqual({ conversationId: id, message: 'Hi', language: 'ar' });
    expect(typeof caller.onEvent).toBe('function');
  });

  it('turns a failure into an error event with the usual error shape', async () => {
    chatService.sendMessage.mockRejectedValue(new AppError(503, 'assistant_busy', 'Busy.', { retry_after_seconds: 15 }));

    const events = parseEvents((await request(app).post('/api/chat/stream').send({ message: 'Hi' })).text);

    expect(events).toEqual([{ type: 'error', data: { status: 503, error: 'assistant_busy', message: 'Busy.', details: { retry_after_seconds: 15 } } }]);
  });

  it('hides the details of an unexpected failure', async () => {
    chatService.sendMessage.mockRejectedValue(new Error('secret stack detail'));

    const [event] = parseEvents((await request(app).post('/api/chat/stream').send({ message: 'Hi' })).text);

    expect(event).toEqual({ type: 'error', data: { status: 500, error: 'internal_error', message: 'Something went wrong on our side.' } });
  });

  it('validates the message before opening a stream (plain JSON error)', async () => {
    const res = await request(app).post('/api/chat/stream').send({ message: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });
});

describe('stream pieces', () => {
  it('splits a reply into a few words per piece without losing spaces or line breaks', () => {
    const text = 'Hello Mona,\n\nYour visit is on Sunday at 10:00.  See you!';
    const chunks = replyChunks(text);

    expect(chunks.join('')).toBe(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(replyChunks('')).toEqual([]);
  });

  it('describes progress in the patient’s language without naming internal tools', () => {
    expect(progressEvent({ stage: 'tool', tool: 'check_availability' }, 'en').text).toBe('Checking free times…');
    expect(progressEvent({ stage: 'tool', tool: 'check_availability' }, 'ar').text).toMatch(/المواعيد/);
    expect(progressEvent({ stage: 'tool', tool: 'decline_request' }, 'en').text).toBe('Thinking…');
    expect(progressEvent({ stage: 'queued', position: 3 }, 'en')).toMatchObject({ stage: 'queued', position: 3, text: expect.stringContaining('3') });
  });
});

describe('waiting line positions', () => {
  it('tells each waiting turn its place, and again when the line moves', async () => {
    const limiter = createLimiter({ max: 1, queueMax: 5, maxWaitMs: 5_000 });
    let release;
    const first = limiter.run(() => new Promise((resolve) => (release = resolve)));
    const positions = { b: [], c: [] };
    const second = limiter.run(async () => {}, { onQueued: (p) => positions.b.push(p) });
    const third = limiter.run(async () => {}, { onQueued: (p) => positions.c.push(p) });

    release();
    await Promise.all([first, second, third]);

    expect(positions.b).toEqual([1]);
    expect(positions.c).toEqual([2, 1]);
  });
});
