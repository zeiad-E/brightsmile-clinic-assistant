import * as knowledgeService from '../../services/knowledge/knowledgeService.js';
import { ctxOf } from '../context.js';

/** Owner: the knowledge base (/api/admin/knowledge) and unanswered questions (/api/admin/knowledge-gaps). */

export async function list(req, res) {
  res.json(await knowledgeService.list(ctxOf(req), req.valid.query));
}

export async function get(req, res) {
  res.json(await knowledgeService.get(ctxOf(req), req.valid.params.id));
}

export async function create(req, res) {
  res.status(201).json(await knowledgeService.create(ctxOf(req), req.valid.body));
}

export async function update(req, res) {
  res.json(await knowledgeService.update(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function remove(req, res) {
  await knowledgeService.remove(ctxOf(req), req.valid.params.id);
  res.status(204).end();
}

export async function reingest(req, res) {
  res.status(202).json(await knowledgeService.reingest(ctxOf(req), req.valid.params.id));
}

export async function upload(req, res) {
  res.status(201).json(await knowledgeService.upload(ctxOf(req), req.file, req.valid.body));
}

export async function gaps(req, res) {
  res.json(await knowledgeService.listGaps(ctxOf(req), req.valid.query));
}

export async function setGapStatus(req, res) {
  res.json(await knowledgeService.setGapStatus(ctxOf(req), req.valid.params.id, req.valid.body.status));
}
