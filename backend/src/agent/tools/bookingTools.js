import crypto from 'node:crypto';
import { z } from 'zod';
import { requireAdmin } from '../../db/supabase.js';
import * as availabilityModel from '../../models/availabilityModel.js';
import * as appointmentModel from '../../models/appointmentModel.js';
import * as patientModel from '../../models/patientModel.js';
import * as catalogService from '../../services/catalogService.js';
import * as availabilityService from '../../services/availabilityService.js';
import * as bookingService from '../../services/bookingService.js';
import * as appointmentService from '../../services/appointmentService.js';
import * as authService from '../../services/authService.js';
import * as memoryService from '../../services/memoryService.js';
import * as waitlistService from '../../services/waitlistService.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { addDays, dayInZone, isValidDay, timeInZone, weekdayName, zonedDateTime } from '../../utils/clinicTime.js';
import { bestMatch } from '../../utils/text.js';
import { DateOfBirth, Email, FullName, Phone } from '../../validators/common.js';
import { showDetailsForm } from '../detailsForm.js';
import { note, notebookOf, patientDetails } from '../notebook.js';
import { defineTool, toolError } from './define.js';

/**
 * Free times, booking, cancelling, rescheduling, the waitlist.
 *
 * Every change is two steps — the confirmation gate:
 *   1. propose_* checks everything and stores the action as "pending" (nothing changes yet);
 *   2. confirm_pending_action runs it, but ONLY if the patient sent a new message after the
 *      proposal. The AI can't book in the same breath as proposing; the patient always gets
 *      a chance to say yes or no.
 */

const Day = z.string().describe('Date as YYYY-MM-DD (clinic time, Cairo).');
const Time = z.string().describe('Start time as HH:MM, 24-hour, clinic time.');

export async function resolveService(ctx, text) {
  const services = await catalogService.listServices(ctx.db);
  return { match: bestMatch(services, text, ['slug', 'name_en', 'name_ar']), services };
}

export async function resolveDoctor(ctx, text, serviceId) {
  const doctors = (await catalogService.listDoctors(ctx.db)).filter((d) => !serviceId || d.service_ids.includes(serviceId));
  return { match: text ? bestMatch(doctors, text, ['full_name_en', 'full_name_ar']) : null, doctors };
}

/**
 * Up to `max` times spread across the whole day (not just the first ones), so morning AND
 * afternoon options are always visible to the assistant.
 */
export function describeSlots(slots, max = 10) {
  const times = slots.map((s) => timeInZone(s.starts_at));
  if (times.length <= max) return times;
  const step = (times.length - 1) / (max - 1);
  return [...new Set(Array.from({ length: max }, (_, i) => times[Math.round(i * step)]))];
}

/** Free start times as HH:MM for the AI (it books with date + time, never with raw ISO). */
export const checkAvailability = defineTool({
  name: 'check_availability',
  description:
    'Find free start times for a service. Give a doctor to see only that doctor, or leave it out for every doctor offering the service. Always check before proposing a time; never guess availability.',
  schema: z.object({
    service: z.string().min(2).max(80).describe('Service name or slug, as the patient said it.'),
    from: Day.optional().describe('First day to search (YYYY-MM-DD). Defaults to today.'),
    days: z.number().int().min(1).max(7).optional().describe('How many days to search (1–7). Default 3.'),
    doctor: z.string().max(80).optional().describe('Doctor name, if the patient asked for one.'),
  }),
  run: async ({ service, from, days = 3, doctor }, ctx) => {
    const { match, services } = await resolveService(ctx, service);
    if (!match) return toolError('service_not_found', `No service matches "${service}".`, { services: services.map((s) => s.name_en) });

    const start = from && isValidDay(from) ? from : dayInZone(new Date(), ctx.timeZone);
    let staffId;
    let doctorName;
    if (doctor) {
      const { match: doc, doctors } = await resolveDoctor(ctx, doctor, match.id);
      if (!doc) return toolError('doctor_not_found', `No doctor offering ${match.name_en} matches "${doctor}".`, { doctors: doctors.map((d) => d.full_name_en) });
      staffId = doc.id;
      doctorName = doc.full_name_en;
    }
    note(ctx.state, { booking: { service: match.name_en, doctor: doctorName } });

    const result = await availabilityService.forRange(ctx.db, { serviceId: match.id, staffId, from: start, days });
    const doctorNames = new Map((await catalogService.listDoctors(ctx.db)).map((d) => [d.id, d]));
    const doctorsOut = result.doctors.map((d) => ({
      doctor: doctorNames.get(d.staff_id)?.full_name_en ?? d.full_name_en,
      doctor_ar: doctorNames.get(d.staff_id)?.full_name_ar ?? d.full_name_ar,
      days: d.days
        .filter((day) => day.slots.length)
        .map((day) => ({
          date: day.date,
          weekday: weekdayName(day.date),
          first: timeInZone(day.slots[0].starts_at),
          last: timeInZone(day.slots.at(-1).starts_at),
          free_count: day.slots.length,
          sample_times: describeSlots(day.slots), // spread over the day; any free start between first and last can be proposed
        })),
    }));

    ctx.emit({ type: 'slots', service: match.name_en, service_ar: match.name_ar, doctors: doctorsOut });
    const any = doctorsOut.some((d) => d.days.length);
    return {
      service: match.name_en,
      duration_minutes: match.duration_minutes,
      price_egp: match.price_egp,
      searched: { from: start, to: addDays(start, days - 1) },
      doctors: doctorsOut,
      note: any ? undefined : 'No free times in this range. Offer to search later days or another doctor.',
    };
  },
});

