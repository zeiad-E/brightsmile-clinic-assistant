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
import * as memoryService from '../../services/memoryService.js';
import { AppError } from '../../utils/AppError.js';
import { addDays, dayInZone, isValidDay, timeInZone, weekdayName, zonedDateTime } from '../../utils/clinicTime.js';
import { bestMatch } from '../../utils/text.js';
import { DateOfBirth, Email, Phone } from '../../validators/common.js';
import { defineTool, toolError } from './define.js';

/**
 * Free times, booking, cancelling, rescheduling.
 *
 * Every change is two steps — the confirmation gate:
 *   1. propose_* checks everything and stores the action as "pending" (nothing changes yet);
 *   2. confirm_pending_action runs it, but ONLY if the patient sent a new message after the
 *      proposal. The AI can't book in the same breath as proposing; the patient always gets
 *      a chance to say yes or no.
 */

const Day = z.string().describe('Date as YYYY-MM-DD (clinic time, Cairo).');
const Time = z.string().describe('Start time as HH:MM, 24-hour, clinic time.');

async function resolveService(ctx, text) {
  const services = await catalogService.listServices(ctx.db);
  return { match: bestMatch(services, text, ['slug', 'name_en', 'name_ar']), services };
}

async function resolveDoctor(ctx, text, serviceId) {
  const doctors = (await catalogService.listDoctors(ctx.db)).filter((d) => !serviceId || d.service_ids.includes(serviceId));
  return { match: text ? bestMatch(doctors, text, ['full_name_en', 'full_name_ar']) : null, doctors };
}

const describeSlots = (slots, max = 10) => slots.slice(0, max).map((s) => timeInZone(s.starts_at));

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
    if (doctor) {
      const { match: doc, doctors } = await resolveDoctor(ctx, doctor, match.id);
      if (!doc) return toolError('doctor_not_found', `No doctor offering ${match.name_en} matches "${doctor}".`, { doctors: doctors.map((d) => d.full_name_en) });
      staffId = doc.id;
    }

    const result = await availabilityService.forRange(ctx.db, { serviceId: match.id, staffId, from: start, days });
    const doctorNames = new Map((await catalogService.listDoctors(ctx.db)).map((d) => [d.id, d]));
    const doctorsOut = result.doctors.map((d) => ({
      doctor: doctorNames.get(d.staff_id)?.full_name_en ?? d.full_name_en,
      doctor_ar: doctorNames.get(d.staff_id)?.full_name_ar ?? d.full_name_ar,
      days: d.days
        .filter((day) => day.slots.length)
        .map((day) => ({ date: day.date, weekday: weekdayName(day.date), times: describeSlots(day.slots), more: Math.max(0, day.slots.length - 10) })),
    }));

    ctx.emit({ type: 'slots', service: match.name_en, doctors: doctorsOut });
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

async function nextAlternatives(ctx, { serviceId, staffId, after }) {
  const slots = await availabilityService.nextFreeSlots(ctx.db, { serviceId, staffId, after, timeZone: ctx.timeZone });
  return slots.map((s) => ({ date: dayInZone(new Date(s.starts_at), ctx.timeZone), time: timeInZone(s.starts_at) }));
}

async function isFree(ctx, { serviceId, staffId, day, startsAt }) {
  const slots = await availabilityModel.slotsFor(ctx.db, { serviceId, staffId, day });
  return slots.some((s) => new Date(s.slot_start).getTime() === new Date(startsAt).getTime());
}

