import { beforeEach, describe, expect, it, vi } from 'vitest';

/** chatService with the database and the agent loop replaced by fakes. */
const conversations = new Map();
const saved = { messages: [], runs: [], escalations: [] };

vi.mock('../../../src/db/supabase.js', () => ({ requireAdmin: () => ({ admin: true }), dbFor: () => ({ user: true }), publicDb: () => ({ visitor: true }) }));
vi.mock('../../../src/models/clinicModel.js', () => ({
  getSettings: vi.fn(async () => ({ assistant_enabled: true, timezone: 'Africa/Cairo', name_en: 'BrightSmile', phone: '+20 100 555 0123' })),
}));
vi.mock('../../../src/models/conversationModel.js', () => ({
  create: vi.fn(async (_db, row) => {
    const c = { id: `c${conversations.size + 1}`, assistant: 'patient', status: 'active', state: {}, turn_count: 0, off_topic_count: 0, profile_id: row.profileId, patient_id: row.patientId, title: null };
    conversations.set(c.id, c);
    return c;
  }),
  findById: vi.fn(async (_db, id) => (conversations.has(id) ? structuredClone(conversations.get(id)) : null)),
  update: vi.fn(async (_db, id, patch) => {
    const c = { ...conversations.get(id), ...patch };
    conversations.set(id, c);
    return c;
  }),
}));
vi.mock('../../../src/models/messageModel.js', () => ({
  insertMany: vi.fn(async (_db, rows) => saved.messages.push(...rows)),
  recentDialogue: vi.fn(async () => []),
}));
vi.mock('../../../src/models/agentRunModel.js', () => ({ insert: vi.fn(async (_db, run) => saved.runs.push(run)) }));
vi.mock('../../../src/models/escalationModel.js', () => ({ create: vi.fn(async (_db, e) => saved.escalations.push(e)) }));
vi.mock('../../../src/models/profileModel.js', () => ({ findIdentity: vi.fn() }));
vi.mock('../../../src/agent/context.js', () => ({
  buildContext: vi.fn(async () => ({ clinicName: 'BrightSmile', today: { date: '2026-10-26', weekday: 'Monday', time: '10:00' }, openingHours: 'x', patient: null })),
}));
vi.mock('../../../src/agent/loop.js', () => ({ runAgentTurn: vi.fn() }));
vi.mock('../../../src/services/memoryService.js', () => ({ scheduleSummaries: vi.fn(async () => {}) }));

const { runAgentTurn } = await import('../../../src/agent/loop.js');
const chatService = await import('../../../src/services/chatService.js');
const { getSettings } = await import('../../../src/models/clinicModel.js');
const { buildContext } = await import('../../../src/agent/context.js');

const guest = { user: null, db: null };
const ok = (reply) => ({ status: 'ok', reply, iterations: 0, toolCalls: [], usage: { in: 1, out: 1 }, model: 'fake' });

beforeEach(() => {
  conversations.clear();
  saved.messages.length = 0;
  saved.runs.length = 0;
  saved.escalations.length = 0;
  vi.clearAllMocks();
});

