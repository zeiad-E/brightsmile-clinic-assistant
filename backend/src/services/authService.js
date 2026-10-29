import { adminAs, requireAdmin } from '../db/supabase.js';
import { createAuthClient } from '../db/userClient.js';
import * as patientModel from '../models/patientModel.js';
import * as profileModel from '../models/profileModel.js';
import * as staffModel from '../models/staffModel.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { sessionView } from '../views/sessionView.js';
import { meView, teamProfileView } from '../views/profileView.js';
import { ROLES } from '../utils/roles.js';
import * as sessionService from './sessionService.js';
import * as accountService from './accountService.js';
import * as personalCodeService from './personalCodeService.js';
import { clinicBranding, clinicNameIn } from './catalogService.js';
import { isPlaceholderEmail, sendEmailInBackground } from './email/emailService.js';

/**
 * Every way to sign in, and the account actions around it.
 *
 * Privacy rule: endpoints that take an email answer the same way whether or not the
 * email is registered. Otherwise anyone could test which people are patients here.
 */
const SAME_ANSWER = { sent: true, message: 'If this email is registered, we have sent it a message.' };

/**
 * Clinic team: email + password. A patient login is turned away here (G8): the session that
 * was just made is closed again, and the answer points them to the patient sign-in.
 */
export async function staffLogin({ email, password }) {
  const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
  if (error?.code === 'user_banned') throw AppError.forbidden('account_disabled', 'This account has been disabled.');
  if (error || !data.session) throw AppError.unauthorized('invalid_credentials', 'Wrong email or password.');

  const profile = await profileModel.findById(requireAdmin(), data.user.id);
  if (!ROLES.TEAM.includes(profile?.role)) {
    await sessionService.revokeSession(data.session.access_token).catch(() => {});
    throw AppError.forbidden('patient_account', 'This is the team sign-in. If you are a patient, please use the Patient tab.');
  }
  return sessionView(data.session, { id: data.user.id, email: data.user.email, role: profile.role });
}

/**
 * Step 1 of the PATIENT email sign-in: Supabase emails a 6-digit code — only to patient logins.
 * A team account never gets one: an emailed code skips the password, so team members sign in
 * on the Team tab with their password. The answer is the same either way (privacy rule above).
 */
export async function startEmailCode({ email }) {
  if (isPlaceholderEmail(email)) return SAME_ANSWER;
  const profile = await profileModel.findByEmail(requireAdmin(), email);
  if (profile?.role !== 'patient') return SAME_ANSWER;
  const { error } = await createAuthClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) logger.info(`Email code not sent (${error.code ?? error.status}): ${error.message}`);
  return SAME_ANSWER;
}

/**
 * Step 2 of the patient email sign-in: the code from the email → a session.
 * Even with a correct code, a team account is turned away and the session just made is closed
 * (a code sent before this rule existed must not open the owner's dashboard).
 */
export async function verifyEmailCode({ email, code }) {
  const { data, error } = await createAuthClient().auth.verifyOtp({ email, token: code, type: 'email' });
  if (error || !data.session) throw AppError.unauthorized('invalid_code', 'This code is wrong or has expired.');

  const profile = await profileModel.findById(requireAdmin(), data.user.id);
  if (profile?.role !== 'patient') {
    await sessionService.revokeSession(data.session.access_token).catch(() => {});
    throw AppError.forbidden('team_account', 'This email belongs to a clinic team account. Team members sign in on the Team tab with their password.');
  }
  return sessionView(data.session, { id: data.user.id, email: data.user.email, role: 'patient' });
}

/** Signs in a patient we have already verified some other way. */
async function signInPatient(patientId) {
  const patient = await patientModel.findById(requireAdmin(), patientId);
  const login = patient && (await accountService.ensurePatientLogin(patient));
  if (!login) throw AppError.forbidden('login_unavailable', 'Online sign-in is not available for this record. Please call the clinic.');

  const session = await sessionService.mintSession(login.email);
  return sessionView(session, { id: login.profileId, email: patient.email, role: 'patient' });
}

/** Phone + full name + date of birth. 5 wrong tries lock the record for 15 minutes (in the database). */
export async function phoneLogin({ phone, full_name: fullName, date_of_birth: dateOfBirth }) {
  const result = await patientModel.verifyByPhone(requireAdmin(), { phone, fullName, dateOfBirth });
  if (!result.ok && result.error === 'locked') {
    throw new AppError(423, 'account_locked', 'Too many wrong tries. Please try again in 15 minutes.', {
      locked_until: result.locked_until,
    });
  }
  if (!result.ok) throw AppError.unauthorized('invalid_credentials', "These details don't match our records.");
  return signInPatient(result.patient_id);
}

/** The personal code from the confirmation email (protected by a strict rate limit). */
export async function codeLogin({ code }) {
  const match = await personalCodeService.findPatientByCode(code);
  if (!match) throw AppError.unauthorized('invalid_code', 'This code is not valid.');
  return signInPatient(match.patientId);
}

/** Emails a brand-new personal code; the old one stops working. */
export async function resendCode({ email }) {
  const patient = await patientModel.findByEmail(requireAdmin(), email);
  if (patient) await sendNewCode(patient);
  return SAME_ANSWER;
}

/** Shared with the staff "send a new code" button. */
export async function sendNewCode(patient) {
  const code = await personalCodeService.issueCode(patient.id);
  const brand = await clinicBranding();
  const language = patient.preferred_language;
  sendEmailInBackground({
    template: 'login_code',
    to: patient.email,
    language,
    patientId: patient.id,
    data: { clinicName: clinicNameIn(brand, language), personalCode: code },
  });
}

export async function refresh({ refresh_token: refreshToken }) {
  return sessionView(await sessionService.refreshSession(refreshToken));
}

export async function logout(token) {
  await sessionService.revokeSession(token);
}

/** The signed-in user, with their patient or staff record (read as the user). */
export async function me({ user, db }) {
  const [patient, staff] = await Promise.all([
    user.patientId ? patientModel.findById(db, user.patientId) : null,
    user.staffId ? staffModel.findById(db, user.staffId) : null,
  ]);
  return meView(user, { patient, staff });
}

/** Team members change their own password; the current one is required. */
export async function changePassword({ user }, { current_password: currentPassword, new_password: newPassword }) {
  const { error } = await createAuthClient().auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (error) throw AppError.unauthorized('wrong_password', 'Your current password is not correct.');
  await accountService.changePassword(user.id, newPassword);
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
