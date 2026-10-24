import * as escalationModel from '../models/escalationModel.js';
import { AppError } from '../utils/AppError.js';
import { listView } from '../views/listView.js';

/** Hand-offs from the assistant to a human. Staff see and resolve them. */

export async function list({ db }, filters) {
  return listView(await escalationModel.list(db, filters), filters);
}

export async function resolve({ user, db }, id) {
  const resolved = await escalationModel.resolve(db, id, user.id);
  if (resolved) return resolved;
  const existing = await escalationModel.findById(db, id);
  if (!existing) throw AppError.notFound('escalation_not_found', 'Escalation not found.');
  throw AppError.conflict('already_resolved', 'This escalation was already resolved.');
}