describe('chatService.sendMessage', () => {
  it('answers, saves masked messages, and records the run', async () => {
    runAgentTurn.mockResolvedValue(ok('Hi! How can I help?'));
    const res = await chatService.sendMessage(guest, { message: 'Hello, my email is mona@example.com' });

    expect(res.reply).toBe('Hi! How can I help?');
    expect(saved.messages[0]).toMatchObject({ role: 'user', content: 'Hello, my email is [EMAIL_1]' });
    expect(saved.runs[0]).toMatchObject({ outcome: 'answered', retries: 0 });
    expect(conversations.get(res.conversation_id)).toMatchObject({ turn_count: 1, state: { placeholders: { '[EMAIL_1]': 'mona@example.com' } } });
  });

  it('replies in the language of the latest message, not the page', async () => {
    runAgentTurn.mockResolvedValue(ok('تحت أمرك'));
    const usedLanguage = () => buildContext.mock.calls.at(-1)[0].language;

    const { conversation_id: id } = await chatService.sendMessage(guest, { message: 'كنت عاوز اعرف تكلفة ال whitening كام', language: 'en' });
    expect(usedLanguage()).toBe('ar');

    await chatService.sendMessage(guest, { conversationId: id, message: 'ok', language: 'en' });
    expect(usedLanguage()).toBe('ar'); // too short to prove a switch

    await chatService.sendMessage(guest, { conversationId: id, message: 'Great, how much does it cost?', language: 'ar' });
    expect(usedLanguage()).toBe('en');
  });

  it('tells the assistant the reviewer’s verdict on the next turn, once', async () => {
    runAgentTurn.mockResolvedValue({ ...ok('Hello'), review: { approved: true, feedback: null } });
    const { conversation_id: id } = await chatService.sendMessage(guest, { message: 'Hello there my friend' });
    expect(conversations.get(id).state.lastReview).toEqual({ approved: true, feedback: null });
    expect(saved.escalations).toHaveLength(0);

    runAgentTurn.mockResolvedValue(ok('Hello'));
    await chatService.sendMessage(guest, { conversationId: id, message: 'Hello again my friend' });
    expect(buildContext.mock.calls.at(-1)[0].state.lastReview ?? null).toBeNull(); // read, then cleared
    expect(conversations.get(id).state.lastReview).toBeUndefined();
  });

  it('asks a person to look when a reply went out without the reviewer’s approval', async () => {
    runAgentTurn.mockResolvedValue({ ...ok('Whitening takes 90 minutes.'), review: { approved: false, feedback: 'It takes 60 minutes.' } });
    const res = await chatService.sendMessage(guest, { message: 'How long is whitening?' });

    expect(res.reply).toBe('Whitening takes 90 minutes.');
    expect(saved.escalations).toEqual([expect.objectContaining({ urgency: 'low', reason: expect.stringContaining('It takes 60 minutes.') })]);
  });

  it('reports progress and cards to a streaming caller while the turn runs', async () => {
    runAgentTurn.mockImplementation(async ({ ctx }) => {
      ctx.onProgress({ stage: 'tool', tool: 'check_availability' });
      ctx.emit({ type: 'slots', doctors: [] });
      return ok('Sunday at 10:00 is free.');
    });
    const events = [];

    const res = await chatService.sendMessage({ ...guest, onEvent: (type, data) => events.push([type, data]) }, { message: 'Free on Sunday?' });

    expect(events).toEqual([
      ['conversation', { conversation_id: res.conversation_id }],
      ['status', { stage: 'thinking', text: 'Thinking…' }],
      ['status', { stage: 'tool', text: 'Checking free times…' }],
      ['card', { type: 'slots', doctors: [] }],
    ]);
    expect(res.cards).toEqual([{ type: 'slots', doctors: [] }]);
  });

  it('never stores one-time codes, even in the conversation state', async () => {
    runAgentTurn.mockResolvedValue(ok('Checking…'));
    const res = await chatService.sendMessage(guest, { message: 'my code is K7Q4-9M2X' });

    expect(saved.messages[0].content).toBe('my code is [CODE_1]');
    expect(conversations.get(res.conversation_id).state.placeholders).toEqual({});
  });

  it('handles an emergency without the AI: fixed reply + urgent escalation', async () => {
    const res = await chatService.sendMessage(guest, { message: "I can't breathe and my face is swelling" });

    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(saved.escalations[0].urgency).toBe('urgent');
    expect(res.reply).toMatch(/emergency/i);
    expect(res.status).toBe('handed_off');
  });

  it('retries once, then the code hands over and flags the conversation', async () => {
    runAgentTurn.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ status: 'max_iterations', toolCalls: [], usage: {} });
    const res = await chatService.sendMessage(guest, { message: 'Book me something' });

    expect(runAgentTurn).toHaveBeenCalledTimes(2);
    expect(saved.escalations).toHaveLength(1);
    expect(res.status).toBe('needs_attention');
    expect(saved.runs[0]).toMatchObject({ outcome: 'fallback', retries: 2 });
  });

  it('recovers on the retry without bothering staff', async () => {
    runAgentTurn.mockRejectedValueOnce(new Error('model down')).mockResolvedValueOnce(ok('Here you go'));
    const res = await chatService.sendMessage(guest, { message: 'prices?' });

    expect(res.reply).toBe('Here you go');
    expect(saved.escalations).toHaveLength(0);
    expect(saved.runs[0].retries).toBe(1);
  });

  it('declines off-topic requests with a fixed reply, and reminds after the third', async () => {
    runAgentTurn.mockImplementation(async ({ ctx }) => {
      ctx.endTurn = { kind: 'off_topic' };
      return { status: 'ended', toolCalls: [{ name: 'decline_request', ok: true }], usage: {} };
    });
    const first = await chatService.sendMessage(guest, { message: 'solve 2x+3=7' });
    const id = first.conversation_id;
    await chatService.sendMessage(guest, { conversationId: id, message: 'weather?' });
    const third = await chatService.sendMessage(guest, { conversationId: id, message: 'write a poem' });

    expect(first.reply).toMatch(/clinic matters/);
    expect(third.reply).toMatch(/my role here is clinic matters only/);
    expect(conversations.get(id).off_topic_count).toBe(3);
    expect(saved.runs.every((r) => r.outcome === 'refused')).toBe(true);
  });

  it('locks a signed-in patient’s conversation to them', async () => {
    conversations.set('mine', { id: 'mine', assistant: 'patient', status: 'active', state: {}, turn_count: 2, off_topic_count: 0, profile_id: 'user-1' });

    await expect(chatService.sendMessage(guest, { conversationId: 'mine', message: 'hi' })).rejects.toMatchObject({ status: 401 });
    await expect(chatService.sendMessage({ user: { id: 'user-2', role: 'patient', patientId: 'p2' } }, { conversationId: 'mine', message: 'hi' })).rejects.toMatchObject({ status: 404 });
  });

  it('respects the owner’s pause switch', async () => {
    getSettings.mockResolvedValueOnce({ assistant_enabled: false, phone: '+20 100 555 0123', timezone: 'Africa/Cairo' });
    const res = await chatService.sendMessage(guest, { message: 'hi' });

    expect(res.status).toBe('paused');
    expect(res.reply).toContain('+20 100 555 0123');
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it('stops very long conversations', async () => {
    conversations.set('long', { id: 'long', assistant: 'patient', status: 'active', state: {}, turn_count: 60, off_topic_count: 0 });
    const res = await chatService.sendMessage(guest, { conversationId: 'long', message: 'hi' });

    expect(res.status).toBe('turn_limit');
    expect(runAgentTurn).not.toHaveBeenCalled();
  });
});
