import { hashPassword, temporaryPassword } from '../auth/passwords.js';
import * as sessions from '../auth/sessions.js';
import { adminAs, requireAdmin } from '../db/supabase.js';
import * as auditModel from '../models/auditModel.js';
import * as patientModel from '../models/patientModel.js';
import * as profileModel from '../models/profileModel.js';

/**
 * Accounts (rows in `profiles`). A patient's sign-in details live on their patient record; the
 * profile is what sessions, the audit log and chats point to. Team members sign in with the email
 * and password stored here.
 */

/**
 * Makes sure a patient has an account. Race-safe: if two requests do this for the same new
 * patient, only one link wins and the other uses the winner's account.
 */
export async function ensurePatientAccount(patient) {
  const db = requireAdmin();
  if (patient.profile_id) return profileModel.findById(db, patient.profile_id);

  const profile = await profileModel.createPatientProfile(db, patient);
  if (await patientModel.linkProfile(db, patient.id, profile.id)) return profile;

  await profileModel.remove(db, profile.id);
  const fresh = await patientModel.findById(db, patient.id);
  return profileModel.findById(db, fresh.profile_id);
}

// ----- clinic team -----

/** Creates a staff/viewer account with a temporary password. Null if the email is already used. */
export async function createTeamMember(actorId, { email, fullName, role, language = 'en' }) {
  const password = temporaryPassword();
  const profile = await profileModel.createTeamProfile(requireAdmin(), {
    email,
    full_name: fullName,
    role,
    preferred_language: language,
    password_hash: await hashPassword(password),
    password_changed_at: new Date().toISOString(),
    must_change_password: mustChangeFor(role),
  });
  if (!profile) return { conflict: true };
  await audit(actorId, 'team.created', profile.id);
  return { id: profile.id, email, temporaryPassword: password };
}

// The read-only demo account can't change its password, so it must never be forced to.
const mustChangeFor = (role) => role !== 'viewer';

const audit = (actorId, action, memberId) => auditModel.record(requireAdmin(), { actorId, via: 'dashboard', action, entity: 'profiles', entityId: memberId });

export async function setTeamRole(actorId, memberId, role) {
  const member = await profileModel.updateRole(adminAs(actorId), memberId, role);
  await sessions.revokeAllFor(memberId, 'role_changed');
  await audit(actorId, 'team.role_changed', memberId);
  return member;
}

export async function setDisabled(actorId, memberId, disabled) {
  await profileModel.updateLogin(requireAdmin(), memberId, { disabled_at: disabled ? new Date().toISOString() : null });
  if (disabled) await sessions.revokeAllFor(memberId, 'disabled');
  await audit(actorId, disabled ? 'team.disabled' : 'team.enabled', memberId);
}

/** The owner changed a member's sign-in email (G7). */
export async function changeLoginEmail(actorId, memberId, email) {
  await profileModel.updateLogin(requireAdmin(), memberId, { email });
  await sessions.revokeAllFor(memberId, 'email_changed');
  await audit(actorId, 'team.email_changed', memberId);
}

/** A fresh temporary password, for "resend the invitation" (the old one stops working). */
export async function resetTemporaryPassword(actorId, member) {
  const password = temporaryPassword();
  await setPassword(member.id, password, { mustChange: mustChangeFor(member.role) });
  await sessions.revokeAllFor(member.id, 'password_reset');
  await audit(actorId, 'team.password_reset', member.id);
  return password;
}

export async function setPassword(memberId, password, { mustChange }) {
  await profileModel.updateLogin(requireAdmin(), memberId, {
    password_hash: await hashPassword(password),
    password_changed_at: new Date().toISOString(),
    must_change_password: mustChange,
    failed_login_attempts: 0,
    locked_until: null,
  });
}