export async function nextAlternatives(ctx, { serviceId, staffId, after }) {
  const slots = await availabilityService.nextFreeSlots(ctx.db, { serviceId, staffId, after, timeZone: ctx.timeZone });
  return slots.map((s) => ({ date: dayInZone(new Date(s.starts_at), ctx.timeZone), time: timeInZone(s.starts_at) }));
}

export async function isFree(ctx, { serviceId, staffId, day, startsAt }) {
  const slots = await availabilityModel.slotsFor(ctx.db, { serviceId, staffId, day });
  return slots.some((s) => new Date(s.slot_start).getTime() === new Date(startsAt).getTime());
}

/**
 * A guest whose phone or email is already on a patient file. The file is theirs only if the full
 * name and date of birth match it too: the same check as signing in with the phone, so knowing
 * someone's number is never enough. Then they are signed in and the booking goes on their own
 * account. If the details don't match, the form comes back NOW with a note (instead of the booking
 * failing at "yes, book it"). Returns null for a new patient: booking creates their file.
 */
async function signInToFile(ctx, guest, booking) {
  const db = requireAdmin();
  const byPhone = guest.phone ? await patientModel.findByPhone(db, guest.phone) : null;
  const byEmail = guest.email ? await patientModel.findByEmail(db, guest.email) : null;
  if (!byPhone && !byEmail) return null;
  const mismatch = () => ({ ...showDetailsForm(ctx, 'booking', { booking, notice: 'file_mismatch' }), on_file: true });
  // The email is on a file but the phone isn't that file's: only the phone check can prove whose it is.
  if (!byPhone || (byEmail && byEmail.id !== byPhone.id)) return mismatch();
  try {
    const verified = await authService.phoneLogin({ phone: guest.phone, full_name: guest.full_name, date_of_birth: guest.date_of_birth }, { visitor: ctx.visitor });
    if (!(await ctx.signIn(verified))) return toolError('login_unavailable', 'This patient has a file but can’t be signed in online. Offer to connect them with staff.');
    return { signed_in: true };
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    if (err.code === 'account_locked') return toolError('locked', 'Too many wrong tries: this patient file is locked for 15 minutes. Offer staff help.');
    if (err.code === 'invalid_credentials') return mismatch();
    return toolError(err.code, err.message);
  }
}

/** The same action is already waiting from an earlier turn (so the patient has replied to it since). */
const alreadyProposed = (ctx, type, same) => {
  const earlier = ctx.state.pending;
  return earlier?.type === type && earlier.proposedAtTurn < ctx.turnNumber && same(earlier.input);
};

