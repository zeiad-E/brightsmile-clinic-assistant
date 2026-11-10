import { z } from 'zod';
import { DateOfBirth, Email, FullName, Language, Pagination, Phone, Uuid } from './common.js';
import { LIMITS } from '../agent/guardrails.js';
import { FORM_PURPOSES } from '../agent/detailsForm.js';

/**
 * What the chat's details form sends (agent/detailsForm.js). Checked with the website's own
 * rules; a bad field comes back as a 400 naming it (form.phone, …), so the form can show it.
 * Every form needs name, birth date and phone; the sign-up form needs an email too.
 */
export const DetailsForm = z
  .object({
    purpose: z.enum(FORM_PURPOSES),
    full_name: FullName,
    date_of_birth: DateOfBirth,
    phone: Phone,
    email: z.union([z.literal(''), Email]).optional(),
  })
  .refine((form) => form.purpose !== 'sign_up' || form.email, { message: 'Please add your email address.', path: ['email'] });

export const ChatBody = z.object({
  conversation_id: Uuid.optional(),
  message: z.string().trim().min(1, 'Type a message.').max(LIMITS.maxMessageChars, `Keep messages under ${LIMITS.maxMessageChars} characters.`),
  language: Language.optional(),
  form: DetailsForm.optional(),
});

export const ConversationListQuery = Pagination;

/** live = a message in the last 10 minutes; reviewed = yes/no; with_team = a team member has taken it over. */
export const StaffConversationQuery = Pagination.extend({
  status: z.enum(['active', 'handed_off', 'needs_attention', 'closed']).optional(),
  patient_id: Uuid.optional(),
  live: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  reviewed: z.enum(['yes', 'no']).optional(),
  with_team: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
}).transform(({ patient_id: patientId, with_team: withTeam, ...rest }) => ({ ...rest, patientId, withTeam }));
