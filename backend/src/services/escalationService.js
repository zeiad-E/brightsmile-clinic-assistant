import * as escalationModel from '../models/escalationModel.js';
import * as patientModel from '../models/patientModel.js';
import { AppError } from '../utils/AppError.js';
import { listView } from '../views/listView.js';

/** Hand-offs from the assistant to a human. Staff see and resolve them. */

/** Newest first, each with the patient's name (masked for the viewer) for the inbox list. */
export async function list({ db }, filters) {
  const page = await escalationModel.list(db, filters);
  const names = await patientModel.namesByIds(db, page.rows.map((row) => row.patient_id));
  return listView(page, filters, (row) => ({ ...row, patient_name: names.get(row.patient_id) ?? null }));
}

export async function resolve({ user, db }, id) {
  const resolved = await escalationModel.resolve(db, id, user.id);
  if (resolved) return resolved;
  const existing = await escalationModel.findById(db, id);
  if (!existing) throw AppError.notFound('escalation_not_found', 'Escalation not found.');
  throw AppError.conflict('already_resolved', 'This escalation was already resolved.');
}
