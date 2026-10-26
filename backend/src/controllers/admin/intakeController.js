import * as intakeService from '../../services/intakeService.js';
import { ctxOf } from '../context.js';

/** Owner: the intake questions the assistant asks new patients (/api/admin/intake-fields). */

export async function list(req, res) {
  res.json({ data: await intakeService.listFields(ctxOf(req)) });
}

export async function create(req, res) {
  res.status(201).json(await intakeService.createField(ctxOf(req), req.valid.body));
}

export async function update(req, res) {
  res.json(await intakeService.updateField(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function remove(req, res) {
  await intakeService.removeField(ctxOf(req), req.valid.params.id);
  res.status(204).end();
}
