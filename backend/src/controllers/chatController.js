import * as chatService from '../services/chatService.js';
import { ctxOf } from './context.js';

/** The patient assistant (/api/chat) and the patient's own conversation list. */

export async function send(req, res) {
  const { conversation_id: conversationId, message, language } = req.valid.body;
  res.json(await chatService.sendMessage({ user: req.user, db: req.db, ip: req.ip }, { conversationId, message, language }));
}

export async function history(req, res) {
  res.json(await chatService.getConversation({ user: req.user }, req.valid.params.id));
}

export async function mine(req, res) {
  res.json(await chatService.listMine(ctxOf(req), req.valid.query));
}
