import { placeholderFor, unmaskValue } from './masking.js';

/**
 * The notebook: what the patient has already told us in THIS conversation, kept in
 * conversation.state, so nobody has to ask twice.
 *
 *   patient: full name, phone, email, date of birth (phone/email/birth date as placeholders,
 *            [PHONE_1]…, so the AI still never sees the real values)
 *   booking: the service, doctor, day and time they picked, and any preference ("afternoons")
 *
 * Who writes in it: the code when a message arrives (phones, emails and birth dates it already
 * finds for masking), the tools (the booking choice), the details form, and the AI with note_details
 * (names and preferences only the AI can understand).
 * Who reads it: the AI (in CONTEXT, every turn), the tools (they fill in what the AI leaves out)
 * and the details form (it opens filled in).
 *
 * Like the slip at the front desk: whoever picks up the chat reads the slip first.
 */

export const PATIENT_KEYS = ['full_name', 'date_of_birth', 'phone', 'email'];
const PLACEHOLDER_KIND = { phone: 'PHONE', email: 'EMAIL', date_of_birth: 'DOB' };
const BOOKING_KEYS = ['service', 'doctor', 'date', 'time', 'preference'];
const CHOICE_KEYS = ['service', 'doctor', 'date', 'time'];

export function notebookOf(state) {
  state.notebook ??= { patient: {}, booking: {} };
  return state.notebook;
}

const filled = (value) => (typeof value === 'string' ? value.trim() : '') || null;

/**
 * Writes what was learnt (only non-empty values; a new value replaces the old one).
 * Real phones/emails/birth dates (as tools receive them) are stored as their placeholders.
 * A new service starts the choice over (the old doctor and time were for the old service), and a
 * changed choice drops a booking still waiting for "yes": confirming it would book the old time.
 */
export function note(state, { patient = {}, booking = {} }, map = {}) {
  const book = notebookOf(state);
  for (const key of PATIENT_KEYS) {
    const value = filled(patient[key]);
    if (value) book.patient[key] = PLACEHOLDER_KIND[key] ? placeholderFor(map, PLACEHOLDER_KIND[key], value) : value;
  }

  const before = JSON.stringify(CHOICE_KEYS.map((key) => book.booking[key] ?? null));
  const service = filled(booking.service);
  if (service && book.booking.service && service !== book.booking.service) {
    for (const key of ['doctor', 'date', 'time']) delete book.booking[key];
  }
  for (const key of BOOKING_KEYS) {
    const value = filled(booking[key]);
    if (value) book.booking[key] = value;
  }
  const changed = before !== JSON.stringify(CHOICE_KEYS.map((key) => book.booking[key] ?? null));
  if (changed && state.pending?.type === 'book') delete state.pending;
  return book;
}

const FIELD_OF = { PHONE: 'phone', EMAIL: 'email', DOB: 'date_of_birth' };

/** The placeholders in the patient's (masked) message → their details. The last one of each kind wins. */
export function noteFromMessage(state, maskedMessage) {
  const found = {};
  for (const [placeholder, kind] of String(maskedMessage ?? '').matchAll(/\[(PHONE|EMAIL|DOB)_\d+\]/g)) found[FIELD_OF[kind]] = placeholder;
  if (Object.keys(found).length) note(state, { patient: found });
}

/** The patient's details with real values, for a tool or the form (never for the AI). */
export function patientDetails(state, map) {
  const { patient } = notebookOf(state);
  return Object.fromEntries(PATIENT_KEYS.filter((key) => patient[key]).map((key) => [key, unmaskValue(patient[key], map)]));
}

const LABELS = { full_name: 'full name', date_of_birth: 'date of birth', phone: 'phone', email: 'email', service: 'service', doctor: 'doctor', date: 'day', time: 'time', preference: 'preference' };

/**
 * The notebook as the AI reads it in CONTEXT. A signed-in patient's details come from their
 * account, so for them only the booking choice is shown.
 */
export function describeNotebook(notebook, { signedIn = false } = {}) {
  const { patient = {}, booking = {} } = notebook ?? {};
  const lines = [];
  if (!signedIn) {
    const known = PATIENT_KEYS.filter((key) => patient[key]).map((key) => `${LABELS[key]}: ${patient[key]}`);
    const missing = PATIENT_KEYS.filter((key) => !patient[key]).map((key) => LABELS[key]);
    lines.push(`- Patient: ${known.length ? known.join(' · ') : 'nothing yet'}${missing.length ? ` (not given yet: ${missing.join(', ')})` : ''}`);
  }
  const choice = BOOKING_KEYS.filter((key) => booking[key]).map((key) => `${LABELS[key]}: ${booking[key]}`);
  lines.push(`- Booking choice: ${choice.length ? choice.join(' · ') : 'nothing yet'}`);
  return lines.join('\n');
}
