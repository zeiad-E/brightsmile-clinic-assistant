import { attempts } from '../auth/attemptLimiter.js';
import { EMAIL_CODE, emailCodeFingerprint } from '../auth/emailCodes.js';
import { normalizePersonName } from '../auth/normalizeName.js';
import { dummyVerify, hashPassword, needsRehash, verifyPassword } from '../auth/passwords.js';
import { safeEqual, sixDigitCode } from '../auth/secrets.js';
import * as sessions from '../auth/sessions.js';
import { config } from '../config/index.js';
import { adminAs, requireAdmin } from '../db/supabase.js';
import * as loginCodeModel from '../models/loginCodeModel.js';
import * as patientModel from '../models/patientModel.js';
import * as profileModel from '../models/profileModel.js';
import * as staffModel from '../models/staffModel.js';
import { AppError } from '../utils/AppError.js';
import { meView, teamProfileView } from '../views/profileView.js';
import * as accountService from './accountService.js';
import * as personalCodeService from './personalCodeService.js';
import { clinicBranding, clinicNameIn } from './catalogService.js';
import { sendEmailInBackground } from './email/emailService.js';

/**
 * Every way to prove who you are, and the account actions around it.
 *
 * Each sign-in returns who was proven and how: `{ profile, method }`. Turning that into a session
 * happens in one place (auth/sessions.js), which also enforces that only a password can open a
 * team account. The website and the chat assistant both come through here, so they share the same
 * checks and limits.
 *
 * Privacy rule: endpoints that take an email answer the same way whether or not the email is
 * registered. Otherwise anyone could test which people are patients here.
 */
const SAME_ANSWER = { sent: true, message: 'If this email is registered, we have sent it a message.' };
const MAX_WRONG_TRIES = 5;
const LOCK_MINUTES = 15;

const lockedUntilFromNow = () => new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
const isLocked = (lockedUntil) => Boolean(lockedUntil) && new Date(lockedUntil) > new Date();

function lockedError(lockedUntil) {
  return new AppError(423, 'account_locked', `Too many wrong tries. Please try again in ${LOCK_MINUTES} minutes.`, { locked_until: lockedUntil });
}

// ----- the clinic team: email + password -----

export async function staffLogin({ email, password }) {
  const db = requireAdmin();
  const profile = await profileModel.findTeamLogin(db, email);
  const wrong = () => AppError.unauthorized('invalid_credentials', 'Wrong email or password.');

  if (!profile?.password_hash) {
    await dummyVerify(password); // same time as a real check, so timing can't reveal who has an account
    throw wrong();
  }
  if (isLocked(profile.locked_until)) throw lockedError(profile.locked_until);

  if (!(await verifyPassword(password, profile.password_hash))) {
    const tries = profile.failed_login_attempts + 1;
    await profileModel.recordWrongPassword(db, profile, tries >= MAX_WRONG_TRIES ? { failed_login_attempts: 0, locked_until: lockedUntilFromNow() } : { failed_login_attempts: tries });
    throw wrong();
  }
  // Only after a correct password: nobody else learns the account exists or is disabled.
  if (profile.disabled_at) throw AppError.forbidden('account_disabled', 'This account has been disabled.');

  await profileModel.updateLogin(db, profile.id, {
    failed_login_attempts: 0,
    locked_until: null,
    last_sign_in_at: new Date().toISOString(),
    ...(needsRehash(profile.password_hash) && { password_hash: await hashPassword(password) }),
  });
  return { profile, method: 'password' };
}

/** The read-only demo button. It can only ever open the one configured viewer account. */
export async function demoLogin() {
  const email = config.auth.demoViewerEmail;
  const profile = email && (await profileModel.findTeamLogin(requireAdmin(), email));
  if (profile?.role !== 'viewer' || profile.disabled_at) throw AppError.notFound('demo_unavailable', 'The demo is not available.');
  return { profile, method: 'demo' };
}