export const proposeBooking = defineTool({
  name: 'propose_booking',
  description:
    'Prepare a booking (does NOT book yet). Checks the time is free and the details are valid, then shows the patient a summary card to check. Ask them to confirm; only after they agree, call confirm_pending_action. Personal details can be left out: a signed-in patient’s come from their account, a guest’s from the NOTEBOOK. If a guest’s details are missing or wrong, this shows the details form instead (form_shown): then write one short line pointing to it.',
  schema: z.object({
    service: z.string().min(2).max(80),
    doctor: z.string().min(2).max(80).describe('The doctor chosen from check_availability.'),
    date: Day,
    time: Time,
    full_name: z.string().max(120).optional().describe('Guests: full name, if they told you and it is not in the NOTEBOOK yet.'),
    date_of_birth: z.string().max(40).optional().describe('Guests: date of birth placeholder (e.g. [DOB_1]); not needed when the NOTEBOOK has it.'),
    email: z.string().max(254).optional().describe('Guests: email placeholder (e.g. [EMAIL_1]); not needed when the NOTEBOOK has it.'),
    phone: z.string().max(40).optional().describe('Guests: phone placeholder (e.g. [PHONE_1]); not needed when the NOTEBOOK has it.'),
    notes: z.string().max(300).optional().describe('Anything the patient wants the clinic to know (not medical history).'),
  }),
  run: async (args, ctx) => {
    if (!isValidDay(args.date) || !/^\d{2}:\d{2}$/.test(args.time)) return toolError('invalid_time', 'Use date YYYY-MM-DD and time HH:MM.');

    const { match: service } = await resolveService(ctx, args.service);
    if (!service) return toolError('service_not_found', `No service matches "${args.service}".`);
    const { match: doctor } = await resolveDoctor(ctx, args.doctor, service.id);
    if (!doctor) return toolError('doctor_not_found', `No doctor offering ${service.name_en} matches "${args.doctor}".`);

    const startsAt = zonedDateTime(args.date, args.time, ctx.timeZone);
    // Proposing the same booking again after the patient replied would restart the wait for their
    // "yes", so confirm_pending_action would refuse it (the eval saw exactly that on 2026-11-09).
    if (alreadyProposed(ctx, 'book', (input) => input.service_id === service.id && input.staff_id === doctor.id && input.starts_at === startsAt)) {
      return toolError('already_proposed', 'This booking was already proposed and the patient has replied since. If they agreed, call confirm_pending_action now. Propose again only if they changed something.');
    }
    if (!(await isFree(ctx, { serviceId: service.id, staffId: doctor.id, day: args.date, startsAt }))) {
      return toolError('time_not_available', 'That time is not free.', {
        alternatives: await nextAlternatives(ctx, { serviceId: service.id, staffId: doctor.id, after: startsAt }),
      });
    }

    // The choice (and any details the AI passed) go in the notebook first, so the form and the
    // next turns have them even if this booking can't be prepared yet.
    note(ctx.state, { patient: ctx.isPatient ? {} : args, booking: { service: service.name_en, doctor: doctor.full_name_en, date: args.date, time: args.time } }, ctx.map);

    const booking = { service: service.name_en, service_ar: service.name_ar, doctor: doctor.full_name_en, doctor_ar: doctor.full_name_ar, date: args.date, weekday: weekdayName(args.date), time: args.time };
    let person;
    let welcomedBack = false;
    if (!ctx.isPatient) {
      // Whatever the AI left out comes from the notebook, so the patient never repeats themselves.
      const details = patientDetails(ctx.state, ctx.map);
      const name = FullName.safeParse(details.full_name ?? '');
      const dob = DateOfBirth.safeParse(details.date_of_birth ?? '');
      const email = details.email ? Email.safeParse(details.email) : null;
      const phone = details.phone ? Phone.safeParse(details.phone) : null;
      const contactOk = (email?.success || phone?.success) && email?.success !== false && phone?.success !== false;
      if (!name.success || !dob.success || !contactOk) {
        // Missing or wrong: the form asks for it, filled in with what we have and showing what is
        // wrong, instead of the AI asking again. A returning patient signs in to their own file.
        return showDetailsForm(ctx, ctx.state.firstVisit === false ? 'sign_in' : 'booking', { booking });
      }
      const guest = { full_name: name.data, date_of_birth: dob.data, email: email?.data, phone: phone?.data, preferred_language: ctx.language };
      const onFile = await signInToFile(ctx, guest, booking);
      if (!onFile) person = guest;
      else if (onFile.signed_in) welcomedBack = true;
      else return onFile; // the details don't match the file: the form is back, or staff help
    }
    if (ctx.isPatient) {
      const patient = await patientModel.findById(requireAdmin(), ctx.user.patientId);
      person = { full_name: patient.full_name, email: patient.email, phone: patient.phone, preferred_language: patient.preferred_language };
    }

    const summary = {
      service: service.name_en,
      service_ar: service.name_ar,
      doctor: doctor.full_name_en,
      doctor_ar: doctor.full_name_ar,
      date: args.date,
      weekday: weekdayName(args.date),
      time: args.time,
      duration_minutes: service.duration_minutes,
      price_egp: service.price_egp,
      patient_name: person.full_name,
    };
    ctx.state.pending = {
      type: 'book',
      proposedAtTurn: ctx.turnNumber,
      input: { service_id: service.id, staff_id: doctor.id, starts_at: startsAt, notes: args.notes, ...person },
      summary,
    };
    // The card also shows a guest's own details, so they check everything in one place. These go to
    // their screen only, never into the AI's result below.
    ctx.emit({ type: 'booking_summary', ...summary, ...(!ctx.isPatient && { patient_phone: person.phone, patient_email: person.email, patient_dob: person.date_of_birth }) });
    return {
      pending: true,
      summary,
      ...(welcomedBack && { signed_in: true, note: 'This patient already had a file with the clinic: they are now signed in and the booking goes on their account. Welcome them back by first name, in one short line.' }),
      next: 'Read this back and ask the patient to confirm. Do not call confirm_pending_action until they reply yes.',
    };
  },
});

