import { config } from '../config/index.js';
import { decryptPersonalCode, encryptPersonalCode, generatePersonalCode, hmacPersonalCode } from '../auth/personalCodes.js';
import * as sessions from '../auth/sessions.js';
import { requireAdmin } from '../db/supabase.js';
import * as auditModel from '../models/auditModel.js';
import * as patientModel from '../models/patientModel.js';
import { AppError } from '../utils/AppError.js';

/**
 * Personal sign-in codes (e.g. K7Q4-9M2X). See auth/personalCodes.js for how they are stored.
 * A new code replaces the old one, which then stops working.
 */

/** Creates a new code for the patient and returns it. */
export async function issueCode(patientId) {
  const db = requireAdmin();
  // Two patients getting the same code is astronomically unlikely, but the column is
  // unique, so on a clash we simply draw again.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generatePersonalCode();
    const { ciphertext, keyId } = encryptPersonalCode(code, patientId);
    try {
      await patientModel.setCode(db, patientId, {
        code_hmac: hmacPersonalCode(config.auth.personalCodeSecret, code),
        code_ciphertext: ciphertext,
        code_key_id: keyId,
        code_issued_at: new Date().toISOString(),
      });
      return code;
    } catch (err) {
      if (err?.code !== '23505') throw err;
    }
  }
  throw new Error('Could not generate a unique personal code');
}

/**
 * The patient's current code. `legacy` means they have a code from before codes were encrypted:
 * it still works, but it can't be shown, only replaced.
 */
export async function readCode(patientId) {
  const db = requireAdmin();
  const row = await patientModel.findCode(db, patientId);
  if (!row?.code_ciphertext) return { code: null, legacy: Boolean(row?.code_hmac), issuedAt: row?.code_issued_at ?? null };

  const code = decryptPersonalCode({ ciphertext: row.code_ciphertext, keyId: row.code_key_id }, patientId);
  // Read with an old key: store it under the current one, so old keys can be retired.
  if (row.code_key_id !== config.auth.codeKeys.current.id) {
    const { ciphertext, keyId } = encryptPersonalCode(code, patientId);
    await patientModel.setCode(db, patientId, { code_ciphertext: ciphertext, code_key_id: keyId });
  }
  return { code, legacy: false, issuedAt: row.code_issued_at };
}

/** The code to email: the current one, or a new one if it can't be read. */
export async function currentOrNewCode(patientId) {
  const { code, legacy } = await readCode(patientId);
  return code ? { code, replaced: false } : { code: await issueCode(patientId), replaced: legacy };
}

/** The audit log says who saw or changed a code, and never holds the code itself. */
export const auditCode = (user, action, patientId) =>
  auditModel.record(requireAdmin(), { actorId: user.id, via: 'dashboard', action, entity: 'patients', entityId: patientId });

async function show(user, patientId, forPrint) {
  const { code, legacy, issuedAt } = await readCode(patientId);
  if (code) await auditCode(user, forPrint ? 'personal_code.printed' : 'personal_code.viewed', patientId);
  return { code, legacy, issued_at: issuedAt };
}

/** The signed-in patient looks at their own code, on screen or to print it. */
export const showMine = ({ user }, { forPrint = false } = {}) => show(user, user.patientId, forPrint);

/** A new code. The old one stops working, and this also signs out their other devices. */
export async function replaceMine({ user }) {
  const code = await issueCode(user.patientId);
  await sessions.revokeAllFor(user.id, 'code_changed', { exceptId: user.sessionId });
  await auditCode(user, 'personal_code.regenerated', user.patientId);
  return { code };
}

async function mustExist(patientId) {
  const patient = await patientModel.findById(requireAdmin(), patientId);
  if (!patient) throw AppError.notFound('patient_not_found', 'Patient not found.');
  return patient;
}

/** Staff at the desk look at a patient's code, on screen or to print the card. */
export async function showFor({ user }, patientId, { forPrint = false } = {}) {
  await mustExist(patientId);
  return show(user, patientId, forPrint);
}

/** A lost card: a new code, and every device the patient was signed in on is signed out. */
export async function replaceFor({ user }, patientId) {
  const patient = await mustExist(patientId);
  const code = await issueCode(patientId);
  if (patient.profile_id) await sessions.revokeAllFor(patient.profile_id, 'code_changed');
  await auditCode(user, 'personal_code.regenerated', patientId);
  return { code };
}

/** The patient a typed code belongs to, or null. */
export function findPatientByCode(code) {
  return patientModel.findByCodeHmac(requireAdmin(), hmacPersonalCode(config.auth.personalCodeSecret, code));
}
