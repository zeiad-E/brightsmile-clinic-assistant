import { z } from 'zod';
import { Language, Pagination, Uuid } from './common.js';
import { LIMITS } from '../agent/guardrails.js';

export const ChatBody = z.object({
  conversation_id: Uuid.optional(),
  message: z.string().trim().min(1, 'Type a message.').max(LIMITS.maxMessageChars, `Keep messages under ${LIMITS.maxMessageChars} characters.`),
  language: Language.optional(),
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