// ----- patients: proven by what is on their patient record -----

/** Signs in a patient we have already verified. A login is made for them if they had none. */
async function signInPatient(patient, method) {
  const profile = await accountService.ensurePatientAccount(patient);
  await profileModel.updateLogin(requireAdmin(), profile.id, { last_sign_in_at: new Date().toISOString() });
  return { profile, method };
}

/** Step 1 of email sign-in. Only patient records are looked at, so team emails never get a code. */
export async function startEmailCode({ email }) {
  const patient = await patientModel.findByEmail(requireAdmin(), email);
  if (patient) await sendEmailCode({ purpose: 'sign_in', email, language: patient.preferred_language });
  return SAME_ANSWER;
}

/** Emails a new 6-digit code, unless this address had one moments ago or too many this hour. */
export async function sendEmailCode({ purpose, email, language, payload = null }) {
  const db = requireAdmin();
  const now = Date.now();
  const existing = await loginCodeModel.find(db, purpose, email);

  const windowOpen = existing && now - new Date(existing.window_started_at).getTime() < 3_600_000;
  if (existing && now - new Date(existing.created_at).getTime() < EMAIL_CODE.resendCooldownSeconds * 1000) return;
  if (windowOpen && existing.send_count >= EMAIL_CODE.maxSendsPerHour) return;

  const code = sixDigitCode();
  await loginCodeModel.save(db, {
    purpose,
    email,
    code_hmac: emailCodeFingerprint(purpose, email, code),
    payload,
    send_count: windowOpen ? existing.send_count + 1 : 1,
    window_started_at: windowOpen ? existing.window_started_at : new Date(now).toISOString(),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + EMAIL_CODE.validMinutes * 60_000).toISOString(),
  });

  const brand = await clinicBranding();
  sendEmailInBackground({
    template: 'email_code',
    to: email,
    language,
    data: { clinicName: clinicNameIn(brand, language), code, minutes: EMAIL_CODE.validMinutes },
  });
}

/** Checks a code and uses it up. Returns its saved row, or throws the same error for any failure. */
export async function checkEmailCode({ purpose, email, code }) {
  const db = requireAdmin();
  const invalid = () => AppError.unauthorized('invalid_code', 'This code is wrong or has expired.');
  const row = await loginCodeModel.find(db, purpose, email);

  if (!row || new Date(row.expires_at) <= new Date()) throw invalid();
  if (row.attempts >= EMAIL_CODE.maxAttempts) {
    await loginCodeModel.remove(db, row.id);
    throw invalid();
  }
  if (!safeEqual(emailCodeFingerprint(purpose, email, code), row.code_hmac)) {
    await loginCodeModel.countWrongTry(db, row);
    throw invalid();
  }
  if (!(await loginCodeModel.consume(db, row))) throw invalid();
  return row;
}

/** Step 2 of email sign-in. */
export async function verifyEmailCode({ email, code }) {
  await checkEmailCode({ purpose: 'sign_in', email, code });
  const patient = await patientModel.findByEmail(requireAdmin(), email);
  if (!patient) throw AppError.unauthorized('invalid_code', 'This code is wrong or has expired.');
  return signInPatient(patient, 'email_code');
}

/** Phone + full name + date of birth. 5 wrong tries lock the record for 15 minutes. */
export async function phoneLogin({ phone, full_name: fullName, date_of_birth: dateOfBirth }, { visitor } = {}) {
  attempts.assertAllowed('phone', visitor);
  const db = requireAdmin();
  const patient = await patientModel.findForPhoneLogin(db, phone);
  const wrong = () => AppError.unauthorized('invalid_credentials', "These details don't match our records.");

  if (!patient) {
    attempts.recordFailure('phone', visitor);
    throw wrong();
  }
  if (isLocked(patient.login_locked_until)) throw lockedError(patient.login_locked_until);

  const matches = patient.date_of_birth === dateOfBirth && normalizePersonName(patient.full_name) === normalizePersonName(fullName);
  if (!matches) {
    attempts.recordFailure('phone', visitor);
    const tries = patient.login_failed_attempts + 1;
    await patientModel.recordWrongPhoneLogin(
      db,
      patient,
      tries >= MAX_WRONG_TRIES ? { login_failed_attempts: 0, login_locked_until: lockedUntilFromNow() } : { login_failed_attempts: tries },
    );
    throw wrong();
  }

  if (patient.login_failed_attempts || patient.login_locked_until) await patientModel.unlockLogin(db, patient.id);
  return signInPatient(patient, 'phone');
}

