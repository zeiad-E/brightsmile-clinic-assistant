import { config } from '../config/index.js';
import { adminAs, requireAdmin } from '../db/supabase.js';
import * as profileModel from '../models/profileModel.js';
import * as staffModel from '../models/staffModel.js';
import { AppError } from '../utils/AppError.js';
import { teamMemberView } from '../views/profileView.js';
import * as accountService from './accountService.js';
import { clinicBranding, clinicNameIn } from './catalogService.js';
import { sendEmailInBackground } from './email/emailService.js';

/**
 * The owner's team screen: add staff/viewer logins, change roles, disable accounts.
 *
 * Safety rules:
 *  - There is exactly one owner; nobody can be made owner here, and the owner can't be
 *    demoted or disabled (so the clinic can never lock itself out).
 *  - Patients are not team members; their accounts are not managed here.
 */

export async function list({ db }) {
  const [profiles, linkedStaff, disabled] = await Promise.all([
    profileModel.listTeam(db),
    staffModel.listLinkedProfiles(db),
    accountService.disabledUserIds(),
  ]);
  const staffByProfile = new Map(linkedStaff.map((staff) => [staff.profile_id, staff]));
  return profiles.map((profile) =>
    teamMemberView(profile, { staff: staffByProfile.get(profile.id), disabled: disabled.has(profile.id) }),
  );
}

/**
 * Creates the login with a temporary password, emails it, and returns it once so the
 * owner can hand it over if the email doesn't arrive. The member should change it at
 * first sign-in (POST /api/auth/password).
 */
export async function create({ user }, { email, full_name: fullName, role, staff_id: staffId, preferred_language: language }) {
  const created = await accountService.createTeamMember({ email, fullName, role, language });
  if (created.conflict) throw AppError.conflict('email_in_use', 'An account with this email already exists.');

  if (staffId) await staffModel.linkProfile(adminAs(user.id), staffId, created.id);

  const brand = await clinicBranding();
  sendEmailInBackground({
    template: 'welcome',
    to: email,
    language,
    data: {
      clinicName: clinicNameIn(brand, language),
      fullName,
      email,
      temporaryPassword: created.temporaryPassword,
      appUrl: config.appUrl,
    },
  });

  const profile = await profileModel.findById(requireAdmin(), created.id);
  return { member: teamMemberView(profile), temporary_password: created.temporaryPassword };
}

async function loadChangeableMember(actor, memberId) {
  if (memberId === actor.id) throw AppError.forbidden('cannot_change_self', 'You cannot change your own account here.');
  const member = await profileModel.findById(requireAdmin(), memberId);
  if (!member || member.role === 'patient') throw AppError.notFound('member_not_found', 'Team member not found.');
  if (member.role === 'owner') throw AppError.forbidden('cannot_change_owner', 'The owner account cannot be changed.');
  return member;
}

/** One member as the team screen shows them (after an edit). */
async function memberRow(memberId) {
  const admin = requireAdmin();
  const [profile, staff, disabled] = await Promise.all([
    profileModel.findById(admin, memberId),
    staffModel.findByProfileId(admin, memberId),
    accountService.disabledUserIds(),
  ]);
  return teamMemberView(profile, { staff, disabled: disabled.has(memberId) });
}

/** The owner edits a member's details (G7): name, email (their sign-in), phone, language, doctor link. */
export async function updateMember({ user }, memberId, { email, staff_id: staffId, ...details }) {
  const member = await loadChangeableMember(user, memberId);
  const db = adminAs(user.id);

  if (email && email !== member.email) {
    if (await profileModel.findByEmail(requireAdmin(), email)) throw AppError.conflict('email_in_use', 'An account with this email already exists.');
    await accountService.changeLoginEmail(memberId, email);
  }
  if (Object.keys(details).length) await profileModel.updateDetails(db, memberId, details);
  if (staffId !== undefined) {
    await staffModel.unlinkProfile(db, memberId);
    if (staffId && !(await staffModel.linkProfile(db, staffId, memberId))) throw AppError.notFound('doctor_not_found', 'Doctor not found.');
  }
  return memberRow(memberId);
}

/** Sends the welcome email again with a new temporary password (returned once, like on create). */
export async function resendInvite({ user }, memberId) {
  const member = await loadChangeableMember(user, memberId);
  const temporaryPassword = await accountService.resetTemporaryPassword(memberId);
  const language = member.preferred_language ?? 'en';
  const brand = await clinicBranding();
  sendEmailInBackground({
    template: 'welcome',
    to: member.email,
    language,
    data: { clinicName: clinicNameIn(brand, language), fullName: member.full_name, email: member.email, temporaryPassword, appUrl: config.appUrl },
  });
  return { sent: true, temporary_password: temporaryPassword };
}

export async function setRole({ user }, memberId, role) {
  await loadChangeableMember(user, memberId);
  return teamMemberView(await accountService.setTeamRole(user.id, memberId, role));
}

export async function setDisabled({ user }, memberId, disabled) {
  const member = await loadChangeableMember(user, memberId);
  await accountService.setDisabled(memberId, disabled);
  return teamMemberView(member, { disabled });
}