/** "1992-04-15", "15/04/1992", "15 April 1992" → "1992-04-15". */
export const myAppointments = defineTool({
  name: 'my_appointments',
  description: 'List the signed-in patient’s bookings. Each has an id_for_tools (A1, A2…) to pass to propose_cancel / propose_reschedule — never show it to the patient.',
  schema: z.object({ scope: z.enum(['upcoming', 'past']).optional().describe('Default upcoming.') }),
  signedIn: true,
  run: async ({ scope = 'upcoming' }, ctx) => {
    const page = await appointmentService.listMine({ user: ctx.user, db: ctx.db }, { scope, limit: 10, offset: 0 });
    ctx.state.refs = {};
    const appointments = page.data.map((a, i) => {
      const ref = `A${i + 1}`;
      ctx.state.refs[ref] = a.id;
      const day = dayInZone(new Date(a.starts_at), ctx.timeZone);
      return { id_for_tools: ref, date: day, weekday: weekdayName(day), time: timeInZone(a.starts_at), service: a.service.name_en, doctor: a.doctor.full_name_en, status: a.status };
    });
    ctx.emit({ type: 'appointments', appointments: appointments.map(({ id_for_tools: _ref, ...rest }) => rest) });
    return { scope, appointments, note: 'Describe bookings by service, doctor, day and time. id_for_tools is internal: never mention it.' };
  },
});

async function loadOwnAppointment(ctx, ref) {
  const id = ctx.state.refs?.[ref] ?? (/^[0-9a-f-]{36}$/i.test(ref) ? ref : null);
  if (!id) return { error: toolError('unknown_appointment', 'Call my_appointments first and use one of its id_for_tools values (A1, A2…).') };
  const appointment = await appointmentModel.findById(ctx.db, id);
  if (!appointment || appointment.patient_id !== ctx.user.patientId) return { error: toolError('unknown_appointment', 'That booking was not found.') };
  if (appointment.status !== 'booked') return { error: toolError('not_active', 'That booking is no longer active.') };
  return { appointment };
}

export const proposeCancel = defineTool({
  name: 'propose_cancel',
  description: 'Prepare cancelling one of the patient’s bookings (does NOT cancel yet). Ask the patient to confirm, then call confirm_pending_action.',
  schema: z.object({ appointment: z.string().min(2).max(40).describe('id_for_tools from my_appointments, e.g. A1.'), reason: z.string().max(200).optional() }),
  signedIn: true,
  run: async ({ appointment: ref, reason }, ctx) => {
    const { appointment, error } = await loadOwnAppointment(ctx, ref);
    if (error) return error;
    const earlier = ctx.state.pending;
    if (earlier?.type === 'cancel' && earlier.input.id === appointment.id && earlier.proposedAtTurn < ctx.turnNumber) {
      return toolError('already_proposed', 'This cancellation was already proposed. If the patient agreed, call confirm_pending_action now.');
    }
    const day = dayInZone(new Date(appointment.starts_at), ctx.timeZone);
    const summary = { service: appointment.service.name_en, doctor: appointment.doctor.full_name_en, date: day, weekday: weekdayName(day), time: timeInZone(appointment.starts_at) };
    ctx.state.pending = { type: 'cancel', proposedAtTurn: ctx.turnNumber, input: { id: appointment.id, reason }, summary };
    return { pending: true, summary, next: 'Ask the patient to confirm the cancellation.' };
  },
});

