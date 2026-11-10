import { cleanDate, cleanPhone } from '../validators/common.js';
import { patientDetails } from './notebook.js';

/**
 * The details form: a card in the chat where the patient fills in (or checks) their personal
 * details, instead of the assistant asking for them one message at a time.
 *
 * It opens filled in from the notebook. What the patient sends goes straight to the server
 * (chatService, `form`), is checked there with the same rules as the website, and lands in the
 * notebook; the AI only ever sees placeholders.
 */

/** Which fields each form asks for. All are required unless `optional`. */
export const FORM_FIELDS = {
  booking: [{ key: 'full_name' }, { key: 'date_of_birth' }, { key: 'phone' }, { key: 'email', optional: true }],
  sign_in: [{ key: 'phone' }, { key: 'full_name' }, { key: 'date_of_birth' }],
  sign_up: [{ key: 'full_name' }, { key: 'date_of_birth' }, { key: 'phone' }, { key: 'email' }],
};
export const FORM_PURPOSES = Object.keys(FORM_FIELDS);

/**
 * Puts the form on the patient's screen and tells the AI what to write next.
 * `booking` (optional) is the chosen time, shown at the top of the form so the patient sees what
 * the details are for. `notice` is a short code the page turns into a sentence (e.g. 'not_matched').
 */
export function showDetailsForm(ctx, purpose, { booking = null, notice = null } = {}) {
  const known = patientDetails(ctx.state, ctx.map);
  const values = {};
  for (const { key } of FORM_FIELDS[purpose]) {
    if (!known[key]) continue;
    // Tidy what can be tidied (0100 123 4567 → +201001234567, 15/3/1990 → 1990-03-15) so the form
    // starts clean; what can't be fixed stays as typed, and the form shows what is wrong with it.
    values[key] = key === 'phone' ? cleanPhone(known[key]) : key === 'date_of_birth' ? cleanDate(known[key]) : known[key];
  }
  ctx.emit({ type: 'details_form', purpose, fields: FORM_FIELDS[purpose], values, ...(booking && { booking }), ...(notice && { notice }) });

  return {
    form_shown: true,
    purpose,
    already_filled: Object.keys(values),
    still_needed: FORM_FIELDS[purpose].filter((field) => !field.optional && !values[field.key]).map((field) => field.key),
    next:
      notice === 'not_matched'
        ? 'Those details did not match a patient file. The form is back on their screen: in one kind line, ask them to check the phone number and date of birth they gave the clinic, or offer staff help.'
        : 'The details form is now on the patient’s screen, filled in with what you already know. Write ONE short, warm line inviting them to check it and fill in the rest (for example "Just a few details and your booking is ready."). Do not ask for the details in your text and do not list them. Then wait for them to send it.',
  };
}
