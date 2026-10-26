import { config } from '../config/index.js';
import { requireAdmin } from '../db/supabase.js';
import * as appointmentModel from '../models/appointmentModel.js';
import * as maintenanceModel from '../models/maintenanceModel.js';
import { logger } from '../utils/logger.js';
import { clinicBranding, clinicNameIn } from './catalogService.js';
import { PLACEHOLDER_EMAIL_DOMAIN, sendEmail } from './email/emailService.js';

/**
 * Appointment reminders, in two steps:
 *  1. every 15 minutes, queue_due_reminders marks the bookings that are due and queues one
 *     send_reminder job each (one transaction, so a booking never gets two reminders);
 *  2. each send_reminder job emails one patient, with the usual retries if the email fails.
 *
 * A reminder goes out about a day before the online change deadline (24 h before the visit
 * by default), so the patient can still move or cancel it in the chat.
 */

export const REMINDER_SWEEP_MINUTES = 15;

/** Job "queue_reminders": finds the bookings due a reminder. */
export async function queueDueReminders() {
  const queued = await maintenanceModel.queueDueReminders(requireAdmin(), { skipEmailDomain: PLACEHOLDER_EMAIL_DOMAIN });
  if (queued) logger.info(`Queued ${queued} appointment reminder(s)`);
  return queued;
}

/** Job "send_reminder": emails one patient about one booking. */
export async function sendReminder({ appointment_id: appointmentId, starts_at: queuedFor }) {
  const appointment = await appointmentModel.findForNotification(requireAdmin(), appointmentId);
  // Cancelled or moved since it was queued: a moved booking gets its own reminder later.
  if (!appointment || appointment.status !== 'booked') return;
  if (queuedFor && new Date(queuedFor).getTime() !== new Date(appointment.starts_at).getTime()) return;
  if (!appointment.patient?.email) return;

  const brand = await clinicBranding();
  const language = appointment.patient.preferred_language;
  const changeUntil = new Date(new Date(appointment.starts_at).getTime() - (brand.cancellationWindowHours ?? 24) * 3_600_000);

  const result = await sendEmail({
    template: 'appointment_reminder',
    to: appointment.patient.email,
    language,
    patientId: appointment.patient.id,
    appointmentId,
    data: {
      clinicName: clinicNameIn(brand, language),
      clinicPhone: brand.phone,
      timeZone: brand.timeZone,
      appUrl: config.appUrl,
      patientName: appointment.patient.full_name,
      startsAt: appointment.starts_at,
      serviceNameEn: appointment.service?.name_en,
      serviceNameAr: appointment.service?.name_ar,
      doctorNameEn: appointment.doctor?.full_name_en,
      doctorNameAr: appointment.doctor?.full_name_ar,
      changeUntil: changeUntil > new Date() ? changeUntil.toISOString() : null,
    },
  });
  // Throwing hands the job back to the runner, which retries it later (1, 4, 9… minutes).
  if (!result.sent && !result.skipped) throw new Error('Reminder email was not sent');
}
