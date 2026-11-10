import { config } from '../config/index.js';
import { dbFor, publicDb, requireAdmin } from '../db/supabase.js';
import { adminAs } from '../db/supabase.js';
import * as clinicModel from '../models/clinicModel.js';
import * as conversationModel from '../models/conversationModel.js';
import * as messageModel from '../models/messageModel.js';
import * as agentRunModel from '../models/agentRunModel.js';
import * as escalationModel from '../models/escalationModel.js';
import * as patientModel from '../models/patientModel.js';
import * as profileModel from '../models/profileModel.js';
import * as assistantReportModel from '../models/assistantReportModel.js';
import * as agentTraceModel from '../models/agentTraceModel.js';
import { findIdentity } from '../models/profileModel.js';
import * as sessions from '../auth/sessions.js';
import { safeEqual } from '../auth/secrets.js';
import { VISITOR_MAX_AGE_MS } from '../auth/visitorCookie.js';
import { buildContext } from '../agent/context.js';
import { clinicPrices } from './catalogService.js';
import { buildSystemPrompt } from '../agent/systemPrompt.js';
import { runAgentTurn } from '../agent/loop.js';
import { reviewReply } from '../agent/reviewer.js';
import { checkReply, detectLanguage, detectVisitHistory, fixedReply, isEmergency, LIMITS } from '../agent/guardrails.js';
import { maskText, restoreForPatient, withoutCodes } from '../agent/masking.js';
import { note, noteFromMessage } from '../agent/notebook.js';
import { progressEvent } from '../agent/progress.js';
import { clip, finishTrace, startAttempt, startTrace, summarizeTrace } from '../agent/trace.js';
import { AppError } from '../utils/AppError.js';
import { createKeyedLock } from '../utils/keyedLock.js';
import { logger } from '../utils/logger.js';
import { listView } from '../views/listView.js';
import { scheduleSummaries } from './memoryService.js';
import { abuse, breaker, budget, limiter, personKeys } from './capacity/index.js';
import { BusyError } from './capacity/limiter.js';
import { safeModeDefinitions, safeModeToolsByName } from '../agent/tools/index.js';

/**
 * One chat turn, start to finish:
 *  ownership check → one turn at a time per conversation → emergency check → privacy mask →
 *  context (who is this, memory, recent messages) → agent loop → retry once on failure →
 *  if it fails again, the code hands over to staff → reply check → save everything.
 */

const withConversationLock = createKeyedLock();

const notFound = () => AppError.notFound('conversation_not_found', 'Conversation not found.');

/**
 * Loads a conversation and checks the caller may continue it:
 *  - a patient's chat: only that patient (a leaked link is useless);
 *  - a guest's chat: only the browser that started it (its visitor cookie, auth/visitorCookie.js),
 *    signed in or not — a patient continuing their own guest chat takes it into their account;
 *  - a guest chat from before visitor cookies existed: the first browser to come back adopts it.
 */
async function loadOwned(admin, id, user, visitorHash = null) {
  const conversation = await conversationModel.findForChat(admin, id);
  if (!conversation || conversation.assistant !== 'patient') throw notFound();
  if (conversation.profile_id) {
    if (conversation.profile_id === user?.id) return conversation;
    if (!user) throw AppError.unauthorized('sign_in_required', 'Please sign in to continue this conversation.');
    throw notFound();
  }
  if (conversation.visitor_hash) {
    if (visitorHash && safeEqual(conversation.visitor_hash, visitorHash)) return conversation;
    throw notFound();
  }
  if (visitorHash && !isPatient(user)) await conversationModel.update(admin, id, { visitor_hash: visitorHash });
  return conversation;
}

const isPatient = (user) => user?.role === 'patient' && Boolean(user.patientId);

/** How long a chat can be picked up again by coming back to the site (the visitor cookie's life). */
const RESUME_MS = VISITOR_MAX_AGE_MS;

/**
 * The chat to show when someone opens the site: their latest one from the last 30 days, unless it
 * is full. A signed-in patient's comes from their account, a guest's from their visitor cookie.
 */
