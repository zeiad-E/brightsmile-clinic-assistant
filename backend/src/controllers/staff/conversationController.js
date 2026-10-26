import * as chatService from '../../services/chatService.js';
import { ctxOf } from '../context.js';

/** Staff view of assistant conversations (/api/staff/conversations); masked for the viewer. */

export async function list(req, res) {
  res.json(await chatService.listForStaff(ctxOf(req), req.valid.query));
}

export async function get(req, res) {
  res.json(await chatService.getForStaff(ctxOf(req), req.valid.params.id));
}
