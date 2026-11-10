import { z } from 'zod';
import { isValidDay, weekdayName, zonedDateTime } from '../../utils/clinicTime.js';
import { FORM_PURPOSES, showDetailsForm } from '../detailsForm.js';
import { note, notebookOf } from '../notebook.js';
import { isFree, nextAlternatives, resolveDoctor, resolveService } from './bookingTools.js';
import { defineTool, toolError } from './define.js';

/**
 * The notebook and the details form, as tools the AI can call (see agent/notebook.js and
 * agent/detailsForm.js for how they work).
 */

export const showDetailsFormTool = defineTool({
  name: 'show_details_form',
  description:
    'Show the patient a friendly form in the chat for their personal details, already filled in with what the NOTEBOOK has; they check it, fix it and fill in the rest. Use it instead of asking for name, phone, email or date of birth in text. purpose "booking": a FIRST-TIME patient who has picked service, doctor and time (pass them, or they come from the NOTEBOOK). "sign_in": a RETURNING patient (phone, full name, date of birth), to book or to see their bookings. "sign_up": an account without booking.',
  schema: z.object({
    purpose: z.enum(FORM_PURPOSES),
    service: z.string().max(80).optional().describe('booking: the service they chose.'),
    doctor: z.string().max(80).optional().describe('booking: the doctor they chose.'),
    date: z.string().max(10).optional().describe('booking: the day they chose, YYYY-MM-DD.'),
    time: z.string().max(5).optional().describe('booking: the start time they chose, HH:MM.'),
  }),
  run: async ({ purpose, service, doctor, date, time }, ctx) => {
    if (ctx.isPatient) {
      return purpose === 'booking'
        ? toolError('signed_in', 'This patient is signed in: their details come from their account. Call propose_booking directly.')
        : { already_signed_in: true };
    }
    if (purpose === 'sign_in' && ctx.state.firstVisit === true) {
      return toolError('first_visit', 'This patient said it is their first visit, so they have no account to sign in to. Once they picked a time, use purpose "booking".');
    }
    if (purpose === 'booking' && ctx.state.firstVisit === false) {
      return toolError('returning_patient', 'This patient has visited before: use purpose "sign_in" so they sign in to their own file. After that, call propose_booking.');
    }
    if (purpose !== 'booking') return showDetailsForm(ctx, purpose);

    // A booking form only makes sense for a real, free time: check it before the patient types anything.
    const chosen = { ...notebookOf(ctx.state).booking, ...Object.fromEntries(Object.entries({ service, doctor, date, time }).filter(([, v]) => v)) };
    const missing = ['service', 'doctor', 'date', 'time'].filter((key) => !chosen[key]);
    if (missing.length) {
      return toolError('choose_first', 'Help the patient choose the service, doctor and time first (check_availability), then show the form.', { missing });
    }
    if (!isValidDay(chosen.date) || !/^\d{2}:\d{2}$/.test(chosen.time)) return toolError('invalid_time', 'Use date YYYY-MM-DD and time HH:MM.');
    const { match: svc } = await resolveService(ctx, chosen.service);
    if (!svc) return toolError('service_not_found', `No service matches "${chosen.service}".`);
    const { match: doc } = await resolveDoctor(ctx, chosen.doctor, svc.id);
    if (!doc) return toolError('doctor_not_found', `No doctor offering ${svc.name_en} matches "${chosen.doctor}".`);
    const startsAt = zonedDateTime(chosen.date, chosen.time, ctx.timeZone);
    if (!(await isFree(ctx, { serviceId: svc.id, staffId: doc.id, day: chosen.date, startsAt }))) {
      return toolError('time_not_available', 'That time is not free.', { alternatives: await nextAlternatives(ctx, { serviceId: svc.id, staffId: doc.id, after: startsAt }) });
    }

    note(ctx.state, { booking: { service: svc.name_en, doctor: doc.full_name_en, date: chosen.date, time: chosen.time } });
    const booking = { service: svc.name_en, service_ar: svc.name_ar, doctor: doc.full_name_en, doctor_ar: doc.full_name_ar, date: chosen.date, weekday: weekdayName(chosen.date), time: chosen.time };
    return showDetailsForm(ctx, 'booking', { booking });
  },
});

export const noteDetails = defineTool({
  name: 'note_details',
  description:
    'Write in the NOTEBOOK what the patient just told you in this chat, so you never ask for it again: their full name, a booking choice (service, doctor, day, time) or a preference ("afternoons only", "Dr. Sarah only"). Phones, emails and birth dates they type are noted automatically; pass placeholders exactly as written if you add them.',
  schema: z.object({
    full_name: z.string().max(120).optional(),
    phone: z.string().max(40).optional().describe('Placeholder, e.g. [PHONE_1].'),
    email: z.string().max(254).optional().describe('Placeholder, e.g. [EMAIL_1].'),
    date_of_birth: z.string().max(40).optional().describe('Placeholder, e.g. [DOB_1].'),
    service: z.string().max(80).optional(),
    doctor: z.string().max(80).optional(),
    date: z.string().max(10).optional().describe('YYYY-MM-DD'),
    time: z.string().max(5).optional().describe('HH:MM'),
    preference: z.string().max(120).optional().describe('e.g. "afternoons only".'),
  }),
  run: async (args, ctx) => {
    const booking = { doctor: args.doctor, date: args.date, time: args.time, preference: args.preference };
    // The service's real name, so the notebook (and the form) agree with what the tools use.
    if (args.service) booking.service = (await resolveService(ctx, args.service)).match?.name_en ?? args.service;
    note(ctx.state, { patient: args, booking }, ctx.map);
    return { noted: Object.keys(args).filter((key) => args[key]) };
  },
});
