import * as chatService from '../../services/chatService.js';
import { ctxOf } from '../context.js';

/** Staff view of assistant conversations (/api/staff/conversations); masked for the viewer. */

export async function list(req, res) {
  res.json(await chatService.listForStaff(ctxOf(req), req.valid.query));
}

export async function get(req, res) {
  res.json(await chatService.getForStaff(ctxOf(req), req.valid.params.id));
}

export async function takeOver(req, res) {
  res.json(await chatService.takeOver(ctxOf(req), req.valid.params.id));
}

export async function handBack(req, res) {
  res.json(await chatService.handBack(ctxOf(req), req.valid.params.id));
}

export async function reply(req, res) {
  res.status(201).json(await chatService.staffReply(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function review(req, res) {
  res.json(await chatService.review(ctxOf(req), req.valid.params.id, req.valid.body));
}
