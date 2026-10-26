import { z } from 'zod';
import { Language, Pagination, Uuid } from './common.js';
import { LIMITS } from '../agent/guardrails.js';

export const ChatBody = z.object({
  conversation_id: Uuid.optional(),
  message: z.string().trim().min(1, 'Type a message.').max(LIMITS.maxMessageChars, `Keep messages under ${LIMITS.maxMessageChars} characters.`),
  language: Language.optional(),
});

export const ConversationListQuery = Pagination;

export const StaffConversationQuery = Pagination.extend({
  status: z.enum(['active', 'handed_off', 'needs_attention', 'closed']).optional(),
  patient_id: Uuid.optional(),
}).transform(({ patient_id: patientId, ...rest }) => ({ ...rest, patientId }));
