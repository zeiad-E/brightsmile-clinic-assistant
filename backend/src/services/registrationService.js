import { adminAs, requireAdmin } from '../db/supabase.js';
import * as patientModel from '../models/patientModel.js';
import * as profileModel from '../models/profileModel.js';
import { AppError } from '../utils/AppError.js';
import * as accountService from './accountService.js';
import * as authService from './authService.js';
import * as personalCodeService from './personalCodeService.js';

/**
 * Creating an account: a form, then a 6-digit code emailed to prove the address is theirs.
 * The website and the chat assistant both come through here.
 *
 * The form waits with the code (in login_codes) and nothing is created until the code is right.
 * Step 1 answers the same way whoever the email belongs to, so it can't test who is a patient.
 *
 * Step 2 can find a record that already exists, e.g. someone who was registered at the desk:
 *  - same email: the code proves it is theirs, so they enter that record;
 *  - same phone, no email on the record: they must also pass the phone sign-in check, so a stranger
 *    can't attach their own email to someone else's record;
 *  - anything else is refused, and they are told to sign in or call the clinic.
 */
const phoneInUse = () => AppError.conflict('phone_in_use', 'This phone number is already on another account. Please sign in, or call the clinic.');

export async function startRegistration({ email, preferred_language: language = 'en', ...form }) {
  await authService.sendEmailCode({ purpose: 'sign_up', email, language, payload: { ...form, preferred_language: language } });
  return { sent: true };
}

/** Same email: fill in only what the record is missing. What the clinic wrote stays. */
async function intoSameEmail(patient, form, via) {
  const db = requireAdmin();
  const patch = {};
  if (!patient.phone && !(await patientModel.findByPhone(db, form.phone))) patch.phone = form.phone;
  if (!patient.date_of_birth) patch.date_of_birth = form.date_of_birth;
  if (Object.keys(patch).length) await patientModel.update(adminAs(null, via), patient.id, patch);
  return accountService.ensurePatientAccount(patient);
}

async function intoSamePhone(patient, form, email, { via, visitor }) {
  if (patient.email) throw phoneInUse();
  const { profile } = await authService.phoneLogin(form, { visitor }).catch((err) => {
    if (err instanceof AppError) throw phoneInUse();
    throw err;
  });
  await patientModel.update(adminAs(null, via), patient.id, { email });
  return profile;
}

async function createPatient(form, email, via) {
  try {
    return await patientModel.create(adminAs(null, via), { ...form, email });
  } catch (err) {
    if (err?.code === '23505') throw phoneInUse(); // someone took the phone or email a moment ago
    throw err;
  }
}

/**
 * Returns who was proven, like every sign-in. `personalCode` is only there for a new account: an
 * existing patient keeps the code they have, and sees it in their profile.
 */
export async function finishRegistration({ email, code }, { via = 'dashboard', visitor } = {}) {
  const { payload: form } = await authService.checkEmailCode({ purpose: 'sign_up', email, code });
  if (!form) throw AppError.unauthorized('invalid_code', 'This code is wrong or has expired.');

  const db = requireAdmin();
  const sameEmail = await patientModel.findByEmail(db, email);
  const samePhone = sameEmail ? null : await patientModel.findByPhone(db, form.phone);

  let profile;
  let personalCode = null;
  if (sameEmail) profile = await intoSameEmail(sameEmail, form, via);
  else if (samePhone) profile = await intoSamePhone(samePhone, form, email, { via, visitor });
  else {
    const patient = await createPatient(form, email, via);
    personalCode = await personalCodeService.issueCode(patient.id);
    profile = await accountService.ensurePatientAccount(patient);
    await authService.sendCurrentCode(patient);
  }

  await profileModel.updateLogin(db, profile.id, { last_sign_in_at: new Date().toISOString() });
  return { profile, method: 'sign_up', personalCode };
}
