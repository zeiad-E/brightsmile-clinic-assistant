import { requireAdmin } from '../db/supabase.js';
import * as assistantReportModel from '../models/assistantReportModel.js';
import * as conversationModel from '../models/conversationModel.js';
import * as patientModel from '../models/patientModel.js';
import * as profileModel from '../models/profileModel.js';
import { AppError } from '../utils/AppError.js';
import { listView } from '../views/listView.js';

/**
 * "The assistant got this wrong" (G4). Staff report from a conversation; the owner works through
 * the reports in the control room's problem queue. The table is backend-only, so the role
 * checks on the routes are the lock; the viewer's copy hides the free-text notes.
 */

export async function create({ user }, conversationId, { message_id: messageId, kind, note }) {
  const conversation = await conversationModel.findById(requireAdmin(), conversationId);
  if (!conversation) throw AppError.notFound('conversation_not_found', 'Conversation not found.');
  return assistantReportModel.create(requireAdmin(), { conversationId, messageId, kind, note, reportedBy: user.id });
}

export async function list({ user, db }, filters) {
  const page = await assistantReportModel.list(requireAdmin(), filters);
  const conversations = await Promise.all(
    [...new Set(page.rows.map((r) => r.conversation_id))].map((id) => conversationModel.findById(requireAdmin(), id)),
  );
  const byId = new Map(conversations.filter(Boolean).map((c) => [c.id, c]));
  const viewer = user.role === 'viewer';
  const [patients, team] = await Promise.all([
    patientModel.namesByIds(db, conversations.filter(Boolean).map((c) => c.patient_id)),
    profileModel.namesByIds(db, page.rows.flatMap((r) => [r.reported_by, r.resolved_by]), { from: 'v_profiles' }),
  ]);
  return listView(page, filters, (r) => {
    const conversation = byId.get(r.conversation_id);
    return {
      ...r,
      note: viewer ? null : r.note,
      owner_note: viewer ? null : r.owner_note,
      conversation_title: viewer ? null : (conversation?.title ?? null),
      patient_name: patients.get(conversation?.patient_id) ?? null,
      reported_by_name: team.get(r.reported_by) ?? null,
      resolved_by_name: team.get(r.resolved_by) ?? null,
    };
  });
}

export async function resolve({ user }, id, { owner_note: ownerNote }) {
  const resolved = await assistantReportModel.resolve(requireAdmin(), id, { resolvedBy: user.id, ownerNote });
  if (resolved) return resolved;
  throw AppError.conflict('already_resolved', 'This report was already resolved (or does not exist).');
}
