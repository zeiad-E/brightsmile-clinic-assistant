import * as escalationService from '../../services/escalationService.js';
import { ctxOf } from '../context.js';

/** Hand-offs from the assistant (/api/staff/escalations). */

export async function list(req, res) {
  res.json(await escalationService.list(ctxOf(req), req.valid.query));
}

export async function resolve(req, res) {
  res.json(await escalationService.resolve(ctxOf(req), req.valid.params.id));
}