export async function currentConversation({ user, visitorHash }) {
  const owner = isPatient(user) ? { profileId: user.id } : visitorHash ? { visitorHash } : null;
  if (!owner) return { conversation: null };
  const since = new Date(Date.now() - RESUME_MS).toISOString();
  const latest = await conversationModel.findLatest(requireAdmin(), { ...owner, since });
  if (!latest || latest.turn_count >= LIMITS.maxTurnsPerConversation) return { conversation: null };
  return { conversation: await getConversation({ user, visitorHash }, latest.id) };
}

/**
 * Someone just signed in, signed up or booked as a new patient: every chat this browser had as a
 * guest moves into their account (and their "My conversations"). Team accounts take nothing.
 */
export async function claimVisitorChats({ visitorHash, profileId }) {
  if (!visitorHash) return [];
  const admin = requireAdmin();
  const identity = await findIdentity(admin, profileId);
  if (!isPatient(identity)) return [];
  return conversationModel.claimForPatient(admin, { visitorHash, profileId: identity.id, patientId: identity.patientId });
}

/**
 * `onEvent(type, data)` (optional, used by the streaming endpoint) hears progress while the
 * turn runs: 'status' (place in line, what the assistant is doing) and 'card' (free times,
 * booking summary…). The JSON endpoint leaves it out and just waits for the result.
 * `form` (optional) is what the patient sent from the details form (validators/chat.js DetailsForm).
 */
export async function sendMessage({ user, ip, evalCase, visitorHash = null, onEvent }, { conversationId, message, language, form = null }) {
  const admin = requireAdmin();
  const settings = await clinicModel.getSettings(admin);
  // The patient's latest message decides. The page language only helps when it can't.
  const pageLanguage = language ?? user?.preferredLanguage ?? 'en';

  if (!settings.assistant_enabled) {
    return { conversation_id: conversationId ?? null, reply: fixedReply('paused', detectLanguage(message, pageLanguage), { clinicPhone: settings.phone }), status: 'paused' };
  }

  const existing = conversationId ? await loadOwned(admin, conversationId, user, visitorHash) : null;
  const lang = detectLanguage(message, existing?.language ?? pageLanguage);
  const conversation =
    existing ??
    (await conversationModel.create(admin, {
      profileId: isPatient(user) ? user.id : null,
      patientId: isPatient(user) ? user.patientId : null,
      visitorHash: isPatient(user) ? null : visitorHash,
      language: lang,
    }));

  const keys = personKeys({ userId: user?.id, ip, evalCase });
  const notify = onEvent ?? (() => {});
  notify('conversation', { conversation_id: conversation.id });
  return withConversationLock(conversation.id, () =>
    runTurn({ admin, settings, user, lang, conversationId: conversation.id, message, form, keys, notify, visitor: evalCase ? null : ip }),
  );
}

