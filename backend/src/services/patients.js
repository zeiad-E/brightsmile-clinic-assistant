import { supabase } from '../db/supabase.js';

/** Patient profile + passwordless auth helpers. TODO: implement against Supabase. */

export async function createPatientProfile({ full_name, contact, preferred_language }) {
  // TODO: insert into patient_profiles (+ create auth user).
  return { id: 'patient_demo', full_name, contact, preferred_language };
}

export async function sendMagicLink(contact) {
  // TODO: use Supabase Auth OTP / magic link (signInWithOtp) to `contact`.
  return { sent: true };
}

export async function getProfileWithHistory(patient_id) {
  // TODO: join patient_profiles + appointments (past + upcoming).
  return {
    patient_id,
    full_name: 'Demo Patient',
    preferred_language: 'en',
    appointments: [],
  };
}
