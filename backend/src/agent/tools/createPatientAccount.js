import { createPatientProfile } from '../../services/patients.js';

/** Create a patient profile from conversationally-gathered details. */
export async function createPatientAccount({ full_name, contact, preferred_language = 'en' }) {
  const profile = await createPatientProfile({ full_name, contact, preferred_language });
  return {
    created: true,
    patient_id: profile.id,
    message: 'Account created. You can log in anytime with a one-time link — no password needed.',
  };
}
