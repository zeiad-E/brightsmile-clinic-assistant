import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Memory rules: what notes are allowed, de-duplication, caps, recall, summaries, consolidation. */
const store = { notes: [], jobs: [], conversations: new Map(), messages: [] };

vi.mock('../../../src/db/supabase.js', () => ({ requireAdmin: () => ({ admin: true }), adminAs: (actor, via) => ({ actor, via }) }));
vi.mock('../../../src/llm/LlmClient.js', () => ({ llmClient: { chat: vi.fn(), embed: vi.fn(async () => [[0.1, 0.2]]) } }));
vi.mock('../../../src/models/memoryModel.js', () => ({
  listForPatient: vi.fn(async () => store.notes),
  insert: vi.fn(async (_db, row) => store.notes.push({ id: `n${store.notes.length + 1}`, ...row })),
  update: vi.fn(async (_db, id, patch) => Object.assign(store.notes.find((n) => n.id === id), patch)),
  removeForPatient: vi.fn(async (_db, _p, { source } = {}) => {
    store.notes = source ? store.notes.filter((n) => n.source !== source) : [];
  }),
}));
vi.mock('../../../src/models/jobModel.js', () => ({
  enqueue: vi.fn(async (_db, job) => store.jobs.push(job)),
  enqueueOrDelay: vi.fn(async (_db, job) => store.jobs.push(job)),
}));
vi.mock('../../../src/models/conversationModel.js', () => ({
  findById: vi.fn(async (_db, id) => store.conversations.get(id)),
  update: vi.fn(async (_db, id, patch) => Object.assign(store.conversations.get(id), patch)),
  matchSummaries: vi.fn(async () => [
    { conversation_id: 'current', summary: 'this chat', last_message_at: '2026-10-26T10:00:00Z' },
    { conversation_id: 'old-1', summary: 'Asked about whitening price', last_message_at: '2026-09-01T10:00:00Z' },
  ]),
}));
vi.mock('../../../src/models/messageModel.js', () => ({ listForConversation: vi.fn(async () => store.messages) }));

const { llmClient } = await import('../../../src/llm/LlmClient.js');
const memory = await import('../../../src/services/memoryService.js');

beforeEach(() => {
  store.notes = [];
  store.jobs.length = 0;
  store.conversations.clear();
  store.messages = [];
  vi.clearAllMocks();
});

describe('note rules', () => {
  it.each([
    'Prefers afternoon appointments',
    'Writes in Egyptian Arabic; reply the same way',
    'Lives in Alexandria, prefers slots after 1 pm',
    'Prefers short replies',
    'يفضل المواعيد المسائية',
  ])('accepts a kind, practical note: %s', (note) => {
    expect(memory.checkNote(note)).toBeNull();
  });

  it.each([
    ['Is diabetic and takes medication', /health/],
    ['Allergic to penicillin', /health/],
    ['حامل في الشهر الخامس', /health/],
    ['Patient is rude and annoying', /kindly/],
    ['Phone is [PHONE_1]', /contact/],
    ['email mona@example.com', /contact/],
    ['ok', /3–200/],
  ])('rejects: %s', (note, reason) => {
    expect(memory.checkNote(note)).toMatch(reason);
  });
});