async function runTurn({ admin, settings, user, lang, conversationId, message, form = null, keys, visitor, notify = () => {} }) {
  const startedAt = Date.now();
  const conversation = await conversationModel.findById(admin, conversationId); // fresh, inside the lock
  const patch = { last_message_at: new Date().toISOString(), language: lang };
  // A patient continuing their own guest chat (loadOwned checked the visitor cookie) takes it in.
  if (isPatient(user) && !conversation.profile_id) Object.assign(patch, { profile_id: user.id, patient_id: user.patientId, visitor_hash: null });

  if (conversation.blocked_until && new Date(conversation.blocked_until) > new Date()) {
    return { conversation_id: conversationId, reply: fixedReply('cooldown', lang), status: 'cooldown' };
  }
  if (conversation.turn_count >= LIMITS.maxTurnsPerConversation) {
    return { conversation_id: conversationId, reply: fixedReply('turn_limit', lang), status: 'turn_limit' };
  }
  // A cooldown follows the person (user or IP), so a page refresh doesn't escape it.
  if (abuse.blockedUntil(keys)) {
    return { conversation_id: conversationId, reply: fixedReply('cooldown', lang), status: 'cooldown' };
  }

  const state = structuredClone(conversation.state ?? {});
  const visit = detectVisitHistory(message);
  if (visit !== null) state.firstVisit = visit;
  const map = { ...(state.placeholders ?? {}) };
  const turnNumber = conversation.turn_count + 1;
  const maskedMessage = maskText(message, map);
  // The notebook (agent/notebook.js): a guest's phone, email or birth date is written down the moment
  // it is typed, and the details form's values (already checked) go in as placeholders too.
  if (!isPatient(user)) noteFromMessage(state, maskedMessage);
  if (form) {
    const { purpose, ...details } = form;
    note(state, { patient: details }, map);
    state.formSent = purpose;
  }

  const ctx = {
    conversation,
    state,
    map,
    turnNumber,
    language: lang,
    timeZone: settings.timezone,
    user: isPatient(user) ? user : null,
    isPatient: isPatient(user),
    db: isPatient(user) ? dbFor(user, 'patient_assistant') : publicDb(),
    events: {},
    cards: [],
    toolLog: [],
    visitor,
    signInTicket: null,
    endTurn: null,
    // Every step of this turn, written down for debugging (agent/trace.js).
    trace: startTrace({ turn: turnNumber, language: lang, message: maskedMessage }),
    emit: (card) => {
      ctx.cards.push(card);
      notify('card', card);
    },
    onProgress: (progress) => notify('status', progressEvent(progress, lang)),
    // Called by sign-in and booking tools: the conversation now belongs to this patient. Only a
    // patient is ever signed in here. The browser gets a one-time ticket, because a chat reply
    // can't set a cookie; the AI never sees it.
    signIn: async ({ profile, method }) => {
      const identity = await findIdentity(admin, profile.id);
      if (!isPatient(identity)) return null;
      const { refreshToken } = await sessions.issue({ profile, method, ticket: true, client: { ip: visitor } });
      Object.assign(ctx, { user: identity, isPatient: true, db: dbFor(identity, 'patient_assistant'), signInTicket: refreshToken });
      Object.assign(patch, { profile_id: identity.id, patient_id: identity.patientId, visitor_hash: null });
      return identity;
    },
  };

  // Emergencies never wait for the AI.
  if (isEmergency(message)) {
    await escalationModel.create(admin, {
      conversationId,
      patientId: ctx.user?.patientId ?? conversation.patient_id,
      reason: 'Possible emergency described in chat (detected automatically).',
      urgency: 'urgent',
    });
    const reply = fixedReply('emergency', lang, { clinicPhone: settings.phone });
    ctx.trace.notes.push('emergency words found: fixed reply sent, the AI was skipped, staff alerted');
    return save({ admin, conversationId, ctx, patch: { ...patch, status: 'handed_off' }, maskedMessage, reply, startedAt, outcome: 'escalated', run: {} });
  }

  // A team member has taken this chat over (G1): the assistant stays quiet and the message waits
  // for them. The patient's page shows it and checks every few seconds for the reply.
  if (conversation.taken_over_by) {
    await messageModel.insertMany(admin, [{ conversation_id: conversationId, role: 'user', content: maskedMessage }]);
    await conversationModel.update(admin, conversationId, { ...patch, state: { ...state, placeholders: withoutCodes(map) }, turn_count: turnNumber });
    const names = await profileModel.namesByIds(admin, [conversation.taken_over_by]);
    return { conversation_id: conversationId, reply: '', cards: [], session: null, status: 'with_team', team_member: firstName(names.get(conversation.taken_over_by)) };
  }

  // Budgets and AI health: decide whether (and how) to use the AI at all this turn.
  const allowance = await budget.check(keys);
  if (!allowance.allowed) {
    return { conversation_id: conversationId, reply: fixedReply('daily_limit', lang, { clinicPhone: settings.phone }), status: 'daily_limit' };
  }
  if (allowance.mode === 'off' || !breaker.allows()) {
    return { conversation_id: conversationId, reply: fixedReply('unavailable', lang, { clinicPhone: settings.phone }), status: 'unavailable' };
  }
  ctx.safeMode = allowance.mode === 'safe'; // near the daily limit: knowledge answers + handover only
  await budget.recordMessage(keys);

  const context = await buildContext({ conversation, state, user: ctx.user, db: ctx.db, settings, language: lang });
  context.safeMode = ctx.safeMode;
  delete state.lastReview; // the assistant hears the verdict once, on the turn right after it
  delete state.formSent; // "the form just arrived" is news for this turn only
  const system = { role: 'system', content: buildSystemPrompt(context) };
  // What a team member wrote reaches the AI as the clinic's own words.
  const history = (await messageModel.recentDialogue(admin, conversationId, LIMITS.historyMessages)).map((m) =>
    m.role === 'staff' ? { role: 'assistant', content: `(Clinic team) ${m.content}` } : { role: m.role, content: m.content },
  );
  const userTurn = { role: 'user', content: maskedMessage };
  Object.assign(ctx.trace.input, {
    systemPrompt: clip(system.content, 20_000),
    history: history.map((m) => ({ role: m.role, content: clip(m.content, 1500) })),
    safeMode: ctx.safeMode,
    chatModels: config.llm.chatModels,
    reviewModel: config.llm.reviewModel || null,
  });
  // The prices a reply may quote (checked by the loop). Without them the check is skipped.
  ctx.knownPrices = await clinicPrices().catch((err) => {
    logger.warn(`Clinic prices not loaded: ${err.message}`);
    return null;
  });
  const toolset = ctx.safeMode ? { tools: safeModeToolsByName, definitions: safeModeDefinitions } : {};

  // Wait for a free slot at the AI (bounded line), then try — and on failure try once more
  // with another model and a shorter history. Why an attempt failed is kept in agent_runs.
  let attempts;
  try {
    attempts = await limiter.run(async () => {
      ctx.onProgress({ stage: 'thinking' });
      let result = null;
      let retries = 0;
      const failures = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const attemptTrace = startAttempt(ctx.trace, {
          model: attempt === 0 ? 'chain' : (config.llm.chatModels[1] ?? 'chain'),
          historyMessages: attempt === 0 ? history.length : Math.min(LIMITS.retryHistoryMessages, history.length),
        });
        try {
          result = await runAgentTurn({
            messages: attempt === 0 ? [system, ...history, userTurn] : [system, ...history.slice(-LIMITS.retryHistoryMessages), userTurn],
            ctx,
            model: attempt === 0 ? undefined : config.llm.chatModels[1],
            timeoutMs: config.agent.turnTimeoutMs,
            maxIterations: config.agent.maxToolIterations,
            review: reviewReply,
            trace: attemptTrace,
            ...toolset,
          });
          attemptTrace.status = result.status;
          if (result.status === 'ok' || result.status === 'ended') break;
          logger.warn(`Agent turn ended with ${result.status} (attempt ${attempt + 1})`);
          failures.push({ name: '_attempt_failed', ok: false, reason: result.status, tools: result.toolCalls.map((t) => t.name) });
        } catch (err) {
          Object.assign(attemptTrace, { status: 'error', error: clip(err.message, 500) });
          logger.warn(`Agent turn failed (attempt ${attempt + 1}): ${err.message}`);
          failures.push({ name: '_attempt_failed', ok: false, reason: String(err.message).slice(0, 300) });
          result = null;
        }
        retries = attempt + 1;
        if (ctx.endTurn) break;
      }
      return { result, retries, failures };
    }, { onQueued: (position) => ctx.onProgress({ stage: 'queued', position }) });
  } catch (err) {
    if (err instanceof BusyError) {
      throw new AppError(503, 'assistant_busy', 'The assistant is very busy right now. Please try again in a moment.', { retry_after_seconds: 15 });
    }
    throw err;
  }
  const { result, retries, failures } = attempts;

  const succeeded = result && (result.status === 'ok' || result.status === 'ended');
  if (succeeded) breaker.success();
  else breaker.failure();
  budget.recordTokens(keys, (result?.usage?.in ?? 0) + (result?.usage?.out ?? 0)).catch(() => {});
  let reply;
  let outcome;

  if (!succeeded) {
    // Two failures: the code (not the AI) apologises, hands over, and flags the chat.
    await escalationModel.create(admin, {
      conversationId,
      patientId: ctx.user?.patientId ?? conversation.patient_id,
      reason: 'The assistant could not complete this conversation (failed twice). Please follow up.',
      urgency: 'normal',
    });
    patch.status = 'needs_attention';
    reply = fixedReply('failure', lang);
    ctx.trace.notes.push('no usable reply after both attempts: apology sent, staff alerted');
    outcome = 'fallback';
  } else if (ctx.endTurn) {
    // Declined (off-topic or manipulation): count it for the conversation AND the person.
    const kind = ctx.endTurn.kind === 'injection' ? 'injection' : 'off_topic';
    const offTopic = conversation.off_topic_count + 1;
    patch.off_topic_count = offTopic;
    if (kind === 'injection') state.injectionCount = (state.injectionCount ?? 0) + 1;

    const personBlock = abuse.record(keys, kind);
    const conversationBlock =
      offTopic >= 5 || (state.injectionCount ?? 0) >= 2
        ? new Date(Date.now() + ((state.injectionCount ?? 0) >= 2 ? 60 : 10) * 60_000)
        : null;
    const blockUntil = [personBlock, conversationBlock].filter(Boolean).sort((a, b) => b - a)[0];
    if (blockUntil) {
      patch.blocked_until = blockUntil.toISOString();
      reply = fixedReply('cooldown_start', lang);
    } else {
      reply = fixedReply(kind === 'injection' ? 'injection' : offTopic >= 3 ? 'off_topic_reminder' : 'off_topic', lang);
    }
    outcome = 'refused';
    ctx.trace.notes.push(`declined as ${kind}: fixed reply sent`);
  } else {
    reply = checkReply(result.reply, lang);
    if (result.review) {
      state.lastReview = { approved: result.review.approved, feedback: result.review.feedback };
      if (!result.review.approved) {
        ctx.trace.notes.push('sent although the reviewer objected: staff alerted');
        // It still went out (better than no answer), so a person should look at it.
        await escalationModel.create(admin, {
          conversationId,
          patientId: ctx.user?.patientId ?? conversation.patient_id,
          reason: `The reviewer objected to a reply that was sent: ${result.review.feedback}`,
          urgency: 'low',
        });
      }
    }
    outcome = ctx.events.booked ? 'booked' : ctx.events.escalated ? 'escalated' : ctx.events.changed ? 'changed_data' : 'answered';
  }
  if (ctx.events.escalated && patch.status !== 'needs_attention') patch.status = 'handed_off';

  const toolCalls = [...(result?.toolCalls ?? []), ...failures];
  return save({ admin, conversationId, ctx, patch, maskedMessage, reply, startedAt, outcome, run: { ...(result ?? {}), toolCalls, retries } });
}

