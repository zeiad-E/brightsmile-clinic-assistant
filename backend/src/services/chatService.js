import { config } from '../config/index.js';
import { requireAdmin } from '../db/supabase.js';
import { anonClient, createUserClient } from '../db/userClient.js';
import * as clinicModel from '../models/clinicModel.js';
import * as conversationModel from '../models/conversationModel.js';
import * as messageModel from '../models/messageModel.js';
import * as agentRunModel from '../models/agentRunModel.js';
import * as escalationModel from '../models/escalationModel.js';
import { findIdentity } from '../models/profileModel.js';
import { buildContext } from '../agent/context.js';
import { buildSystemPrompt } from '../agent/systemPrompt.js';
import { runAgentTurn } from '../agent/loop.js';
import { checkReply, detectLanguage, detectVisitHistory, fixedReply, isEmergency, LIMITS } from '../agent/guardrails.js';
import { maskText, restoreForPatient, withoutCodes } from '../agent/masking.js';
import { progressEvent } from '../agent/progress.js';
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

/** Loads a conversation and checks the caller may continue it. */
async function loadOwned(admin, id, user) {
  const conversation = await conversationModel.findById(admin, id);
  if (!conversation || conversation.assistant !== 'patient') throw AppError.notFound('conversation_not_found', 'Conversation not found.');
  if (conversation.profile_id && conversation.profile_id !== user?.id) {
    // Once a patient has signed in, only they can continue it (a leaked link is useless).
    if (!user) throw AppError.unauthorized('sign_in_required', 'Please sign in to continue this conversation.');
    throw AppError.notFound('conversation_not_found', 'Conversation not found.');
  }
  return conversation;
}

const isPatient = (user) => user?.role === 'patient' && Boolean(user.patientId);

/**
 * `onEvent(type, data)` (optional, used by the streaming endpoint) hears progress while the
 * turn runs: 'status' (place in line, what the assistant is doing) and 'card' (free times,
 * booking summary…). The JSON endpoint leaves it out and just waits for the result.
 */
export async function sendMessage({ user, db, ip, evalCase, onEvent }, { conversationId, message, language }) {
  const admin = requireAdmin();
  const settings = await clinicModel.getSettings(admin);
  const lang = language ?? detectLanguage(message, user?.preferredLanguage ?? 'en');

  if (!settings.assistant_enabled) {
    return { conversation_id: conversationId ?? null, reply: fixedReply('paused', lang, { clinicPhone: settings.phone }), status: 'paused' };
  }

  const conversation = conversationId
    ? await loadOwned(admin, conversationId, user)
    : await conversationModel.create(admin, {
        profileId: isPatient(user) ? user.id : null,
        patientId: isPatient(user) ? user.patientId : null,
        language: lang,
      });

  const keys = personKeys({ userId: user?.id, ip, evalCase });
  const notify = onEvent ?? (() => {});
  notify('conversation', { conversation_id: conversation.id });
  return withConversationLock(conversation.id, () =>
    runTurn({ admin, settings, user, db, lang, conversationId: conversation.id, message, keys, notify }),
  );
}

