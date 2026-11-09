import { setTimeout as sleep } from 'node:timers/promises';
import * as chatService from '../services/chatService.js';
import { ensureVisitor, readVisitor, visitorHash } from '../auth/visitorCookie.js';
import { toResponse } from '../middlewares/errorHandler.js';
import { openEventStream, replyChunks } from '../utils/eventStream.js';
import { logger } from '../utils/logger.js';
import { ctxOf } from './context.js';

/** The patient assistant (/api/chat) and the patient's own conversation list. */

const isPatient = (user) => user?.role === 'patient';

/**
 * Which browser is chatting (auth/visitorCookie.js), as the fingerprint the database compares.
 * Sending a message: anyone not signed in as a patient gets (or keeps) the visitor cookie.
 * Reading: the cookie is only read, never started. An eval conversation is its own visitor
 * (the eval script keeps no cookies).
 */
function visitorFor(req, res, { start = false } = {}) {
  if (req.evalCase) return visitorHash(`eval:${req.evalCase}`);
  return visitorHash(start && !isPatient(req.user) ? ensureVisitor(req, res) : readVisitor(req));
}

export async function send(req, res) {
  const { conversation_id: conversationId, message, language } = req.valid.body;
  const visitor = visitorFor(req, res, { start: true });
  res.json(await chatService.sendMessage({ user: req.user, ip: req.clientIp, evalCase: req.evalCase, visitorHash: visitor }, { conversationId, message, language }));
}

/**
 * POST /api/chat/stream — the same turn as POST /api/chat, sent as Server-Sent Events:
 *   conversation → status… / card… → token… → done   (or error)
 * The reply is streamed only after it passed the reply check, a few words at a time; `done`
 * carries the full result (the same JSON as the plain endpoint).
 */
export async function stream(req, res) {
  const { conversation_id: conversationId, message, language } = req.valid.body;
  const visitor = visitorFor(req, res, { start: true }); // before the stream: cookies travel in its headers
  const events = openEventStream(req, res);
  try {
    const result = await chatService.sendMessage(
      { user: req.user, ip: req.clientIp, evalCase: req.evalCase, visitorHash: visitor, onEvent: events.send },
      { conversationId, message, language },
    );
    const chunks = result.reply ? replyChunks(result.reply) : [];
    const pause = Math.min(30, 1200 / Math.max(chunks.length, 1)); // the whole reply types out in ≤ ~1.2 s
    for (const text of chunks) {
      if (events.closed) break;
      events.send('token', { text });
      await sleep(pause);
    }
    events.send('done', result);
  } catch (err) {
    const known = toResponse(err);
    if (!known) logger.error(`Chat stream failed id=${req.id}:`, err);
    const { status, body } = known ?? { status: 500, body: { error: 'internal_error', message: 'Something went wrong on our side.' } };
    events.send('error', { status, ...body });
  } finally {
    events.close();
  }
}

export async function history(req, res) {
  res.json(await chatService.getConversation({ user: req.user, visitorHash: visitorFor(req, res) }, req.valid.params.id));
}

/** GET /api/chat/current — the chat to pick up when someone comes back: { conversation } or null. */
export async function current(req, res) {
  res.json(await chatService.currentConversation({ user: req.user, visitorHash: visitorFor(req, res) }));
}

export async function mine(req, res) {
  res.json(await chatService.listMine(ctxOf(req), req.valid.query));
}