async function save({ admin, conversationId, ctx, patch, maskedMessage, reply, startedAt, outcome, run }) {
  const rows = [
    { conversation_id: conversationId, role: 'user', content: maskedMessage },
    ...ctx.toolLog.map((t) => ({ conversation_id: conversationId, role: 'tool', content: '', tool_name: t.name, tool_payload: { args: t.args, result: t.result } })),
    { conversation_id: conversationId, role: 'assistant', content: reply },
  ];
  await messageModel.insertMany(admin, rows);

  const update = {
    ...patch,
    state: { ...ctx.state, placeholders: withoutCodes(ctx.map) },
    turn_count: ctx.turnNumber,
  };
  if (!ctx.conversation.title) update.title = maskedMessage.slice(0, 60);
  await conversationModel.update(admin, conversationId, update);

  const latencyMs = Date.now() - startedAt;
  await agentRunModel
    .insert(admin, {
      conversationId,
      model: run.model,
      latencyMs,
      iterations: run.iterations,
      toolCalls: run.toolCalls,
      outcome,
      tokensIn: run.usage?.in,
      tokensOut: run.usage?.out,
      retries: run.retries,
    })
    .catch((err) => logger.warn(`agent_runs not saved: ${err.message}`));
  await recordTrace({ admin, conversationId, ctx, outcome, reply, latencyMs, run });

  // Memory upkeep runs in the background (never delays the reply).
  scheduleSummaries(ctx.conversation, ctx.turnNumber).catch((err) => logger.warn(`Summaries not scheduled: ${err.message}`));

  return {
    conversation_id: conversationId,
    reply: restoreForPatient(reply, ctx.map),
    cards: ctx.cards,
    sign_in_ticket: ctx.signInTicket,
    status: update.status ?? ctx.conversation.status,
  };
}