async function runTurn({ admin, settings, user, db, lang, conversationId, message, keys, notify = () => {} }) {
  const startedAt = Date.now();
  const conversation = await conversationModel.findById(admin, conversationId); // fresh, inside the lock
  const patch = { last_message_at: new Date().toISOString(), language: lang };
  if (isPatient(user) && !conversation.profile_id) Object.assign(patch, { profile_id: user.id, patient_id: user.patientId });

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

  const ctx = {
    conversation,
    state,
    map,
    turnNumber,
    language: lang,
    timeZone: settings.timezone,
    user: isPatient(user) ? user : null,
    isPatient: isPatient(user),
    db: isPatient(user) ? db : anonClient(),
    events: {},
    cards: [],
    toolLog: [],
    session: null,
    endTurn: null,
    emit: (card) => {
      ctx.cards.push(card);
      notify('card', card);
    },
    onProgress: (progress) => notify('status', progressEvent(progress, lang)),
    // Called by sign-in and booking tools: the conversation now belongs to this patient.
    signedIn: async (session) => {
      const userDb = createUserClient(session.access_token);
      const identity = await findIdentity(userDb, session.user.id);
      if (identity) {
        Object.assign(ctx, { user: identity, isPatient: isPatient(identity), db: userDb, session });
        Object.assign(patch, { profile_id: identity.id, patient_id: identity.patientId });
      }
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
    return save({ admin, conversationId, ctx, patch: { ...patch, status: 'handed_off' }, maskedMessage, reply, startedAt, outcome: 'escalated', run: {} });
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
  const system = { role: 'system', content: buildSystemPrompt(context) };
  const history = (await messageModel.recentDialogue(admin, conversationId, LIMITS.historyMessages)).map((m) => ({ role: m.role, content: m.content }));
  const userTurn = { role: 'user', content: maskedMessage };
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
        try {
          result = await runAgentTurn({
            messages: attempt === 0 ? [system, ...history, userTurn] : [system, ...history.slice(-4), userTurn],
            ctx,
            model: attempt === 0 ? undefined : config.llm.chatModels[1],
            timeoutMs: config.agent.turnTimeoutMs,
            maxIterations: config.agent.maxToolIterations,
            ...toolset,
          });
          if (result.status === 'ok' || result.status === 'ended') break;
          logger.warn(`Agent turn ended with ${result.status} (attempt ${attempt + 1})`);
          failures.push({ name: '_attempt_failed', ok: false, reason: result.status, tools: result.toolCalls.map((t) => t.name) });
        } catch (err) {
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
  } else {
    reply = checkReply(result.reply, lang);
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

  await agentRunModel
    .insert(admin, {
      conversationId,
      model: run.model,
      latencyMs: Date.now() - startedAt,
      iterations: run.iterations,
      toolCalls: run.toolCalls,
      outcome,
      tokensIn: run.usage?.in,
      tokensOut: run.usage?.out,
      retries: run.retries,
    })
    .catch((err) => logger.warn(`agent_runs not saved: ${err.message}`));

  // Memory upkeep runs in the background (never delays the reply).
  scheduleSummaries(ctx.conversation, ctx.turnNumber).catch((err) => logger.warn(`Summaries not scheduled: ${err.message}`));

  return {
    conversation_id: conversationId,
    reply: restoreForPatient(reply, ctx.map),
    cards: ctx.cards,
    session: ctx.session,
    status: update.status ?? ctx.conversation.status,
  };
}

/** A conversation's history, for the patient who owns it (placeholders shown as real values). */
export async function getConversation({ user }, id) {
  const admin = requireAdmin();
  const conversation = await loadOwned(admin, id, user);
  const map = conversation.state?.placeholders ?? {};
  const messages = await messageModel.listForConversation(admin, id);
  return {
    id: conversation.id,
    status: conversation.status,
    title: conversation.title ? restoreForPatient(conversation.title, map) : null,
    language: conversation.language,
    messages: messages.map((m) => ({ role: m.role, content: restoreForPatient(m.content, map), created_at: m.created_at })),
  };
}

export async function listMine({ db }, page) {
  return listView(await conversationModel.listMine(db, page), page);
}

// ----- staff screens (Row Level Security: staff/owner/viewer; viewer masked) -----

export async function listForStaff({ db }, filters) {
  return listView(await conversationModel.listForStaff(db, filters), filters);
}

export async function getForStaff({ db }, id) {
  const conversation = await conversationModel.findById(db, id);
  if (!conversation) throw AppError.notFound('conversation_not_found', 'Conversation not found.');
  const { state: _state, ...rest } = conversation; // state holds contact details: not for the dashboard
  return { ...rest, messages: await messageModel.listForStaff(db, id) };
}
