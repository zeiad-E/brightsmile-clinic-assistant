import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { admin, api, app, cleanup, emailFor, freeSlots, nameFor, newBrowser, phoneFor, RUN, tracked, waitForMail } from './helpers.js';
import { dayInZone, timeInZone } from '../../src/utils/clinicTime.js';

/**
 * The patient assistant through the real stack — HTTP, chat service, tools, booking
 * services, Supabase — with only the AI replaced by a script, so every step is exact.
 * (The real AI is measured by the agent evals: npm run eval:agent.)
 *
 * Each test queues what the "AI" answers next: a tool call, or a final text.
 */
const ai = vi.hoisted(() => ({ script: [], calls: 0 }));

vi.mock('../../src/llm/LlmClient.js', () => ({
  llmClient: {
    chat: vi.fn(async () => {
      ai.calls += 1;
      const step = ai.script.shift() ?? { text: 'OK.' };
      const message = step.tool
        ? { role: 'assistant', content: '', tool_calls: [{ id: `call_${ai.calls}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) } }] }
        : { role: 'assistant', content: step.text };
      return { model: 'scripted', choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    }),
    embed: vi.fn(async (texts) => texts.map(() => Array(768).fill(0))),
  },
}));

const CHECK_UP = '5eed0000-0000-4000-a000-000000000201'; // seed: check-up, Dr. Sarah
const CLEANING = '5eed0000-0000-4000-a000-000000000202'; // seed: teeth cleaning, hygienist Nadia
const SARAH = '5eed0000-0000-4000-a000-000000000101';

const { llmClient } = await import('../../src/llm/LlmClient.js');
const chatCalls = () => llmClient.chat.mock.calls;

// A guest chat belongs to the browser that started it (visitor cookie): pass `agent` to keep its cookies.
const say = (message, { conversationId, token, agent } = {}) => api('post', '/chat', { token, agent, body: { message, conversation_id: conversationId } });
const state = {};
let slot;

beforeAll(async () => {
  [slot] = await freeSlots({ serviceId: CHECK_UP, staffId: SARAH, count: 1 });
});

afterAll(async () => {
  console.log(`cleanup (run ${RUN}):`, await cleanup());
});

describe('creating an account through the chat', () => {
  const email = emailFor('chatsignup');
  const name = nameFor('Chat Signup');
  const sixDigits = (mail) => /\b(\d{6})\b/.exec(mail.text)?.[1];

  it('emails a code, then makes the account, shows the code on screen and keeps it from the AI', async () => {
    const browser = newBrowser();
    const phone = phoneFor();
    ai.script.push({ tool: 'start_sign_up', args: { full_name: name, date_of_birth: '[DOB_1]', phone: '[PHONE_1]', email: '[EMAIL_1]' } }, { text: 'Please type the code from your email.' });
    const first = await say(`First visit, I only want an account. I'm ${name}, born 1991-05-05, phone ${phone}, email ${email}.`, { agent: browser });
    expect(first.status).toBe(200);
    tracked.conversations.push(first.body.conversation_id);
    const { data: before } = await admin.from('patients').select('id').eq('email', email).maybeSingle();
    expect(before).toBeNull(); // nothing is created until the code is right

    const code = sixDigits(await waitForMail(email, 'sign-in code'));
    const seen = chatCalls().length;
    ai.script.push({ tool: 'finish_sign_up', args: { code: '[CODE_1]' } }, { text: 'Your account is ready!' });
    const second = await say(`The code is ${code}`, { conversationId: first.body.conversation_id, agent: browser });

    expect(second.status).toBe(200);
    expect(second.body.sign_in_ticket).toBeTruthy();
    const card = second.body.cards.find((c) => c.type === 'personal_code');
    expect(card.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(JSON.stringify(chatCalls().slice(seen))).not.toContain(card.code);

    const swapped = await api('post', '/auth/ticket', { body: { ticket: second.body.sign_in_ticket }, agent: newBrowser() });
    expect(swapped.status).toBe(200);
    expect(swapped.body.user.role).toBe('patient');
  });
});

describe('booking through the chat', () => {
  it('the assistant can propose but not book in the same turn (the confirmation gate)', async () => {
    state.email = emailFor('chat');
    state.browser = newBrowser();
    ai.script.push(
      {
        tool: 'propose_booking',
        args: { service: 'check-up', doctor: 'Sarah Mansour', date: dayInZone(new Date(slot)), time: timeInZone(slot), full_name: nameFor('Chat Guest'), date_of_birth: '[DOB_1]', email: '[EMAIL_1]' },
      },
      { tool: 'confirm_pending_action' },
      { text: 'Shall I book it?' },
    );

    const res = await say(`First visit. I'm ${nameFor('Chat Guest')}, born 1991-05-05, email ${state.email}. Please book that check-up.`, { agent: state.browser });

    expect(res.status).toBe(200);
    state.conversationId = res.body.conversation_id;
    tracked.conversations.push(state.conversationId);
    expect(res.body.cards.map((c) => c.type)).toContain('booking_summary');
    const { data: patient } = await admin.from('patients').select('id').eq('email', state.email).maybeSingle();
    expect(patient).toBeNull(); // nothing booked yet

    // The patient's details never reach the stored chat: only placeholders do.
    const { data: messages } = await admin.from('messages').select('role, content').eq('conversation_id', state.conversationId);
    const userText = messages.find((m) => m.role === 'user').content;
    expect(userText).toContain('[EMAIL_1]');
    expect(userText).not.toContain(state.email);
  });

  it('after the patient says yes: a real booking, a new account, and a sign-in ticket', async () => {
    ai.script.push({ tool: 'confirm_pending_action' }, { text: 'Booked!' });

    const res = await say('Yes, book it.', { conversationId: state.conversationId, agent: state.browser });

    expect(res.status).toBe(200);
    expect(res.body.session).toBeUndefined();
    expect(res.body.sign_in_ticket).toBeTruthy();

    // The browser swaps the ticket for a session, once.
    const browser = newBrowser();
    const swapped = await api('post', '/auth/ticket', { body: { ticket: res.body.sign_in_ticket }, agent: browser });
    expect(swapped.status).toBe(200);
    expect(swapped.headers['set-cookie'][0]).toMatch(/^bs_rt=.*HttpOnly/);
    state.token = swapped.body.access_token;
    expect((await api('post', '/auth/ticket', { body: { ticket: res.body.sign_in_ticket } })).status).toBe(401);
    const { data: patient } = await admin.from('patients').select('id, profile_id').eq('email', state.email).single();
    const { data: booking } = await admin.from('appointments').select('status, starts_at, source').eq('patient_id', patient.id).single();
    expect(booking).toMatchObject({ status: 'booked', source: 'website' });
    expect(new Date(booking.starts_at).getTime()).toBe(new Date(slot).getTime());
    state.patientId = patient.id;
  });

  it('the conversation now belongs to that patient: no token, no entry', async () => {
    const guest = await say('hello?', { conversationId: state.conversationId });
    expect(guest.status).toBe(401);

    ai.script.push({ text: 'Welcome back!' });
    const owner = await say('hello again', { conversationId: state.conversationId, token: state.token });
    expect(owner.status).toBe(200);
  });

  it('the patient reads the chat back with their real details restored', async () => {
    const res = await api('get', `/chat/${state.conversationId}`, { token: state.token });

    expect(res.status).toBe(200);
    expect(res.body.messages.find((m) => m.role === 'user').content).toContain(state.email);
  });
});

describe('streaming', () => {
  it('sends progress, the free-times card, the reply and done', async () => {
    ai.script.push({ tool: 'check_availability', args: { service: 'check-up', from: dayInZone(new Date(slot)), days: 1 } }, { text: 'Here are the free times.' });

    const res = await request(app).post('/api/chat/stream').send({ message: 'Any free check-up times?' });

    expect(res.status).toBe(200);
    const events = res.text
      .split('\n\n')
      .filter((b) => b.startsWith('event:'))
      .map((b) => ({ type: /^event: (.+)$/m.exec(b)[1], data: JSON.parse(/^data: (.+)$/m.exec(b)[1]) }));
    tracked.conversations.push(events[0].data.conversation_id);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['conversation', 'status', 'card', 'token', 'done']));
    expect(events.find((e) => e.type === 'status' && e.data.stage === 'tool').data.text).toBe('Checking free times…');
    expect(events.find((e) => e.type === 'card').data.type).toBe('slots');
    expect(events.at(-1)).toMatchObject({ type: 'done', data: { reply: 'Here are the free times.' } });
  });
});

describe('waitlist', () => {
  it('a signed-in patient joins it, and an opening that fits emails them', async () => {
    const { data: nadia } = await admin.from('staff').select('id').eq('full_name_en', 'Nadia Fawzy').single();
    const [opening] = await freeSlots({ serviceId: CLEANING, staffId: nadia.id, count: 1 });
    const day = dayInZone(new Date(opening));

    ai.script.push({ tool: 'join_waitlist', args: { service: 'teeth cleaning', from: day, to: day } }, { text: 'You are on the waitlist.' });
    const res = await say('Please put me on the waitlist for a cleaning that day.', { token: state.token });
    tracked.conversations.push(res.body.conversation_id);

    const { data: wish } = await admin.from('waitlist').select('id, status, staff_id').eq('patient_id', state.patientId).single();
    expect(wish).toMatchObject({ status: 'waiting', staff_id: null });

    // The job that runs after a cancellation, run here directly (emails are captured).
    const { notifyOpening } = await import('../../src/services/waitlistService.js');
    await notifyOpening({ service_id: CLEANING, staff_id: nadia.id, starts_at: new Date(opening).toISOString() });

    const mail = await waitForMail(state.email, 'time opened');
    expect(mail.text).toMatch(/whoever books first/);
    const { data: after } = await admin.from('waitlist').select('status').eq('id', wish.id).single();
    expect(after.status).toBe('notified');
  });
});

describe('coming back to a guest chat, then signing up on the website', () => {
  const browser = newBrowser(); // keeps the visitor cookie, like a real browser
  const email = emailFor('returning');
  const sixDigits = (mail) => /\b(\d{6})\b/.exec(mail.text)?.[1];
  let chatId;

  it('a guest’s first message starts a chat tied to their browser by a private cookie', async () => {
    ai.script.push({ text: 'Hello! How can I help?' });
    const res = await say('Hi, what are your opening hours?', { agent: browser });

    expect(res.status).toBe(200);
    chatId = res.body.conversation_id;
    tracked.conversations.push(chatId);
    expect(res.headers['set-cookie'].join()).toMatch(/bs_vid=[\w-]{43}; Max-Age=2592000; Path=\/api; .*HttpOnly.*SameSite=Strict/);
    const { data } = await admin.from('conversations').select('visitor_hash, profile_id').eq('id', chatId).single();
    expect(data.visitor_hash).toMatch(/^[0-9a-f]{64}$/); // only a fingerprint is stored
    expect(data.profile_id).toBeNull();
  });

  it('coming back on the same browser picks the chat up; any other browser sees nothing', async () => {
    const back = await api('get', '/chat/current', { agent: browser });
    expect(back.status).toBe(200);
    expect(back.body.conversation).toMatchObject({ id: chatId, messages: [{ role: 'user' }, { role: 'assistant' }] });

    expect((await api('get', '/chat/current')).body).toEqual({ conversation: null });
    expect((await api('get', `/chat/${chatId}`)).status).toBe(404);
    expect((await say('Is this my chat?', { conversationId: chatId })).status).toBe(404);
  });

  it('signing up on the website moves the chat into the account and clears the cookie', async () => {
    const details = { full_name: nameFor('Returning Guest'), date_of_birth: '1992-02-02', email, phone: phoneFor() };
    expect((await api('post', '/auth/register/start', { body: details, agent: browser })).body).toEqual({ sent: true });
    const code = sixDigits(await waitForMail(email, 'sign-in code'));
    const res = await api('post', '/auth/register/verify', { body: { email, code }, agent: browser });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers['set-cookie'].join()).toMatch(/bs_vid=;/);
    const token = res.body.access_token;

    const mine = await api('get', '/me/conversations', { token });
    expect(mine.body.data.map((c) => c.id)).toContain(chatId);
    expect((await api('get', '/chat/current', { token })).body.conversation.id).toBe(chatId);

    ai.script.push({ text: 'Welcome back!' });
    expect((await say('Thanks, I have an account now.', { conversationId: chatId, token, agent: browser })).status).toBe(200);
  });

  it('without the account’s sign-in, the same browser starts fresh and can’t open that chat', async () => {
    expect((await api('get', '/chat/current', { agent: browser })).body).toEqual({ conversation: null });
    expect((await say('hello?', { conversationId: chatId, agent: browser })).status).toBe(401);
  });
});
