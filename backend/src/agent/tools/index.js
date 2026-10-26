import { listDoctors, listServices, searchKnowledge } from './catalogTools.js';
import {
  checkAvailability,
  confirmPendingAction,
  myAppointments,
  proposeBooking,
  proposeCancel,
  proposeReschedule,
} from './bookingTools.js';
import { sendEmailCode, signInWithCode, signInWithPhone, verifyEmailCode } from './accountTools.js';
import { declineRequest, escalateToHuman } from './supportTools.js';
import { proposeForgetMe, recallPastConversations, remember, updateIntake } from './memoryTools.js';
import { toOpenAiDefinition } from './define.js';

/**
 * The patient assistant's toolbox — the ONLY things it can do. Each tool goes through the
 * same tested services as the website, with the same permission checks.
 */
export const patientTools = [
  searchKnowledge,
  listServices,
  listDoctors,
  checkAvailability,
  proposeBooking,
  myAppointments,
  proposeCancel,
  proposeReschedule,
  confirmPendingAction,
  signInWithPhone,
  signInWithCode,
  sendEmailCode,
  verifyEmailCode,
  remember,
  recallPastConversations,
  updateIntake,
  proposeForgetMe,
  escalateToHuman,
  declineRequest,
];

export const toolsByName = new Map(patientTools.map((tool) => [tool.name, tool]));
export const toolDefinitions = patientTools.map(toOpenAiDefinition);

/**
 * Safe mode (the clinic is close to its daily AI budget): answer from the knowledge base and
 * catalog, hand over to staff, decline off-topic — but no booking, sign-in or memory work.
 */
const safeModeTools = [searchKnowledge, listServices, listDoctors, escalateToHuman, declineRequest];
export const safeModeToolsByName = new Map(safeModeTools.map((tool) => [tool.name, tool]));
export const safeModeDefinitions = safeModeTools.map(toOpenAiDefinition);