describe('remember', () => {
  const base = { patientId: 'p1', conversationId: 'c1' };

  it('saves a new note as written by the assistant', async () => {
    const result = await memory.remember({ ...base, kind: 'preference', content: 'Prefers morning appointments' });

    expect(result).toEqual({ saved: true });
    expect(store.notes[0]).toMatchObject({ patient_id: 'p1', source: 'agent', kind: 'preference' });
  });

  it('updates a very similar note instead of duplicating it', async () => {
    store.notes = [{ id: 'n1', kind: 'preference', content: 'Prefers morning appointments with Dr Sarah', source: 'agent' }];
    const result = await memory.remember({ ...base, kind: 'preference', content: 'Prefers morning appointments with Dr Karim' });

    expect(result).toMatchObject({ saved: true, updated: true });
    expect(store.notes).toHaveLength(1);
    expect(store.notes[0].content).toBe('Prefers morning appointments with Dr Karim');
  });

  it('never overwrites a correction from the clinic owner', async () => {
    store.notes = [{ id: 'n1', kind: 'preference', content: 'Prefers morning appointments', source: 'owner' }];
    const result = await memory.remember({ ...base, kind: 'preference', content: 'Prefers morning appointments' });

    expect(result.saved).toBe(false);
    expect(store.notes[0].content).toBe('Prefers morning appointments');
  });

  it('asks for a tidy-up when the list grows long, and stops at the hard cap', async () => {
    store.notes = Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, kind: 'logistics', content: `Unique detail number ${i} xyz${i}`, source: 'agent' }));
    await memory.remember({ ...base, kind: 'preference', content: 'Prefers Saturday visits' });
    expect(store.jobs.some((j) => j.type === 'consolidate_memories')).toBe(true);

    store.notes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, kind: 'logistics', content: `Unique detail number ${i} xyz${i}`, source: 'agent' }));
    const full = await memory.remember({ ...base, kind: 'preference', content: 'Prefers Sunday visits' });
    expect(full.saved).toBe(false);
  });

  it('refuses health information', async () => {
    const result = await memory.remember({ ...base, kind: 'preference', content: 'Has asthma' });
    expect(result.error).toBe('note_rejected');
    expect(store.notes).toHaveLength(0);
  });
});

describe('recall', () => {
  it('finds earlier conversations but never the current one', async () => {
    const found = await memory.recall({ patientId: 'p1', currentConversationId: 'current', question: 'whitening' });

    expect(found).toEqual([{ date: '2026-09-01', summary: 'Asked about whitening price' }]);
  });
});

describe('summaries', () => {
  it('does not summarise a conversation that is still active', async () => {
    store.conversations.set('c1', { id: 'c1', last_message_at: new Date().toISOString(), patient_id: 'p1' });
    await memory.finalizeConversation({ conversationId: 'c1' });

    expect(llmClient.chat).not.toHaveBeenCalled();
  });

  it('summarises a quiet conversation and stores an embedding for recall', async () => {
    store.conversations.set('c1', { id: 'c1', last_message_at: '2026-10-01T10:00:00Z', patient_id: 'p1' });
    store.messages = [
      { role: 'user', content: 'How much is whitening?' },
      { role: 'assistant', content: '4500 EGP.' },
    ];
    llmClient.chat.mockResolvedValue({ choices: [{ message: { content: 'Asked about whitening price (4500 EGP).' } }] });
    await memory.finalizeConversation({ conversationId: 'c1' });

    expect(store.conversations.get('c1')).toMatchObject({ summary: 'Asked about whitening price (4500 EGP).', summary_embedding: '[0.1,0.2]' });
  });

  it('schedules a rolling summary only once older messages fall outside the window', async () => {
    await memory.scheduleSummaries({ id: 'c1' }, 3);
    expect(store.jobs.map((j) => j.type)).toEqual(['finalize_conversation']);

    store.jobs.length = 0;
    await memory.scheduleSummaries({ id: 'c1' }, 10);
    expect(store.jobs.map((j) => j.type)).toEqual(['finalize_conversation', 'summarize_conversation']);
  });
});

describe('consolidation', () => {
  it('merges agent notes but keeps the owner’s corrections untouched', async () => {
    store.notes = [
      { id: 'o1', kind: 'preference', content: 'Do not offer Dr Karim', source: 'owner' },
      ...Array.from({ length: 16 }, (_, i) => ({ id: `a${i}`, kind: 'preference', content: `Prefers mornings ${i}`, source: 'agent' })),
    ];
    llmClient.chat.mockResolvedValue({
      choices: [{ message: { content: 'Here: [{"kind":"preference","content":"Prefers mornings"},{"kind":"logistics","content":"Has diabetes"}]' } }],
    });
    await memory.consolidateMemories({ patientId: 'p1' });

    expect(store.notes.map((n) => n.content)).toEqual(['Do not offer Dr Karim', 'Prefers mornings']); // health note dropped
  });
});
