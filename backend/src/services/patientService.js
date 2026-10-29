import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { adminAs, requireAdmin } from '../db/supabase.js';
import * as contactChangeModel from '../models/contactChangeModel.js';
import * as appointmentModel from '../models/appointmentModel.js';
import * as patientModel from '../models/patientModel.js';
import * as profileModel from '../models/profileModel.js';
import { AppError } from '../utils/AppError.js';
import { patientView, staffPatientView } from '../views/patientView.js';
import { staffAppointmentView } from '../views/appointmentView.js';
import { listView } from '../views/listView.js';
import * as accountService from './accountService.js';
import { sendNewCode as emailNewCode } from './authService.js';
import { clinicBranding, clinicNameIn } from './catalogService.js';
import { isPlaceholderEmail, sendEmailInBackground } from './email/emailService.js';

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
  const [appointments, login] = await Promise.all([
    appointmentModel.listForStaff(db, { patientId: id, limit: 100, offset: 0 }),
    patientModel.loginStatus(requireAdmin(), id),
  ]);
  return {
    ...staffPatientView(patient),
    // locked = too many wrong phone sign-ins (staff can unlock); has_code = a personal code was sent
    login: { locked_until: login?.lockedUntil ?? null, has_code: Boolean(login?.hasCode) },
    appointments: appointments.rows.map(staffAppointmentView),
  };
}

/** A new patient record without a booking (G5), e.g. someone who phoned and will book later. */
export async function create({ user }, body) {
  try {
    return staffPatientView(await patientModel.create(adminAs(user.id), body));
  } catch (err) {
    if (err?.code === '23505') throw AppError.conflict('contact_in_use', 'This email or phone already belongs to another patient.');
    throw err;
  }
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

// ----- the patient changes their own email or phone (G10) -----
// Name and date of birth stay with the clinic: with the phone, they are how phone sign-in proves
// who you are. A new email confirms itself (the code goes to it); a new phone is confirmed from
// the email already on the record, so a stolen session alone can't move the account.

const CONTACT_CODE_MINUTES = 15;
const CONTACT_MAX_TRIES = 5;

const contactFingerprint = (code) =>
  crypto.createHmac('sha256', config.auth.personalCodeSecret).update(`contact-change:${code}`).digest('hex');

/** "mariam.hassan@gmail.com" → "ma•••@gmail.com" (shown back so the patient knows where to look). */
const hideEmail = (email) => email.replace(/^(.{2})[^@]*/, '$1•••');

async function ownRecord(user) {
  const patient = user.patientId && (await patientModel.findById(requireAdmin(), user.patientId));
  if (!patient) throw AppError.notFound('no_patient_record', 'This login has no patient record.');
  return patient;
}

export async function startContactChange({ user }, { field, value }) {
  const admin = requireAdmin();
  const patient = await ownRecord(user);
  if (patient[field] === value) throw AppError.conflict('same_value', 'This is already on your record.');

  const owner = field === 'email' ? await patientModel.findByEmail(admin, value) : await patientModel.findByPhone(admin, value);
  if (owner && owner.id !== patient.id) throw AppError.conflict('contact_in_use', 'This email or phone already belongs to another patient.');
  // …or to any other login (e.g. a team member's): one email = one account, never shared.
  const login = field === 'email' ? await profileModel.findByEmail(admin, value) : null;
  if (login && login.id !== patient.profile_id) throw AppError.conflict('contact_in_use', 'This email already belongs to another account.');

  const sendTo = field === 'email' ? value : patient.email && !isPlaceholderEmail(patient.email) ? patient.email : null;
  if (!sendTo) {
    throw AppError.conflict('no_email', 'We confirm a new phone number by email, and there is no email on your record. Please add an email first, or call the clinic.');
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await contactChangeModel.upsert(admin, {
    patientId: patient.id,
    field,
    newValue: value,
    codeHmac: contactFingerprint(code),
    expiresAt: new Date(Date.now() + CONTACT_CODE_MINUTES * 60_000).toISOString(),
  });

  const brand = await clinicBranding();
  const language = patient.preferred_language;
  sendEmailInBackground({
    template: 'contact_change_code',
    to: sendTo,
    language,
    patientId: patient.id,
    data: { clinicName: clinicNameIn(brand, language), code, field, newValue: value, minutes: CONTACT_CODE_MINUTES },
  });
  return { sent: true, sent_to: hideEmail(sendTo), expires_in_minutes: CONTACT_CODE_MINUTES };
}

export async function verifyContactChange({ user }, { field, code }) {
  const admin = requireAdmin();
  const patient = await ownRecord(user);
  const pending = await contactChangeModel.find(admin, patient.id, field);
  if (!pending || new Date(pending.expires_at) < new Date()) {
    throw AppError.badRequest('code_expired', 'This code has expired. Please ask for a new one.');
  }
  if (pending.attempts >= CONTACT_MAX_TRIES) {
    await contactChangeModel.remove(admin, pending.id);
    throw new AppError(429, 'too_many_tries', 'Too many wrong codes. Please ask for a new one.');
  }

  const expected = Buffer.from(pending.code_hmac, 'hex');
  const given = Buffer.from(contactFingerprint(code), 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    await contactChangeModel.countWrongTry(admin, pending.id, pending.attempts + 1);
    throw AppError.unauthorized('invalid_code', 'This code is not right.');
  }

  let updated;
  try {
    updated = await patientModel.update(adminAs(user.id), patient.id, { [field]: pending.new_value });
  } catch (err) {
    if (err?.code === '23505') throw AppError.conflict('contact_in_use', 'This email or phone already belongs to another patient.');
    throw err;
  }
  await contactChangeModel.remove(admin, pending.id);
  if (field === 'email') await accountService.syncPatientLoginEmail(updated);
  return patientView(updated);
}