export const proposeReschedule = defineTool({
  name: 'propose_reschedule',
  description: 'Prepare moving one of the patient’s bookings to a new free time (does NOT move it yet). Check availability first, then ask the patient to confirm and call confirm_pending_action.',
  schema: z.object({
    appointment: z.string().min(2).max(40).describe('id_for_tools from my_appointments, e.g. A1.'),
    date: Day,
    time: Time,
    doctor: z.string().max(80).optional().describe('Only if changing doctor.'),
  }),
  signedIn: true,
  run: async ({ appointment: ref, date, time, doctor }, ctx) => {
    const { appointment, error } = await loadOwnAppointment(ctx, ref);
    if (error) return error;
    if (!isValidDay(date) || !/^\d{2}:\d{2}$/.test(time)) return toolError('invalid_time', 'Use date YYYY-MM-DD and time HH:MM.');

    let staffId = appointment.staff_id;
    let doctorName = appointment.doctor.full_name_en;
    if (doctor) {
      const { match } = await resolveDoctor(ctx, doctor, appointment.service_id);
      if (!match) return toolError('doctor_not_found', `No doctor offering this service matches "${doctor}".`);
      staffId = match.id;
      doctorName = match.full_name_en;
    }
    const startsAt = zonedDateTime(date, time, ctx.timeZone);
    if (alreadyProposed(ctx, 'reschedule', (input) => input.id === appointment.id && input.starts_at === startsAt && input.staff_id === staffId)) {
      return toolError('already_proposed', 'This change was already proposed and the patient has replied since. If they agreed, call confirm_pending_action now.');
    }
    if (!(await isFree(ctx, { serviceId: appointment.service_id, staffId, day: date, startsAt }))) {
      return toolError('time_not_available', 'That time is not free.', {
        alternatives: await nextAlternatives(ctx, { serviceId: appointment.service_id, staffId, after: startsAt }),
      });
    }
    const summary = { service: appointment.service.name_en, doctor: doctorName, from: { date: dayInZone(new Date(appointment.starts_at), ctx.timeZone), time: timeInZone(appointment.starts_at) }, to: { date, weekday: weekdayName(date), time } };
    ctx.state.pending = { type: 'reschedule', proposedAtTurn: ctx.turnNumber, input: { id: appointment.id, starts_at: startsAt, staff_id: staffId }, summary };
    return { pending: true, summary, next: 'Ask the patient to confirm the new time.' };
  },
});

