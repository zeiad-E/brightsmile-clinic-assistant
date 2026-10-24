import { config } from '../config/index.js';
import { requireAdmin } from '../db/supabase.js';
import * as patientModel from '../models/patientModel.js';
import { generatePersonalCode, hmacPersonalCode } from '../utils/crypto.js';

/**
 * Personal sign-in codes (e.g. K7Q4-9M2X), sent by email.
 * Only the fingerprint is stored; the code itself exists only in the email.
 */

/** Creates a new code for the patient (replacing the old one) and returns it for the email. */
export async function issueCode(patientId) {
  const db = requireAdmin();
  // Two patients getting the same code is astronomically unlikely, but the column is
  // unique, so on a clash we simply draw again.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generatePersonalCode();
    try {
      await patientModel.setCodeHmac(db, patientId, hmacPersonalCode(config.auth.personalCodeSecret, code));
      return code;
    } catch (err) {
      if (err?.code !== '23505') throw err;
    }
  }
  throw new Error('Could not generate a unique personal code');
}

/** The patient a typed code belongs to: { patientId, profileId } or null. */
export async function findPatientByCode(code) {
  const result = await patientModel.findByCodeHmac(requireAdmin(), hmacPersonalCode(config.auth.personalCodeSecret, code));
  return result?.ok ? { patientId: result.patient_id, profileId: result.profile_id } : null;
}
