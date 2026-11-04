import { config } from '../config/index.js';
import { decryptPersonalCode, encryptPersonalCode, generatePersonalCode, hmacPersonalCode } from '../auth/personalCodes.js';
import * as sessions from '../auth/sessions.js';
import { requireAdmin } from '../db/supabase.js';
import * as auditModel from '../models/auditModel.js';
import * as patientModel from '../models/patientModel.js';

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
const audit = ({ user }, action) =>
  auditModel.record(requireAdmin(), { actorId: user.id, via: 'dashboard', action, entity: 'patients', entityId: user.patientId });

/** The signed-in patient looks at their own code, on screen or to print it. */
export async function showMine(ctx, { forPrint = false } = {}) {
  const { code, legacy, issuedAt } = await readCode(ctx.user.patientId);
  if (code) await audit(ctx, forPrint ? 'personal_code.printed' : 'personal_code.viewed');
  return { code, legacy, issued_at: issuedAt };
}

/** A new code. The old one stops working, and this also signs out their other devices. */
export async function replaceMine(ctx) {
  const code = await issueCode(ctx.user.patientId);
  await sessions.revokeAllFor(ctx.user.id, 'code_changed', { exceptId: ctx.user.sessionId });
  await audit(ctx, 'personal_code.regenerated');
  return { code };
}

/** The patient a typed code belongs to, or null. */
export function findPatientByCode(code) {
  return patientModel.findByCodeHmac(requireAdmin(), hmacPersonalCode(config.auth.personalCodeSecret, code));
}
