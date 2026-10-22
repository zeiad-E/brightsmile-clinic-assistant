import { searchKnowledge } from './searchKnowledge.js';
import { checkAvailability } from './checkAvailability.js';
import { bookAppointment } from './bookAppointment.js';
import { escalateToHuman } from './escalateToHuman.js';
import { createPatientAccount } from './createPatientAccount.js';
import { startPatientLogin } from './startPatientLogin.js';
import { getPatientHistory } from './getPatientHistory.js';

/**
 * OpenAI-style tool (function) definitions exposed to the model,
 * plus the map of name -> handler used by the agent loop.
 */
export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: "Search the clinic's knowledge base for services, prices, hours, insurance, policies, prep instructions, and location. Use for any factual question about the clinic.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The patient question to look up.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Check open appointment slots for a given date or range and (optionally) a service.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Preferred date (YYYY-MM-DD) or natural range.' },
          service: { type: 'string', description: 'Requested service name, optional.' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Book an appointment into an open slot. Call check_availability first.',
      parameters: {
        type: 'object',
        properties: {
          patient_name: { type: 'string' },
          contact: { type: 'string', description: 'Email or phone.' },
          service: { type: 'string' },
          slot_id: { type: 'string', description: 'The id of the chosen open slot.' },
        },
        required: ['patient_name', 'contact', 'service', 'slot_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalate_to_human',
      description: 'Escalate to clinic staff for clinical questions, emergencies, or anything out of scope.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          urgency: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        },
        required: ['reason', 'urgency'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_patient_account',
      description: 'Create a patient account/profile from details gathered in the conversation.',
      parameters: {
        type: 'object',
        properties: {
          full_name: { type: 'string' },
          contact: { type: 'string', description: 'Email or phone.' },
          preferred_language: { type: 'string', enum: ['en', 'ar'] },
        },
        required: ['full_name', 'contact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_patient_login',
      description: 'Begin passwordless login by sending a magic-link / OTP to the patient contact.',
      parameters: {
        type: 'object',
        properties: { contact: { type: 'string', description: 'Email or phone on file.' } },
        required: ['contact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_patient_history',
      description: 'Fetch the logged-in patient profile and appointment history.',
      parameters: {
        type: 'object',
        properties: { patient_id: { type: 'string' } },
        required: ['patient_id'],
      },
    },
  },
];

export const toolHandlers = {
  search_knowledge: searchKnowledge,
  check_availability: checkAvailability,
  book_appointment: bookAppointment,
  escalate_to_human: escalateToHuman,
  create_patient_account: createPatientAccount,
  start_patient_login: startPatientLogin,
  get_patient_history: getPatientHistory,
};