/** The personal code. A wrong code points to no patient, so limits count per visitor and clinic-wide. */
export async function codeLogin({ code }, { visitor } = {}) {
  attempts.assertAllowed('personal_code', visitor);
  const patient = await personalCodeService.findPatientByCode(code);
  if (!patient) {
    attempts.recordFailure('personal_code', visitor);
    throw AppError.unauthorized('invalid_code', 'This code is not valid.');
  }
  return signInPatient(patient, 'personal_code');
}

/** "I forgot my code": emails the code they already have, so a printed card stays valid. */
export async function resendCode({ email }) {
  const patient = await patientModel.findByEmail(requireAdmin(), email);
  if (patient) await sendCurrentCode(patient);
  return SAME_ANSWER;
}

/** Shared with the staff "email the code" button. */
export async function sendCurrentCode(patient) {
  const { code, replaced } = await personalCodeService.currentOrNewCode(patient.id);
  const brand = await clinicBranding();
  const language = patient.preferred_language;
  sendEmailInBackground({
    template: 'login_code',
    to: patient.email,
    language,
    patientId: patient.id,
    data: { clinicName: clinicNameIn(brand, language), personalCode: code, replaced },
  });
}

// ----- the signed-in account -----

/** The signed-in user, with their patient or staff record. */
export async function me({ user, db }) {
  const [patient, staff] = await Promise.all([
    user.patientId ? patientModel.findById(db, user.patientId) : null,
    user.staffId ? staffModel.findById(db, user.staffId) : null,
  ]);
  return meView(user, { patient, staff });
}

/** Team members change their own password. This device stays signed in; all others are ended. */
export async function changePassword({ user }, { current_password: currentPassword, new_password: newPassword }) {
  const db = requireAdmin();
  const login = await profileModel.findLogin(db, user.id);
  if (!(await verifyPassword(currentPassword, login?.password_hash))) {
    throw AppError.unauthorized('wrong_password', 'Your current password is not correct.');
  }
  await accountService.setPassword(user.id, newPassword, { mustChange: false });
  await sessions.revokeAllFor(user.id, 'password_changed', { exceptId: user.sessionId });
  return { changed: true };
}

// ----- a team member's own profile (G6) -----

export async function teamProfile({ user }) {
  const admin = requireAdmin();
  const [profile, staff] = await Promise.all([
    profileModel.findById(admin, user.id),
    user.staffId ? staffModel.findById(admin, user.staffId) : null,
  ]);
  return teamProfileView(profile, staff);
}

/**
 * Name, phone and language for everyone; doctors also their public bio and photo. Their title,
 * role and email stay with the owner (the email is how they sign in).
 */
export async function updateTeamProfile({ user }, patch) {
  const { bio_en: bioEn, bio_ar: bioAr, photo_url: photoUrl, ...details } = patch;
  const doctor = Object.fromEntries(
    Object.entries({ bio_en: bioEn, bio_ar: bioAr, photo_url: photoUrl }).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(doctor).length && !user.staffId) {
    throw AppError.badRequest('no_doctor_record', 'Only doctors have a public bio and photo.');
  }

  const db = adminAs(user.id);
  if (Object.keys(details).length) await profileModel.updateDetails(db, user.id, details);
  if (Object.keys(doctor).length) await staffModel.update(db, user.staffId, doctor);
  return teamProfile({ user });
}
