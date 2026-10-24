import { adminAs, requireAdmin } from '../db/supabase.js';
import * as appointmentModel from '../models/appointmentModel.js';
import * as patientModel from '../models/patientModel.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { appointmentView } from '../views/appointmentView.js';
import { sessionView } from '../views/sessionView.js';
import * as accountService from './accountService.js';
import * as personalCodeService from './personalCodeService.js';
import * as sessionService from './sessionService.js';
import { nextFreeSlots } from './availabilityService.js';
import { clinicBranding, clinicNameIn } from './catalogService.js';
import { sendEmailInBackground } from './email/emailService.js';

/**
 * Creating bookings — the place where two people can click the same time at once.
 *
 * How races are handled (the database does the hard part):
 *  1. The database function book_appointment checks the slot and inserts the booking in
 *     ONE transaction, and an exclusion constraint makes overlapping bookings impossible.
 *     Whoever is second gets `slot_taken` — never a double booking.
 *  2. On `slot_taken` we immediately offer the next free times (`alternatives`).
 *  3. Every attempt carries an Idempotency-Key: a retried request returns the first
 *     booking instead of creating a second one.
 *  4. New patients are created with ON CONFLICT inside the function, and the login is
 *     linked with a "only if not linked yet" update (see accountService).
 */

const BOOKING_ERRORS = {
  slot_taken: [409, 'That time was just booked by someone else. Here are the next free times.'],
  slot_unavailable: [422, 'That time cannot be booked. Please pick one of the free times.'],
  patient_has_overlap: [409, 'This patient already has an appointment at that time.'],
  identity_mismatch: [409, "These details don't match our records. Please sign in, or call the clinic."],
  contact_conflict: [409, 'This email and phone number belong to two different patients. Please call the clinic.'],
  name_required: [400, 'Please enter the full name.'],
  contact_required: [400, 'Please enter an email or a phone number.'],
  invalid_email: [400, 'Please enter a valid email address.'],
  invalid_phone: [400, 'Please enter the phone number in international format, e.g. +201001234567.'],
  invalid_date_of_birth: [400, 'Please enter a valid date of birth.'],
};

/** Turns a database error code into an HTTP error; slot_taken comes with fresh alternatives. */
export async function bookingError(code, { db, serviceId, staffId, startsAt }) {
  const [status, message] = BOOKING_ERRORS[code] ?? [500, 'The booking could not be completed.'];
  if (code !== 'slot_taken') return new AppError(status, code, message);

  const brand = await clinicBranding().catch(() => ({}));
  const alternatives = await nextFreeSlots(db, { serviceId, staffId, after: startsAt, timeZone: brand.timeZone }).catch(
    () => [],
  );
  return new AppError(status, code, message, { alternatives });
}

/** After a successful booking: login, personal code, confirmation email. Never fails the booking. */
async function afterBooking({ result, appointment, sendCode }) {
  const db = requireAdmin();
  const patient = await patientModel.findById(db, result.patient_id);
  let login = null;
  let personalCode = null;

  try {
    login = await accountService.ensurePatientLogin(patient);
    if (sendCode && patient.email) personalCode = await personalCodeService.issueCode(patient.id);
  } catch (err) {
    logger.warn(`Post-booking account setup failed for patient ${patient.id}: ${err.message}`);
  }

  const brand = await clinicBranding();
  const language = patient.preferred_language;
  sendEmailInBackground({
    template: 'booking_confirmed',
    to: patient.email,
    language,
    patientId: patient.id,
    appointmentId: appointment.id,
    data: {
      clinicName: clinicNameIn(brand, language),
      timeZone: brand.timeZone,
      patientName: patient.full_name,
      startsAt: appointment.starts_at,
      serviceNameEn: appointment.service?.name_en,
      serviceNameAr: appointment.service?.name_ar,
      doctorNameEn: appointment.doctor?.full_name_en,
      doctorNameAr: appointment.doctor?.full_name_ar,
      personalCode,
    },
  });

  return { patient, login };
}

async function runBooking({ db, input, source, actorId, idempotencyKey }) {
  const result = await appointmentModel.book(db, {
    serviceId: input.service_id,
    staffId: input.staff_id,
    startsAt: input.starts_at,
    fullName: input.full_name,
    dateOfBirth: input.date_of_birth,
    email: input.email,
    phone: input.phone,
    preferredLanguage: input.preferred_language,
    notes: input.notes,
    source,
    idempotencyKey,
    createdBy: actorId,
  });

  if (!result.ok) {
    throw await bookingError(result.error, {
      db: requireAdmin(),
      serviceId: input.service_id,
      staffId: input.staff_id,
      startsAt: input.starts_at,
    });
  }

  const appointment = await appointmentModel.findById(requireAdmin(), result.appointment_id);
  return { result, appointment };
}

/**
 * POST /api/appointments — a visitor or a signed-in patient books on the website.
 *
 * - Signed-in patient: their own record is used; typed contact details are ignored.
 * - Guest: name + date of birth + email or phone are required.
 * - A guest who becomes a NEW patient is signed in straight away (session in the answer).
 *   A guest matching an EXISTING patient gets the booking but no session — knowing
 *   someone's email and birthday must not be enough to enter their account.
 */
export async function bookAsVisitor({ user }, input, idempotencyKey) {
  if (user && user.role !== 'patient') {
    throw AppError.forbidden('use_staff_booking', 'Team members book through the staff dashboard.');
  }

  let details = input;
  if (user) {
    const patient = user.patientId && (await patientModel.findById(requireAdmin(), user.patientId));
    if (!patient) throw AppError.forbidden('no_patient_record', 'This login has no patient record.');
    details = {
      ...input,
      full_name: patient.full_name,
      date_of_birth: patient.date_of_birth,
      email: patient.email,
      phone: patient.phone,
      preferred_language: patient.preferred_language,
    };
  } else if (!input.full_name || !input.date_of_birth || !(input.email || input.phone)) {
    throw AppError.badRequest('details_required', 'Please enter your full name, date of birth, and an email or phone number.');
  }

  const { result, appointment } = await runBooking({
    db: adminAs(user?.id ?? null, 'dashboard'),
    input: details,
    source: 'website',
    actorId: user?.id ?? null,
    idempotencyKey,
  });

  // The same request sent again: answer with the original booking, do nothing else.
  if (result.replayed) return { status: 200, body: { appointment: appointmentView(appointment), replayed: true } };

  const { login } = await afterBooking({ result, appointment, sendCode: result.is_new_patient });

  let session = null;
  if (!user && result.is_new_patient && login) {
    try {
      session = sessionView(await sessionService.mintSession(login.email), {
        id: login.profileId,
        email: details.email ?? null,
        role: 'patient',
      });
    } catch (err) {
      logger.warn(`Auto sign-in after booking failed: ${err.message}`);
    }
  }

  return {
    status: 201,
    body: { appointment: appointmentView(appointment), is_new_patient: result.is_new_patient, session },
  };
}

/** POST /api/staff/appointments — staff book for a walk-in or phone caller. */
export async function bookAsStaff({ user }, input, idempotencyKey) {
  const { result, appointment } = await runBooking({
    db: adminAs(user.id, 'dashboard'),
    input,
    source: 'dashboard',
    actorId: user.id,
    idempotencyKey,
  });

  if (result.replayed) return { status: 200, body: { appointment: appointmentView(appointment), replayed: true } };

  await afterBooking({ result, appointment, sendCode: result.is_new_patient });
  return { status: 201, body: { appointment: appointmentView(appointment), is_new_patient: result.is_new_patient } };
}