export const proposeBooking = defineTool({
  name: 'propose_booking',
  description:
    'Prepare a booking (does NOT book yet). Checks the time is free and the details are valid, then returns a summary. Read the summary back and ask the patient to confirm; only after they agree, call confirm_pending_action. For a signed-in patient, omit the personal details.',
  schema: z.object({
    service: z.string().min(2).max(80),
    doctor: z.string().min(2).max(80).describe('The doctor chosen from check_availability.'),
    date: Day,
    time: Time,
    full_name: z.string().max(120).optional().describe('Guests only: full name.'),
    date_of_birth: z.string().max(40).optional().describe('Guests only: date of birth (as given, e.g. [DOB_1]).'),
    email: z.string().max(254).optional().describe('Guests: email (e.g. [EMAIL_1]). Email or phone is required.'),
    phone: z.string().max(40).optional().describe('Guests: phone (e.g. [PHONE_1]).'),
    notes: z.string().max(300).optional().describe('Anything the patient wants the clinic to know (not medical history).'),
  }),
  run: async (args, ctx) => {
    if (!isValidDay(args.date) || !/^\d{2}:\d{2}$/.test(args.time)) return toolError('invalid_time', 'Use date YYYY-MM-DD and time HH:MM.');

    const { match: service } = await resolveService(ctx, args.service);
    if (!service) return toolError('service_not_found', `No service matches "${args.service}".`);
    const { match: doctor } = await resolveDoctor(ctx, args.doctor, service.id);
    if (!doctor) return toolError('doctor_not_found', `No doctor offering ${service.name_en} matches "${args.doctor}".`);

    const startsAt = zonedDateTime(args.date, args.time, ctx.timeZone);
    if (!(await isFree(ctx, { serviceId: service.id, staffId: doctor.id, day: args.date, startsAt }))) {
      return toolError('time_not_available', 'That time is not free.', {
        alternatives: await nextAlternatives(ctx, { serviceId: service.id, staffId: doctor.id, after: startsAt }),
      });
    }

    let person;
    if (ctx.isPatient) {
      const patient = await patientModel.findById(requireAdmin(), ctx.user.patientId);
      person = { full_name: patient.full_name, email: patient.email, phone: patient.phone, preferred_language: patient.preferred_language };
    } else {
      const dob = DateOfBirth.safeParse(normalizeDob(args.date_of_birth));
      const email = args.email ? Email.safeParse(args.email) : null;
      const phone = args.phone ? Phone.safeParse(args.phone) : null;
      if (!args.full_name || args.full_name.trim().split(/\s+/).length < 2) return toolError('missing_full_name', 'Ask for the full name (first and last).');
      if (!dob.success) return toolError('missing_date_of_birth', 'Ask for the date of birth (day, month, year).');
      if (!email && !phone) return toolError('missing_contact', 'Ask for an email address or a phone number.');
      if (email && !email.success) return toolError('invalid_email', 'That email address looks wrong; ask again.');
      if (phone && !phone.success) return toolError('invalid_phone', 'Ask for the phone number with country code, e.g. +20 100 123 4567.');
      person = {
        full_name: args.full_name.trim(),
        date_of_birth: dob.data,
        email: email?.data,
        phone: phone?.data,
        preferred_language: ctx.language,
      };
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
    ctx.emit({ type: 'booking_summary', ...summary });
    return { pending: true, summary, next: 'Read this back and ask the patient to confirm. Do not call confirm_pending_action until they reply yes.' };
  },
});

/** "1992-04-15", "15/04/1992", "15 April 1992" → "1992-04-15". */
function normalizeDob(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(text);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  const parsed = new Date(`${text} 12:00 UTC`);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

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
  const appointment = await appointmentModel.findById(ctx.db, id); // Row Level Security: only the patient's own
  if (!appointment) return { error: toolError('unknown_appointment', 'That booking was not found.') };
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
        const { body } = await bookingService.bookAsVisitor({ user: ctx.isPatient ? ctx.user : null }, pending.input, idempotencyKeyFor(ctx.conversation.id, pending.input));
        delete ctx.state.pending;
        if (body.session) await ctx.signedIn(body.session);
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
        await appointmentService.cancel({ db: ctx.db }, pending.input.id, pending.input.reason);
        delete ctx.state.pending;
        ctx.events.changed = true;
        return { cancelled: true, ...pending.summary };
      }
      if (pending.type === 'reschedule') {
        await appointmentService.reschedule({ db: ctx.db }, pending.input.id, { starts_at: pending.input.starts_at, staff_id: pending.input.staff_id });
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