/** Saves the turn's trace and logs a one-line summary of it. Never fails the turn. */
async function recordTrace({ admin, conversationId, ctx, outcome, reply, latencyMs, run }) {
  const output = { outcome, reply: clip(reply), tokens: { in: run.usage?.in ?? null, out: run.usage?.out ?? null }, retries: run.retries ?? 0 };
  try {
    logger.info(summarizeTrace(ctx.trace, { conversationId, outcome, latencyMs }));
    await agentTraceModel.insert(admin, { conversationId, turn: ctx.turnNumber, outcome, latencyMs, trace: finishTrace(ctx.trace, output) });
  } catch (err) {
    logger.warn(`agent_traces not saved: ${err.message}`);
  }
}

/** "Dr. Sarah Mansour" → "Sarah": how a team member introduces themself to the patient. */
export function firstName(fullName) {
  return String(fullName ?? '').split(' ').find((word) => word && !/^(Dr\.?|د\.)$/i.test(word)) ?? null;
}

/**
 * A conversation's history, for the patient who owns it (placeholders shown as real values).
 * Team members' messages carry their first name; `with_team` tells the page to keep checking for replies.
 */
export async function getConversation({ user, visitorHash = null }, id) {
  const admin = requireAdmin();
  const conversation = await loadOwned(admin, id, user, visitorHash);
  const map = conversation.state?.placeholders ?? {};
  const messages = await messageModel.listForConversation(admin, id);
  const names = await profileModel.namesByIds(admin, [conversation.taken_over_by, ...messages.map((m) => m.author_id)]);
  return {
    id: conversation.id,
    status: conversation.status,
    title: conversation.title ? restoreForPatient(conversation.title, map) : null,
    language: conversation.language,
    with_team: Boolean(conversation.taken_over_by),
    team_member: conversation.taken_over_by ? firstName(names.get(conversation.taken_over_by)) : null,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: restoreForPatient(m.content, map),
      created_at: m.created_at,
      ...(m.role === 'staff' && { author: firstName(names.get(m.author_id)), event: m.tool_name ?? null }),
    })),
  };
}

