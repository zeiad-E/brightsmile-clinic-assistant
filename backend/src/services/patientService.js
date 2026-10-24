import { requireAdmin } from '../db/supabase.js';
import * as appointmentModel from '../models/appointmentModel.js';
import * as patientModel from '../models/patientModel.js';
import * as profileModel from '../models/profileModel.js';
import { AppError } from '../utils/AppError.js';
import { patientView, staffPatientView } from '../views/patientView.js';
import { staffAppointmentView } from '../views/appointmentView.js';
import { listView } from '../views/listView.js';
import * as accountService from './accountService.js';
import { sendNewCode as emailNewCode } from './authService.js';

/** Patient records: the patient's own profile, and the staff patient screens. */

// ----- the patient themself -----

export async function myProfile({ user, db }) {
  const patient = user.patientId && (await patientModel.findById(db, user.patientId));
  if (!patient) throw AppError.notFound('no_patient_record', 'This login has no patient record.');
  return patientView(patient);
}

/**
 * Patients may change only their language. Name, phone and date of birth are what
 * phone sign-in checks, so only staff may change those (after confirming who's asking).
 */
export async function updateMyLanguage({ user, db }, { preferred_language: language }) {
  await profileModel.updateLanguage(db, user.id, language);
  const patient = await patientModel.update(requireAdmin(), user.patientId, { preferred_language: language });
  if (!patient) throw AppError.notFound('no_patient_record', 'This login has no patient record.');
  return patientView(patient);
}

// ----- staff screens (masked for the viewer by the views) -----

export async function search({ db }, { q, limit, offset }) {
  const page = await patientModel.search(db, { q, limit, offset });
  return listView(page, { limit, offset }, staffPatientView);
}

export async function getWithAppointments({ db }, id) {
  const patient = await patientModel.findInView(db, id);
  if (!patient) throw AppError.notFound('patient_not_found', 'Patient not found.');
  const appointments = await appointmentModel.listForStaff(db, { patientId: id, limit: 100, offset: 0 });
  return { ...staffPatientView(patient), appointments: appointments.rows.map(staffAppointmentView) };
}

export async function update({ db }, id, patch) {
  let patient;
  try {
    patient = await patientModel.update(db, id, patch);
  } catch (err) {
    if (err?.code === '23505') throw AppError.conflict('contact_in_use', 'This email or phone already belongs to another patient.');
    throw err;
  }
  if (!patient) throw AppError.notFound('patient_not_found', 'Patient not found.');
  if (patch.email) await accountService.syncPatientLoginEmail(patient);
  return staffPatientView(patient);
}

/** Clears a phone sign-in lock (after staff confirmed the caller's identity). */
export async function unlock(_ctx, id) {
  const done = await patientModel.unlockLogin(requireAdmin(), id);
  if (!done) throw AppError.notFound('patient_not_found', 'Patient not found.');
  return { unlocked: true };
}

export async function sendNewCode(_ctx, id) {
  const patient = await patientModel.findById(requireAdmin(), id);
  if (!patient) throw AppError.notFound('patient_not_found', 'Patient not found.');
  if (!patient.email) throw AppError.conflict('no_email', 'This patient has no email address, so no code can be sent.');
  await emailNewCode(patient);
  return { sent: true };
}
