import { requireAdmin } from '../db/supabase.js';
import * as intakeModel from '../models/intakeModel.js';
import * as patientModel from '../models/patientModel.js';
import { AppError } from '../utils/AppError.js';
import { normalizeText } from '../utils/text.js';

/**
 * Intake questions: the owner decides what to ask new patients (insurance, city, how they
 * heard about us…); the assistant asks them naturally after a booking and saves the answers.
 */

/** Which active questions this patient hasn't answered yet. */
export async function missingFor(patientId) {
  const db = requireAdmin();
  const [fields, intake] = await Promise.all([intakeModel.listActive(db), patientModel.getIntake(db, patientId)]);
  return fields.filter((f) => intake[f.key] === undefined || intake[f.key] === '');
}

/** A "choice" answer may arrive as the value, or as the EN/AR label the patient typed. */
function matchChoice(field, answer) {
  const wanted = normalizeText(answer);
  return field.options.find((o) => [o.value, o.label_en, o.label_ar].some((v) => normalizeText(v) === wanted))
    ?? field.options.find((o) => [o.label_en, o.label_ar].some((v) => normalizeText(v).includes(wanted) || wanted.includes(normalizeText(v))));
}

/** Validates and saves answers; returns what was saved and what was rejected (for the assistant). */
export async function saveAnswers(patientId, answers) {
  const db = requireAdmin();
  const fields = new Map((await intakeModel.listActive(db)).map((f) => [f.key, f]));
  const current = await patientModel.getIntake(db, patientId);
  const saved = {};
  const rejected = [];

  for (const [key, raw] of Object.entries(answers ?? {})) {
    const field = fields.get(key);
    const answer = String(raw ?? '').trim();
    if (!field) {
      rejected.push({ key, reason: 'unknown question' });
    } else if (!answer || answer.length > 100) {
      rejected.push({ key, reason: 'answer must be 1–100 characters' });
    } else if (field.kind === 'choice') {
      const option = matchChoice(field, answer);
      if (option) saved[key] = option.value;
      else rejected.push({ key, reason: `choose one of: ${field.options.map((o) => o.label_en).join(', ')}` });
    } else {
      saved[key] = answer;
    }
  }

  if (Object.keys(saved).length) await patientModel.setIntake(db, patientId, { ...current, ...saved });
  return { saved, rejected };
}

// ----- owner screens -----

export const listFields = ({ db }) => intakeModel.listAll(db);

export async function createField({ db }, input) {
  try {
    return await intakeModel.create(db, input);
  } catch (err) {
    if (err?.code === '23505') throw AppError.conflict('key_taken', 'Another question already uses this key.');
    throw err;
  }
}

export async function updateField({ db }, id, patch) {
  const field = await intakeModel.update(db, id, patch);
  if (!field) throw AppError.notFound('intake_field_not_found', 'Question not found.');
  return field;
}

export async function removeField({ db }, id) {
  if (!(await intakeModel.remove(db, id))) throw AppError.notFound('intake_field_not_found', 'Question not found.');
}
