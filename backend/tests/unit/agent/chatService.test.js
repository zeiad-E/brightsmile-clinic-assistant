import { beforeEach, describe, expect, it, vi } from 'vitest';

/** chatService with the database and the agent loop replaced by fakes. */
const conversations = new Map();
const saved = { messages: [], runs: [], escalations: [], traces: [] };

vi.mock('../../../src/db/supabase.js', () => ({ requireAdmin: () => ({ admin: true }), dbFor: () => ({ user: true }), publicDb: () => ({ visitor: true }) }));
vi.mock('../../../src/models/clinicModel.js', () => ({
  getSettings: vi.fn(async () => ({ assistant_enabled: true, timezone: 'Africa/Cairo', name_en: 'BrightSmile', phone: '+20 100 555 0123' })),
}));
vi.mock('../../../src/models/conversationModel.js', () => ({
  create: vi.fn(async (_db, row) => {
    const c = { id: `c${conversations.size + 1}`, assistant: 'patient', status: 'active', state: {}, turn_count: 0, off_topic_count: 0, profile_id: row.profileId, patient_id: row.patientId, visitor_hash: row.visitorHash ?? null, title: null, last_message_at: new Date().toISOString() };
    conversations.set(c.id, c);
    return c;
  }),
  findById: vi.fn(async (_db, id) => (conversations.has(id) ? structuredClone(conversations.get(id)) : null)),
  findForChat: vi.fn(async (_db, id) => (conversations.has(id) ? structuredClone(conversations.get(id)) : null)),
  findLatest: vi.fn(async (_db, { profileId, visitorHash, since }) => {
    const mine = [...conversations.values()]
      .filter((c) => (profileId ? c.profile_id === profileId : c.visitor_hash === visitorHash && !c.profile_id))
      .filter((c) => (c.last_message_at ?? '') >= since)
      .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
    return mine[0] ?? null;
  }),
  claimForPatient: vi.fn(async (_db, { visitorHash, profileId, patientId }) => {
    const moved = [...conversations.values()].filter((c) => c.visitor_hash === visitorHash && !c.profile_id);
    for (const c of moved) Object.assign(c, { profile_id: profileId, patient_id: patientId, visitor_hash: null });
    return moved.map((c) => c.id);
  }),
  update: vi.fn(async (_db, id, patch) => {
    const c = { ...conversations.get(id), ...patch };
    conversations.set(id, c);
    return c;
  }),
}));
vi.mock('../../../src/models/messageModel.js', () => ({
  insertMany: vi.fn(async (_db, rows) => saved.messages.push(...rows)),
  recentDialogue: vi.fn(async () => []),
  listForConversation: vi.fn(async (_db, id) => saved.messages.filter((m) => m.conversation_id === id).map((m, i) => ({ id: i + 1, created_at: 'now', ...m }))),
}));
vi.mock('../../../src/models/agentRunModel.js', () => ({ insert: vi.fn(async (_db, run) => saved.runs.push(run)) }));
vi.mock('../../../src/models/agentTraceModel.js', () => ({ insert: vi.fn(async (_db, row) => saved.traces.push(row)) }));
vi.mock('../../../src/models/escalationModel.js', () => ({ create: vi.fn(async (_db, e) => saved.escalations.push(e)) }));
vi.mock('../../../src/models/profileModel.js', () => ({ findIdentity: vi.fn(), namesByIds: vi.fn(async () => new Map()) }));
vi.mock('../../../src/agent/context.js', () => ({
  buildContext: vi.fn(async () => ({ clinicName: 'BrightSmile', today: { date: '2026-10-26', weekday: 'Monday', time: '10:00' }, openingHours: 'x', patient: null })),
}));
vi.mock('../../../src/agent/loop.js', () => ({
  runAgentTurn: vi.fn(),
  // what the code's own tool call returns: the AI's two messages, with a made-up result per tool
  runPlannedCall: vi.fn(async ({ name, args }) => [
    { role: 'assistant', content: '', tool_calls: [{ id: `planned_${name}`, function: { name, arguments: JSON.stringify(args) } }] },
    { role: 'tool', tool_call_id: `planned_${name}`, content: JSON.stringify(name === 'sign_in_with_phone' ? { signed_in: true } : { pending: true }) },
  ]),
}));
vi.mock('../../../src/services/memoryService.js', () => ({ scheduleSummaries: vi.fn(async () => {}) }));

