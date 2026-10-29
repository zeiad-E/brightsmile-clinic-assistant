import crypto from 'node:crypto';
import { adminAs, requireAdmin } from '../db/supabase.js';
import * as patientModel from '../models/patientModel.js';
import * as profileModel from '../models/profileModel.js';
import { PLACEHOLDER_EMAIL_DOMAIN } from './email/emailService.js';
import { logger } from '../utils/logger.js';

/**
 * Supabase Auth logins ("accounts") for patients and the clinic team.
 * A login is separate from the patient record; patients.profile_id links the two.
 */

export const placeholderEmailFor = (patientId) => `patient-${patientId}@${PLACEHOLDER_EMAIL_DOMAIN}`;

const NEVER = '876000h'; // ~100 years: how Supabase "bans" (disables) a login

/**
 * Creates an Auth user, or finds the existing one with that email. Returns { id, email, created }.
 *
 * The role is written to the profile explicitly: Supabase Auth saves the user first and
 * attaches app_metadata a moment later, so the database trigger that creates the profile
 * never sees the role and would leave everyone as 'patient'.
 */
async function createOrFindUser({ email, password, role, fullName, language }) {
  const db = requireAdmin();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { full_name: fullName, preferred_language: language },
  });
  if (!error) {
    const { error: profileError } = await db
      .from('profiles')
      .update({ role, full_name: fullName, preferred_language: language ?? 'en' })
      .eq('id', data.user.id);
    if (profileError) throw profileError;
    return { id: data.user.id, email, created: true };
  }

  if (error.code === 'email_exists' || error.code === 'user_already_exists') {
    const existing = await profileModel.findByEmail(db, email);
    if (existing) return { id: existing.id, email, created: false, role: existing.role };
  }
  throw error;
}

/**
 * Makes sure the patient can sign in: creates their login if they don't have one and
 * links it. Phone-only patients get an internal placeholder email (it never receives mail).
 *
 * Race-safe: if two bookings for a brand-new patient finish at the same moment, only one
 * link wins; the other request reuses the winner's login.
 *
 * Returns { profileId, email } or null when no login can be linked (e.g. the email belongs
 * to a team member — a staff login must never become a patient login).
 */
export async function ensurePatientLogin(patient) {
  const db = requireAdmin();

  if (patient.profile_id) {
    const { data, error } = await db.auth.admin.getUserById(patient.profile_id);
    if (error) throw error;
    return { profileId: patient.profile_id, email: data.user.email };
  }

  const email = patient.email ?? placeholderEmailFor(patient.id);
  const user = await createOrFindUser({
    email,
    role: 'patient',
    fullName: patient.full_name,
    language: patient.preferred_language,
  });

  if (!user.created && user.role && user.role !== 'patient') {
    logger.warn(`Patient ${patient.id} shares an email with a ${user.role} login; not linking.`);
    return null;
  }

  const linked = await patientModel.linkProfile(db, patient.id, user.id);
  if (linked) return { profileId: user.id, email };

  // Someone linked a login a moment before us: use theirs and remove the spare one we made.
  const fresh = await patientModel.findById(db, patient.id);
  if (user.created) await db.auth.admin.deleteUser(user.id).catch(() => {});
  return fresh?.profile_id ? ensurePatientLogin(fresh) : null;
}

/** Keeps the login email in step when staff change a patient's email. */
export async function syncPatientLoginEmail(patient) {
  if (!patient.profile_id || !patient.email) return;
  const db = requireAdmin();
  const { error } = await db.auth.admin.updateUserById(patient.profile_id, { email: patient.email, email_confirm: true });
  if (error) {
    logger.warn(`Could not update login email for patient ${patient.id}: ${error.message}`);
    return;
  }
  await db.from('profiles').update({ email: patient.email }).eq('id', patient.profile_id);
}

// ----- clinic team -----

const temporaryPassword = () => crypto.randomBytes(12).toString('base64url');

/** Creates a staff/viewer login with a temporary password (they change it after signing in). */
export async function createTeamMember({ email, fullName, role, language = 'en' }) {
  const password = temporaryPassword();
  const user = await createOrFindUser({ email, password, role, fullName, language });
  if (!user.created) return { conflict: true };
  return { id: user.id, email, temporaryPassword: password };
}

/** Changes a team member's role in both places the system reads it. */
export async function setTeamRole(actorId, userId, role) {
  const db = requireAdmin();
  const { error } = await db.auth.admin.updateUserById(userId, { app_metadata: { role } });
  if (error) throw error;
  return profileModel.updateRole(adminAs(actorId), userId, role);
}

export async function setDisabled(userId, disabled) {
  const { error } = await requireAdmin().auth.admin.updateUserById(userId, { ban_duration: disabled ? NEVER : 'none' });
  if (error) throw error;
}

/** Map of user id → disabled? for the team screen. */
export async function disabledUserIds() {
  const { data, error } = await requireAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const now = Date.now();
  return new Set(
    data.users.filter((u) => u.banned_until && new Date(u.banned_until).getTime() > now).map((u) => u.id),
  );
}

/** The owner changed a member's email (G7): the login and the profile both follow. */
export async function changeLoginEmail(userId, email) {
  const db = requireAdmin();
  const { error } = await db.auth.admin.updateUserById(userId, { email, email_confirm: true });
  if (error) throw error;
  const { error: profileError } = await db.from('profiles').update({ email }).eq('id', userId);
  if (profileError) throw profileError;
}

/** A fresh temporary password, for "resend the invitation" (the old one stops working). */
export async function resetTemporaryPassword(userId) {
  const password = temporaryPassword();
  await changePassword(userId, password);
  return password;
}

export async function changePassword(userId, newPassword) {
  const { error } = await requireAdmin().auth.admin.updateUserById(userId, { password: newPassword });
  if (error) throw error;
}