/** A stable key per pending booking: retrying the same confirmation can never book twice. */
const idempotencyKeyFor = (conversationId, input) => {
  const hex = crypto.createHash('sha256').update(`${conversationId}:${JSON.stringify(input)}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export const confirmPendingAction = defineTool({
  name: 'confirm_pending_action',
  description: 'Carry out the pending booking / cancellation / reschedule / forget-me. Call ONLY after the patient clearly agreed (e.g. "yes", "confirm", "تمام", "أيوه") to the summary you read back.',
  run: async (_args, ctx) => {
    const pending = ctx.state.pending;
    if (!pending) return toolError('nothing_pending', 'There is nothing to confirm. Propose the action first.');
    if (pending.proposedAtTurn >= ctx.turnNumber) {
      return toolError('needs_patient_confirmation', 'The patient has not replied to the summary yet. Ask them to confirm first.');
    }

    try {
      if (pending.type === 'book') {
        const { body, signIn } = await bookingService.bookAsVisitor({ user: ctx.isPatient ? ctx.user : null }, pending.input, idempotencyKeyFor(ctx.conversation.id, pending.input));
        delete ctx.state.pending;
        notebookOf(ctx.state).booking = {}; // done: a next booking in this chat starts fresh
        // The booking has happened: a sign-in problem must not make it look as if it failed.
        if (signIn) await ctx.signIn(signIn).catch((err) => logger.warn(`Sign-in after a chat booking failed: ${err.message}`));
        // The patient's screen shows their code; it never goes into the AI's result below.
        if (body.personal_code) ctx.emit({ type: 'personal_code', code: body.personal_code });
        ctx.events.booked = true;
        ctx.emit({ type: 'booking_confirmed', appointment_id: body.appointment.id, ...pending.summary });
        return {
          booked: true,
          ...pending.summary,
          account: body.is_new_patient ? 'A new patient account was created and they are now signed in.' : undefined,
          email: pending.input.email ? 'A confirmation email is on its way.' : undefined,
        };
      }
      if (pending.type === 'cancel') {
        await appointmentService.cancel({ user: ctx.user, db: ctx.db }, pending.input.id, pending.input.reason);
        delete ctx.state.pending;
        ctx.events.changed = true;
        return { cancelled: true, ...pending.summary };
      }
      if (pending.type === 'reschedule') {
        await appointmentService.reschedule({ user: ctx.user, db: ctx.db }, pending.input.id, { starts_at: pending.input.starts_at, staff_id: pending.input.staff_id });
        delete ctx.state.pending;
        ctx.events.changed = true;
        return { rescheduled: true, ...pending.summary };
      }
      if (pending.type === 'forget') {
        const result = await memoryService.forgetPatient({ patientId: ctx.user.patientId, keepConversationId: ctx.conversation.id });
        delete ctx.state.pending;
        ctx.events.changed = true;
        return { forgotten: true, ...result };
      }
      return toolError('nothing_pending', 'Unknown pending action.');
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      delete ctx.state.pending;
      const alternatives = err.details?.alternatives?.map((s) => ({ date: dayInZone(new Date(s.starts_at), ctx.timeZone), time: timeInZone(s.starts_at) }));
      return toolError(err.code, err.message, alternatives ? { alternatives } : {});
    }
  },
});

/**
 * No free time suits the patient: they wait for a cancellation. Not a booking and nothing is
 * held — the email goes out when a time opens and whoever books first gets it.
 */
export const joinWaitlist = defineTool({
  name: 'join_waitlist',
  description:
    'Put the signed-in patient on the waitlist when none of the free times suit them and they agree. If a matching time opens (someone cancels), they get an email; it is not a booking and goes to whoever books first. Give the service, a doctor only if they want that doctor, and the days that work for them.',
  schema: z.object({
    service: z.string().min(2).max(80),
    doctor: z.string().max(80).optional().describe('Only if the patient wants this doctor; leave out for any doctor.'),
    from: Day.describe('First day that works for them (YYYY-MM-DD).'),
    to: Day.describe(`Last day that works for them (YYYY-MM-DD), at most ${waitlistService.WAITLIST_LIMITS.maxRangeDays} days after the first.`),
  }),
  signedIn: true,
  run: async ({ service, doctor, from, to }, ctx) => {
    if (!isValidDay(from) || !isValidDay(to)) return toolError('invalid_dates', 'Use dates as YYYY-MM-DD.');
    const today = dayInZone(new Date(), ctx.timeZone);
    const start = from < today ? today : from;
    if (to < start) return toolError('invalid_dates', 'The last day must be today or later, and not before the first day.');
    const { maxRangeDays } = waitlistService.WAITLIST_LIMITS;
    if (to > addDays(start, maxRangeDays)) return toolError('range_too_long', `Ask the patient for a range of at most ${maxRangeDays} days.`);

    const { match: svc } = await resolveService(ctx, service);
    if (!svc) return toolError('service_not_found', `No service matches "${service}".`);
    let staffId = null;
    if (doctor) {
      const { match: doc } = await resolveDoctor(ctx, doctor, svc.id);
      if (!doc) return toolError('doctor_not_found', `No doctor offering ${svc.name_en} matches "${doctor}".`);
      staffId = doc.id;
    }

    const patient = await patientModel.findById(requireAdmin(), ctx.user.patientId);
    const result = await waitlistService.join({ patient, serviceId: svc.id, staffId, dateFrom: start, dateTo: to, conversationId: ctx.conversation.id });
    if (result.error) {
      const next = result.error === 'no_email' ? 'Explain the waitlist works by email; offer to check other days or to hand over to staff.' : undefined;
      return toolError(result.error, result.message, { ...(result.entry && { waiting: waitlistService.describeWish(result.entry) }), ...(next && { next }) });
    }
    ctx.events.changed = true;
    return {
      added: true,
      waiting: waitlistService.describeWish(result.entry),
      next: 'Tell the patient they will get an email if a matching time opens. It goes to whoever books first, so they should book soon after the email.',
    };
  },
});
