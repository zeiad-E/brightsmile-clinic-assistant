import { requireAdmin } from '../db/supabase.js';
import * as appointmentModel from '../models/appointmentModel.js';
import { AppError } from '../utils/AppError.js';
import { appointmentView, staffAppointmentView } from '../views/appointmentView.js';
import { listView } from '../views/listView.js';
import { bookingError } from './bookingService.js';
import { clinicBranding, clinicNameIn } from './catalogService.js';
import { sendEmailInBackground } from './email/emailService.js';

/**
 * Viewing, cancelling, moving and closing bookings.
 *
 * Cancel and reschedule run with the CALLER's database client, so the database itself
 * applies the rules: a patient only their own and not within 24 h; staff/owner anytime;
 * the viewer never. The service just translates the answers into HTTP.
 */

const CHANGE_ERRORS = {
  not_authenticated: [401, 'Please sign in first.'],
  read_only: [403, 'This account is read-only.'],
  not_found: [404, 'Booking not found.'],
  not_cancellable: [409, 'This booking is no longer active.'],
  too_late: [409, 'Bookings can only be changed online until shortly before the appointment. Please call the clinic.'],
};

function changeError(result) {
  const [status, message] = CHANGE_ERRORS[result.error] ?? [500, 'The booking could not be changed.'];
  const details = result.window_hours ? { window_hours: result.window_hours } : undefined;
  return new AppError(status, result.error, message, details);
}

async function emailCancellation(appointmentId) {
  const appointment = await appointmentModel.findForNotification(requireAdmin(), appointmentId);
  if (!appointment?.patient?.email) return;
  const brand = await clinicBranding();
  const language = appointment.patient.preferred_language;
  sendEmailInBackground({
    template: 'booking_cancelled',
    to: appointment.patient.email,
    language,
    patientId: appointment.patient.id,
    appointmentId,
    data: {
      clinicName: clinicNameIn(brand, language),
      timeZone: brand.timeZone,
      patientName: appointment.patient.full_name,
      startsAt: appointment.starts_at,
      serviceNameEn: appointment.service?.name_en,
      serviceNameAr: appointment.service?.name_ar,
    },
  });
}

// ----- patient: own bookings -----

export async function listMine({ user, db }, { scope, limit, offset }) {
  if (!user.patientId) return listView({ rows: [], total: 0 }, { limit, offset });
  const page = await appointmentModel.listForPatient(db, user.patientId, { scope, limit, offset });
  return listView(page, { limit, offset }, appointmentView);
}

export async function getMine({ db }, id) {
  const appointment = await appointmentModel.findById(db, id); // RLS: only the patient's own
  if (!appointment) throw AppError.notFound('not_found', 'Booking not found.');
  return appointmentView(appointment);
}

// ----- shared by patients and staff (the database applies the role rules) -----

export async function cancel({ db }, id, reason) {
  const result = await appointmentModel.cancel(db, { id, reason });
  if (!result.ok) throw changeError(result);
  emailCancellation(id).catch(() => {});
  return appointmentView(await appointmentModel.findById(db, id));
}

export async function reschedule({ db }, id, { starts_at: startsAt, staff_id: staffId }) {
  const result = await appointmentModel.reschedule(db, { id, startsAt, staffId: staffId ?? null });
  if (result.ok) return appointmentView(await appointmentModel.findById(db, id));

  if (['slot_taken', 'slot_unavailable', 'patient_has_overlap'].includes(result.error)) {
    const current = await appointmentModel.findById(db, id);
    throw await bookingError(result.error, {
      db: requireAdmin(),
      serviceId: current?.service_id,
      staffId: staffId ?? current?.staff_id,
      startsAt,
    });
  }
  throw changeError(result);
}

// ----- staff dashboard -----

export async function listForStaff({ db }, filters) {
  const page = await appointmentModel.listForStaff(db, filters);
  return listView(page, filters, staffAppointmentView);
}

export async function getForStaff({ db }, id) {
  const appointment = await appointmentModel.findForStaff(db, id);
  if (!appointment) throw AppError.notFound('not_found', 'Booking not found.');
  return staffAppointmentView(appointment);
}

/** completed / no_show — only for an active booking whose start time has passed. */
export async function setStatus({ db }, id, status) {
  const current = await appointmentModel.findForStaff(db, id);
  if (!current) throw AppError.notFound('not_found', 'Booking not found.');
  if (current.status !== 'booked') throw AppError.conflict('not_cancellable', 'Only an active booking can be closed.');
  if (new Date(current.starts_at) > new Date()) {
    throw AppError.conflict('not_started', 'A booking can be marked completed or no-show only after it starts.');
  }

  const updated = await appointmentModel.updateStatus(db, id, status);
  if (!updated) throw AppError.conflict('not_cancellable', 'This booking was changed by someone else. Please refresh.');
  return getForStaff({ db }, id);
}
