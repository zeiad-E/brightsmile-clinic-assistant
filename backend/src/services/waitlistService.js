import { config } from '../config/index.js';
import { requireAdmin } from '../db/supabase.js';
import * as availabilityModel from '../models/availabilityModel.js';
import * as jobModel from '../models/jobModel.js';
import * as staffModel from '../models/staffModel.js';
import * as waitlistModel from '../models/waitlistModel.js';
import { dayInZone } from '../utils/clinicTime.js';
import { logger } from '../utils/logger.js';
import { clinicBranding, clinicNameIn } from './catalogService.js';
import { isPlaceholderEmail, sendEmail } from './email/emailService.js';

/**
 * The waitlist: a patient for whom no time suits leaves a wish (service, one doctor or any
 * doctor, a date range). When a booking is cancelled or moved, its old time opens and a job
 * emails a few matching patients. Nothing is held for them: whoever books first gets it, and
 * book_appointment already makes that race-safe.
 */

export const WAITLIST_LIMITS = Object.freeze({
  activePerPatient: 3, // open wishes per patient
  maxRangeDays: 30, // longest date range for one wish
  notifyPerOpening: 5, // emails per freed time: enough to fill it, not a mass mailing
  renotifyHours: 12, // at most one email per wish every 12 h
});

// ---------- joining (the assistant's join_waitlist tool) ----------

/**
 * Adds a wish for a signed-in patient. Returns { added, entry } or { error, message }:
 * the assistant reads the error and explains it kindly.
 */
export async function join({ patient, serviceId, staffId = null, dateFrom, dateTo, conversationId = null }) {
  if (!patient.email || isPlaceholderEmail(patient.email)) {
    return { error: 'no_email', message: 'The waitlist tells patients by email, and this patient has no email on file.' };
  }
  const db = requireAdmin();
  const active = await waitlistModel.listActiveForPatient(db, patient.id);
  const same = active.find((w) => w.service_id === serviceId && (w.staff_id ?? null) === staffId);
  if (same) return { error: 'already_waiting', message: 'The patient is already on the waitlist for this.', entry: same };
  if (active.length >= WAITLIST_LIMITS.activePerPatient) {
    return { error: 'too_many', message: `A patient can wait for at most ${WAITLIST_LIMITS.activePerPatient} things at once.` };
  }
  const entry = await waitlistModel.create(db, { patientId: patient.id, serviceId, staffId, dateFrom, dateTo, conversationId });
  return { added: true, entry };
}

/** "Teeth cleaning with any doctor, 2026-11-01 to 2026-11-10" — for the assistant's context and replies. */
export const describeWish = (w) =>
  `${w.service?.name_en ?? 'a service'} with ${w.doctor?.full_name_en ?? 'any doctor'}, ${w.date_from} to ${w.date_to}`;

export function listForPatient(patientId) {
  return waitlistModel.listActiveForPatient(requireAdmin(), patientId);
}

// ---------- a time opened (cancellation or reschedule) ----------

/** After a cancel/reschedule: queue the "tell the waitlist" job. Never fails the caller. */
export async function announceOpening({ serviceId, staffId, startsAt }) {
  if (!serviceId || !staffId || !startsAt || new Date(startsAt) <= new Date()) return;
  try {
    await jobModel.enqueue(requireAdmin(), {
      type: 'waitlist_slot_opened',
      payload: { service_id: serviceId, staff_id: staffId, starts_at: new Date(startsAt).toISOString() },
    });
  } catch (err) {
    logger.warn(`Could not queue the waitlist job: ${err.message}`);
  }
}

/**
 * Job "waitlist_slot_opened": emails the patients waiting for the freed time.
 *
 * The freed time may suit another service too (an hour of whitening fits a cleaning), so each
 * waiting service is checked against the doctor's real free times for that day. A time that
 * was re-booked in the meantime is no longer free, and nobody is emailed.
 */
export async function notifyOpening({ service_id: freedServiceId, staff_id: staffId, starts_at: startsAt }) {
  const db = requireAdmin();
  const brand = await clinicBranding();
  const day = dayInZone(new Date(startsAt), brand.timeZone);
  const cutoff = Date.now() - WAITLIST_LIMITS.renotifyHours * 3_600_000;

  const waiting = (await waitlistModel.listActiveForDay(db, { staffId, day })).filter(
    (w) => w.patient?.email && (!w.notified_at || new Date(w.notified_at).getTime() < cutoff),
  );
  if (!waiting.length) return { notified: 0 };

  const freeFor = new Set();
  for (const serviceId of new Set(waiting.map((w) => w.service_id))) {
    const slots = await availabilityModel.slotsFor(db, { serviceId, staffId, day });
    if (slots.some((s) => new Date(s.slot_start).getTime() === new Date(startsAt).getTime())) freeFor.add(serviceId);
  }

  // Patients waiting for the cancelled service come first, then the oldest wishes.
  const chosen = waiting
    .filter((w) => freeFor.has(w.service_id))
    .sort((a, b) => (b.service_id === freedServiceId) - (a.service_id === freedServiceId))
    .slice(0, WAITLIST_LIMITS.notifyPerOpening);
  if (!chosen.length) return { notified: 0 };

  const doctor = (await staffModel.findById(db, staffId)) ?? {};
  const sentIds = [];
  for (const entry of chosen) {
    const language = entry.patient.preferred_language;
    const { sent } = await sendEmail({
      template: 'waitlist_slot_open',
      to: entry.patient.email,
      language,
      patientId: entry.patient.id,
      data: {
        clinicName: clinicNameIn(brand, language),
        timeZone: brand.timeZone,
        appUrl: config.appUrl,
        patientName: entry.patient.full_name,
        startsAt,
        serviceNameEn: entry.service?.name_en,
        serviceNameAr: entry.service?.name_ar,
        doctorNameEn: doctor.full_name_en,
        doctorNameAr: doctor.full_name_ar,
        waitUntil: entry.date_to,
      },
    });
    if (sent) sentIds.push(entry.id);
  }
  await waitlistModel.markNotified(db, sentIds);
  return { notified: sentIds.length };
}

/** After a booking: the patient no longer waits for that service. Never fails the booking. */
export async function closeOnBooking({ patientId, serviceId }) {
  try {
    await waitlistModel.markBooked(requireAdmin(), { patientId, serviceId });
  } catch (err) {
    logger.warn(`Could not close waitlist entries for patient ${patientId}: ${err.message}`);
  }
}
