import * as memoryService from '../../services/memoryService.js';
import { ctxOf } from '../context.js';

/** Owner: the agent's notes about patients — review and correct them (/api/admin/agent/memories). */

export async function list(req, res) {
  res.json(await memoryService.listForOwner(ctxOf(req), req.valid.query));
}

export async function create(req, res) {
  res.status(201).json(await memoryService.createByOwner(ctxOf(req), req.valid.body));
}

export async function update(req, res) {
  res.json(await memoryService.updateByOwner(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function remove(req, res) {
  await memoryService.removeByOwner(ctxOf(req), req.valid.params.id);
  res.status(204).end();
}