export async function listMine({ user, db }, page) {
  return listView(await conversationModel.listMine(db, user.id, page), page);
}

// ----- staff screens (Row Level Security: staff/owner/viewer; viewer masked) -----

const isLive = (row, now = Date.now()) => now - new Date(row.last_message_at).getTime() < conversationModel.LIVE_MINUTES * 60_000;

export async function listForStaff({ db }, filters) {
  const page = await conversationModel.listForStaff(db, filters);
  const [patients, team] = await Promise.all([
    patientModel.namesByIds(db, page.rows.map((row) => row.patient_id)),
    profileModel.namesByIds(db, page.rows.map((row) => row.taken_over_by), { masked: true }),
  ]);
  return listView(page, filters, (row) => ({
    ...row,
    patient_name: patients.get(row.patient_id) ?? null,
    taken_over_by_name: team.get(row.taken_over_by) ?? null,
    live: isLive(row),
  }));
}

/** One conversation for the dashboard: every message (tool calls too), who wrote what, open reports. */
export async function getForStaff({ db }, id) {
  const conversation = await conversationModel.findById(db, id);
  if (!conversation) throw AppError.notFound('conversation_not_found', 'Conversation not found.');
  const { state: _state, ...rest } = conversation; // state holds contact details: not for the dashboard
  const [messages, reports, patients] = await Promise.all([
    messageModel.listForStaff(db, id),
    assistantReportModel.forConversation(requireAdmin(), id),
    patientModel.namesByIds(db, [conversation.patient_id]),
  ]);
  const team = await profileModel.namesByIds(
    db,
    [conversation.taken_over_by, conversation.reviewed_by, ...messages.map((m) => m.author_id), ...reports.map((r) => r.reported_by)],
    { masked: true },
  );
  return {
    ...rest,
    live: isLive(conversation),
    patient_name: patients.get(conversation.patient_id) ?? null,
    taken_over_by_name: team.get(conversation.taken_over_by) ?? null,
    reviewed_by_name: team.get(conversation.reviewed_by) ?? null,
    messages: messages.map((m) => (m.role === 'staff' ? { ...m, author_name: team.get(m.author_id) ?? null } : m)),
    reports: reports.map((r) => ({ ...r, reported_by_name: team.get(r.reported_by) ?? null })),
  };
}

