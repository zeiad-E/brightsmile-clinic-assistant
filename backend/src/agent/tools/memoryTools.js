import { z } from 'zod';
import * as memoryService from '../../services/memoryService.js';
import * as intakeService from '../../services/intakeService.js';
import { defineTool, toolError } from './define.js';

/** Remembering the patient, recalling earlier chats, intake answers, and "forget me". */

export const remember = defineTool({
  name: 'remember',
  description:
    'Save a short, useful note about the signed-in patient for future conversations — a preference, communication style, or practical detail. Examples: "Prefers afternoon appointments", "Writes in Egyptian Arabic; reply the same way", "Lives in Alexandria, prefers slots after 1 pm", "Prefers short replies". Never health information, contact details, or judgements.',
  schema: z.object({
    kind: z.enum(['preference', 'communication_style', 'logistics']),
    content: z.string().min(3).max(200).describe('One kind, factual sentence.'),
  }),
  signedIn: true,
  run: async ({ kind, content }, ctx) => {
    const result = await memoryService.remember({
      patientId: ctx.user.patientId,
      conversationId: ctx.conversation.id,
      kind,
      content,
    });
    if (result.saved) ctx.events.remembered = true;
    return result;
  },
});

export const recallPastConversations = defineTool({
  name: 'recall_past_conversations',
  description:
    'Look up what was discussed with this signed-in patient in earlier conversations. Use only when they refer to the past ("last time", "as I told you before", "my previous request").',
  schema: z.object({ question: z.string().min(3).max(300).describe('What you want to find in past conversations.') }),
  signedIn: true,
  run: async ({ question }, ctx) => {
    const found = await memoryService.recall({ patientId: ctx.user.patientId, currentConversationId: ctx.conversation.id, question });
    return found.length ? { past_conversations: found } : { past_conversations: [], note: 'Nothing relevant found in earlier conversations.' };
  },
});

export const updateIntake = defineTool({
  name: 'update_intake',
  description:
    'Save the patient’s answers to the clinic’s intake questions listed in CONTEXT (use the question keys). Save only what the patient actually answered.',
  schema: z.object({ answers: z.record(z.string(), z.string().max(100)).describe('e.g. {"insurance": "NileCare Health", "city": "Nasr City"}') }),
  signedIn: true,
  run: async ({ answers }, ctx) => {
    const result = await intakeService.saveAnswers(ctx.user.patientId, answers);
    return { ...result, next: result.rejected.length ? 'Ask again for the rejected answers, kindly.' : undefined };
  },
});

export const proposeForgetMe = defineTool({
  name: 'propose_forget_me',
  description:
    'The patient asks to delete what you remember about them and their past conversations. This prepares it (nothing is deleted yet): explain what will be deleted (notes and past chats; bookings stay) and ask them to confirm, then call confirm_pending_action.',
  signedIn: true,
  run: async (_args, ctx) => {
    if (!ctx.user?.patientId) return toolError('sign_in_required', 'Sign the patient in first.');
    if (ctx.state.pending?.type === 'forget' && ctx.state.pending.proposedAtTurn < ctx.turnNumber) {
      return toolError('already_proposed', 'This was already explained to the patient. If they agreed, call confirm_pending_action now.');
    }
    ctx.state.pending = { type: 'forget', proposedAtTurn: ctx.turnNumber, input: {}, summary: { what: 'memory notes and past conversations' } };
    return { pending: true, next: 'Explain: their notes and past conversations will be deleted; bookings and their account stay. Ask them to confirm.' };
  },
});