const { runAgentTurn, runPlannedCall } = await import('../../../src/agent/loop.js');
const chatService = await import('../../../src/services/chatService.js');
const { getSettings } = await import('../../../src/models/clinicModel.js');
const { buildContext } = await import('../../../src/agent/context.js');
const { findIdentity } = await import('../../../src/models/profileModel.js');

const guest = { user: null, db: null };
const ok = (reply) => ({ status: 'ok', reply, iterations: 0, toolCalls: [], usage: { in: 1, out: 1 }, model: 'fake' });

beforeEach(() => {
  conversations.clear();
  saved.messages.length = 0;
  saved.runs.length = 0;
  saved.escalations.length = 0;
  saved.traces.length = 0;
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

  it('saves a trace of the turn: what the AI was given, each attempt, and what went out', async () => {
    runAgentTurn.mockImplementation(async ({ trace }) => {
      trace.note({ type: 'ai', model: 'gemini', ms: 900, finish: 'stop', content: 'Hi! How can I help?' });
      return ok('Hi! How can I help?');
    });
    const { conversation_id: id } = await chatService.sendMessage(guest, { message: 'Hello, my email is mona@example.com' });

    expect(saved.traces).toHaveLength(1);
    const { trace, ...row } = saved.traces[0];
    expect(row).toMatchObject({ conversationId: id, turn: 1, outcome: 'answered' });
    expect(trace.input).toMatchObject({ message: 'Hello, my email is [EMAIL_1]', history: [] });
    expect(trace.input.systemPrompt).toContain('CLINIC ASSISTANT RULES');
    expect(trace.attempts).toEqual([expect.objectContaining({ attempt: 1, status: 'ok', steps: [expect.objectContaining({ type: 'ai', model: 'gemini' })] })]);
    expect(trace.output).toMatchObject({ outcome: 'answered', reply: 'Hi! How can I help?' });
    expect(JSON.stringify(trace)).not.toContain('mona@example.com');
  });

  it('traces a failed turn: both attempts, why they failed, and the fallback', async () => {
    runAgentTurn.mockRejectedValueOnce(new Error('429 quota')).mockResolvedValueOnce({ status: 'broken', toolCalls: [], usage: {} });
    await chatService.sendMessage(guest, { message: 'How much is whitening?' });

    const { trace } = saved.traces[0];
    expect(trace.attempts.map((a) => [a.attempt, a.status])).toEqual([[1, 'error'], [2, 'broken']]);
    expect(trace.attempts[0].error).toBe('429 quota');
    expect(trace.notes.join()).toContain('apology sent');
  });

  it('reports progress while the turn runs, and gives the cards only with the finished reply', async () => {
    runAgentTurn.mockImplementation(async ({ ctx }) => {
      ctx.onProgress({ stage: 'tool', tool: 'check_availability' });
      ctx.emit({ type: 'slots', doctors: [] });
      return ok('Sunday at 10:00 is free.');
    });
    const events = [];

    const res = await chatService.sendMessage({ ...guest, onEvent: (type, data) => events.push([type, data]) }, { message: 'Free on Sunday?' });

    // no card while the AI is still working: a rewrite or a retry could change it
    expect(events).toEqual([
      ['conversation', { conversation_id: res.conversation_id }],
      ['status', { stage: 'thinking', text: 'Thinking…' }],
      ['status', { stage: 'tool', text: 'Checking free times…' }],
    ]);
    expect(res.cards).toEqual([{ type: 'slots', doctors: [] }]);
  });

  it('drops the cards of a failed attempt, so a retry never shows the form twice', async () => {
    runAgentTurn
      .mockImplementationOnce(async ({ ctx }) => {
        ctx.emit({ type: 'details_form', purpose: 'booking', try: 1 });
        return { status: 'unbacked_done', toolCalls: [], usage: {} };
      })
      .mockImplementationOnce(async ({ ctx }) => {
        ctx.emit({ type: 'details_form', purpose: 'booking', try: 2 });
        return ok('Just a few details and your booking is ready.');
      });
    const res = await chatService.sendMessage(guest, { message: 'Saturday at 10:00 please' });

    expect(res.cards).toEqual([{ type: 'details_form', purpose: 'booking', try: 2 }]);
  });

  it('shows one card of each kind per reply (the latest)', async () => {
    runAgentTurn.mockImplementationOnce(async ({ ctx }) => {
      ctx.emit({ type: 'slots', n: 1 });
      ctx.emit({ type: 'slots', n: 2 });
      return ok('Here are the free times.');
    });
    expect((await chatService.sendMessage(guest, { message: 'free times?' })).cards).toEqual([{ type: 'slots', n: 2 }]);
  });

  it('keeps a booking that really happened through a retry, and drops free times once the reply moved on', async () => {
    runAgentTurn
      .mockImplementationOnce(async ({ ctx }) => {
        ctx.emit({ type: 'booking_confirmed', appointment_id: 'a1' });
        throw new Error('model down');
      })
      .mockImplementationOnce(async ({ ctx }) => {
        ctx.emit({ type: 'slots', n: 1 }); // the AI re-checked the time: the patient already picked it
        return ok('Booked!');
      });
    const res = await chatService.sendMessage(guest, { message: 'yes' });

    expect(res.cards).toEqual([{ type: 'booking_confirmed', appointment_id: 'a1' }]);
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

  it('gives the retry the last 12 messages, so it still knows what was said earlier', async () => {
    const { recentDialogue } = await import('../../../src/models/messageModel.js');
    recentDialogue.mockResolvedValueOnce(Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })));
    runAgentTurn.mockRejectedValueOnce(new Error('model down')).mockResolvedValueOnce(ok('Here you go'));
    await chatService.sendMessage(guest, { message: 'prices?' });

    const [first, retry] = runAgentTurn.mock.calls.map(([args]) => args.messages);
    expect(first).toHaveLength(22); // system + 20 + this message
    expect(retry).toHaveLength(14); // system + 12 + this message
    expect(retry[1].content).toBe('m8');
  });

  describe('after the details form, the code takes the next step itself', () => {
    const choice = { service: 'Check-up', doctor: 'Sarah Mansour', date: '2026-12-01', time: '10:00' };
    const form = (purpose) => ({ purpose, full_name: 'Mona Ali', date_of_birth: '1990-03-15', phone: '+201001234567', email: 'mona@example.com' });
    const startWith = async (state) => {
      runAgentTurn.mockResolvedValue(ok('Hi'));
      const { conversation_id: id } = await chatService.sendMessage(guest, { message: 'hi' });
      conversations.get(id).state = { ...conversations.get(id).state, ...state };
      vi.clearAllMocks();
      return id;
    };

    it('prepares the booking from the notebook, and the AI replies to that result', async () => {
      const id = await startWith({ notebook: { patient: {}, booking: choice } });
      runAgentTurn.mockResolvedValue(ok('Here is your booking.'));
      await chatService.sendMessage(guest, { conversationId: id, message: 'Here are my details.', form: form('booking') });

      expect(runPlannedCall).toHaveBeenCalledTimes(1);
      expect(runPlannedCall.mock.calls[0][0]).toEqual({ name: 'propose_booking', args: choice });
      const sent = runAgentTurn.mock.calls[0][0].messages;
      expect(sent.at(-3)).toMatchObject({ role: 'user', content: 'Here are my details.' });
      expect(sent.at(-2).tool_calls[0].function.name).toBe('propose_booking');
    });

    it('signs a returning patient in, then prepares the time they had picked', async () => {
      const id = await startWith({ notebook: { patient: {}, booking: choice } });
      runAgentTurn.mockResolvedValue(ok('Welcome back!'));
      await chatService.sendMessage(guest, { conversationId: id, message: 'Here are my sign-in details.', form: form('sign_in') });

      expect(runPlannedCall.mock.calls.map(([c]) => c.name)).toEqual(['sign_in_with_phone', 'propose_booking']);
    });

    it('leaves it to the AI when no time was picked yet', async () => {
      const id = await startWith({});
      runAgentTurn.mockResolvedValue(ok('Which day suits you?'));
      await chatService.sendMessage(guest, { conversationId: id, message: 'Here are my details.', form: form('booking') });

      expect(runPlannedCall).not.toHaveBeenCalled();
    });
  });

  describe('the notebook and the details form', () => {
    const stateGiven = () => buildContext.mock.calls.at(-1)[0].state;

    it('writes down a phone the guest types, as a placeholder', async () => {
      runAgentTurn.mockResolvedValue(ok('Thanks!'));
      const res = await chatService.sendMessage(guest, { message: 'my number is 0100 123 4567' });

      expect(stateGiven().notebook.patient).toEqual({ phone: '[PHONE_1]' });
      expect(conversations.get(res.conversation_id).state.notebook.patient).toEqual({ phone: '[PHONE_1]' });
    });

    it('puts the form’s values in the notebook as placeholders and tells the AI the form just arrived, once', async () => {
      runAgentTurn.mockResolvedValue(ok('Here is your summary'));
      let formSent;
      const original = buildContext.getMockImplementation();
      buildContext.mockImplementationOnce(async (args) => {
        formSent = args.state.formSent; // as the AI's context is built (it is cleared right after)
        return original(args);
      });
      const form = { purpose: 'booking', full_name: 'Mona Ali', date_of_birth: '1990-03-15', phone: '+201001234567', email: 'mona@example.com' };
      const res = await chatService.sendMessage(guest, { message: 'Here are my details.', form });

      expect(formSent).toBe('booking');
      expect(stateGiven()).toMatchObject({ notebook: { patient: { full_name: 'Mona Ali', date_of_birth: '[DOB_1]', phone: '[PHONE_1]', email: '[EMAIL_1]' } } });
      const stored = conversations.get(res.conversation_id).state;
      expect(stored.placeholders).toMatchObject({ '[DOB_1]': '1990-03-15', '[PHONE_1]': '+201001234567', '[EMAIL_1]': 'mona@example.com' });
      expect(stored.formSent).toBeUndefined(); // news for that turn only
      expect(saved.messages[0]).toMatchObject({ role: 'user', content: 'Here are my details.' });
    });
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

describe('guest chats and the visitor cookie', () => {
  const patient = { user: { id: 'user-1', role: 'patient', patientId: 'p1' } };
  const browser = (hash) => ({ user: null, visitorHash: hash });
  const chat = (id, extra = {}) =>
    conversations.set(id, { id, assistant: 'patient', status: 'active', state: {}, turn_count: 1, off_topic_count: 0, profile_id: null, patient_id: null, visitor_hash: null, last_message_at: new Date().toISOString(), ...extra });

  it('starts a guest chat under the browser’s visitor fingerprint, a patient’s under their account', async () => {
    runAgentTurn.mockResolvedValue(ok('Hi!'));
    const asGuest = await chatService.sendMessage(browser('v1'), { message: 'hi' });
    const asPatient = await chatService.sendMessage({ ...patient, visitorHash: 'v1' }, { message: 'hi' });

    expect(conversations.get(asGuest.conversation_id)).toMatchObject({ visitor_hash: 'v1', profile_id: null });
    expect(conversations.get(asPatient.conversation_id)).toMatchObject({ visitor_hash: null, profile_id: 'user-1' });
  });

  it('lets only the browser that started a guest chat continue or read it', async () => {
    runAgentTurn.mockResolvedValue(ok('Sure.'));
    chat('g', { visitor_hash: 'v1' });

    expect((await chatService.sendMessage(browser('v1'), { conversationId: 'g', message: 'hi' })).reply).toBe('Sure.');
    await expect(chatService.sendMessage(browser('v2'), { conversationId: 'g', message: 'hi' })).rejects.toMatchObject({ status: 404 });
    await expect(chatService.sendMessage(browser(null), { conversationId: 'g', message: 'hi' })).rejects.toMatchObject({ status: 404 });
    await expect(chatService.getConversation(browser('v2'), 'g')).rejects.toMatchObject({ status: 404 });
  });

  it('never lets a signed-in patient take a stranger’s guest chat', async () => {
    chat('g', { visitor_hash: 'v1', state: { placeholders: { '[PHONE_1]': '01000000000' } } });

    await expect(chatService.sendMessage({ ...patient, visitorHash: null }, { conversationId: 'g', message: 'hi' })).rejects.toMatchObject({ status: 404 });
    expect(conversations.get('g').profile_id).toBeNull();
  });

  it('moves a patient’s own guest chat into their account when they continue it', async () => {
    runAgentTurn.mockResolvedValue(ok('Welcome back.'));
    chat('g', { visitor_hash: 'v1' });
    await chatService.sendMessage({ ...patient, visitorHash: 'v1' }, { conversationId: 'g', message: 'hi' });

    expect(conversations.get('g')).toMatchObject({ profile_id: 'user-1', patient_id: 'p1', visitor_hash: null });
  });

  it('lets the first browser to come back adopt a guest chat from before visitor cookies', async () => {
    runAgentTurn.mockResolvedValue(ok('Hi again.'));
    chat('old');
    await chatService.sendMessage(browser('v1'), { conversationId: 'old', message: 'hi' });

    expect(conversations.get('old').visitor_hash).toBe('v1');
    await expect(chatService.getConversation(browser('v2'), 'old')).rejects.toMatchObject({ status: 404 });
  });

  describe('currentConversation (coming back to the site)', () => {
    it('gives a guest their latest chat, with its messages', async () => {
      chat('older', { visitor_hash: 'v1', last_message_at: new Date(Date.now() - 86_400_000).toISOString() });
      chat('newer', { visitor_hash: 'v1' });
      saved.messages.push({ conversation_id: 'newer', role: 'user', content: 'Hello' });

      const { conversation } = await chatService.currentConversation(browser('v1'));
      expect(conversation).toMatchObject({ id: 'newer', messages: [{ role: 'user', content: 'Hello' }] });
    });

    it('gives a signed-in patient their latest chat from their account', async () => {
      chat('mine', { profile_id: 'user-1', patient_id: 'p1' });
      expect((await chatService.currentConversation(patient)).conversation.id).toBe('mine');
    });

    it('has nothing for a new visitor, someone else’s browser, an old chat or a full one', async () => {
      chat('g', { visitor_hash: 'v1' });
      chat('stale', { visitor_hash: 'v3', last_message_at: new Date(Date.now() - 31 * 86_400_000).toISOString() });
      chat('full', { visitor_hash: 'v4', turn_count: 60 });

      expect(await chatService.currentConversation(browser(null))).toEqual({ conversation: null });
      expect(await chatService.currentConversation(browser('v2'))).toEqual({ conversation: null });
      expect(await chatService.currentConversation(browser('v3'))).toEqual({ conversation: null });
      expect(await chatService.currentConversation(browser('v4'))).toEqual({ conversation: null });
    });
  });

  describe('claimVisitorChats (signing in, signing up, booking)', () => {
    it('moves every ownerless chat of this browser to the patient, and nobody else’s', async () => {
      findIdentity.mockResolvedValue({ id: 'user-1', role: 'patient', patientId: 'p1' });
      chat('a', { visitor_hash: 'v1' });
      chat('b', { visitor_hash: 'v1' });
      chat('other', { visitor_hash: 'v2' });

      expect(await chatService.claimVisitorChats({ visitorHash: 'v1', profileId: 'user-1' })).toEqual(['a', 'b']);
      expect(conversations.get('a')).toMatchObject({ profile_id: 'user-1', patient_id: 'p1', visitor_hash: null });
      expect(conversations.get('other').profile_id).toBeNull();
    });

    it('gives a team account nothing, and does nothing without a cookie', async () => {
      findIdentity.mockResolvedValue({ id: 'staff-1', role: 'staff', patientId: null });
      chat('a', { visitor_hash: 'v1' });

      expect(await chatService.claimVisitorChats({ visitorHash: 'v1', profileId: 'staff-1' })).toEqual([]);
      expect(await chatService.claimVisitorChats({ visitorHash: null, profileId: 'user-1' })).toEqual([]);
      expect(conversations.get('a').profile_id).toBeNull();
    });
  });
});