async function loadForTeam(id) {
  const conversation = await conversationModel.findById(requireAdmin(), id);
  if (!conversation || conversation.assistant !== 'patient') throw AppError.notFound('conversation_not_found', 'Conversation not found.');
  return conversation;
}

const takenByOther = () => AppError.conflict('taken_by_other', 'Another team member is answering this chat. They can hand it back first.');

/**
 * "Take over" (G1): the assistant stops answering this chat and the team member does. Runs inside
 * the conversation's lock, so a reply the assistant is writing right now finishes first.
 */
export async function takeOver(ctx, id) {
  const { user } = ctx;
  await withConversationLock(id, async () => {
    const conversation = await loadForTeam(id);
    if (conversation.taken_over_by === user.id) return;
    if (conversation.taken_over_by) throw takenByOther();
    await conversationModel.update(adminAs(user.id), id, { taken_over_by: user.id, taken_over_at: new Date().toISOString(), status: 'handed_off' });
    await messageModel.insertStaff(requireAdmin(), { conversationId: id, authorId: user.id, event: 'joined' });
  });
  return getForStaff(ctx, id);
}

/** Gives the chat back to the assistant. Any team member may do it (e.g. for a colleague who left). */
export async function handBack(ctx, id) {
  const { user } = ctx;
  await withConversationLock(id, async () => {
    const conversation = await loadForTeam(id);
    if (!conversation.taken_over_by) return;
    await conversationModel.update(adminAs(user.id), id, { taken_over_by: null, taken_over_at: null, status: 'active' });
    await messageModel.insertStaff(requireAdmin(), { conversationId: id, authorId: user.id, event: 'left' });
  });
  return getForStaff(ctx, id);
}

/** A team member's reply in the patient's chat. Replying takes the chat over if nobody has. */
export async function staffReply(ctx, id, { message }) {
  const { user } = ctx;
  const conversation = await loadForTeam(id);
  if (conversation.taken_over_by && conversation.taken_over_by !== user.id) throw takenByOther();
  if (!conversation.taken_over_by) await takeOver(ctx, id);

  const saved = await messageModel.insertStaff(requireAdmin(), { conversationId: id, authorId: user.id, content: message });
  await conversationModel.update(requireAdmin(), id, { last_message_at: saved.created_at });
  return { ...saved, author_name: user.fullName ?? null };
}

/** Marks a conversation reviewed (G2), with an optional note the owner sees; reviewed=false undoes it. */
export async function review(ctx, id, { reviewed, note }) {
  const { user } = ctx;
  await loadForTeam(id);
  await conversationModel.update(
    adminAs(user.id),
    id,
    reviewed
      ? { reviewed_at: new Date().toISOString(), reviewed_by: user.id, review_note: note ?? null }
      : { reviewed_at: null, reviewed_by: null, review_note: null },
  );
  return getForStaff(ctx, id);
}
