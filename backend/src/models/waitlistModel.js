import { unwrap } from './query.js';

/**
 * Patients waiting for a time that wasn't free. An entry is active while it is 'waiting' or
 * 'notified' (told about an opening at least once, still waiting); it ends as 'booked',
 * 'cancelled' or 'expired'.
 */

const ACTIVE = ['waiting', 'notified'];
const COLUMNS = `id, patient_id, service_id, staff_id, date_from, date_to, status, notified_at, created_at,
  service:service_id(name_en, name_ar), doctor:staff_id(full_name_en, full_name_ar)`;

export function create(db, { patientId, serviceId, staffId = null, dateFrom, dateTo, conversationId = null }) {
  return unwrap(
    db
      .from('waitlist')
      .insert({ patient_id: patientId, service_id: serviceId, staff_id: staffId, date_from: dateFrom, date_to: dateTo, conversation_id: conversationId })
      .select(COLUMNS)
      .single(),
  );
}

export function listActiveForPatient(db, patientId) {
  return unwrap(db.from('waitlist').select(COLUMNS).eq('patient_id', patientId).in('status', ACTIVE).order('date_from'));
}

/** Active entries that cover a day and accept this doctor (or any doctor), oldest first. */
export function listActiveForDay(db, { staffId, day }) {
  return unwrap(
    db
      .from('waitlist')
      .select(`${COLUMNS}, patient:patient_id(id, full_name, email, preferred_language)`)
      .in('status', ACTIVE)
      .lte('date_from', day)
      .gte('date_to', day)
      .or(`staff_id.is.null,staff_id.eq.${staffId}`)
      .order('created_at'),
  );
}

export function markNotified(db, ids, now = new Date()) {
  if (!ids.length) return [];
  return unwrap(db.from('waitlist').update({ status: 'notified', notified_at: now.toISOString() }).in('id', ids).select('id'));
}

/** The patient booked this service: they are no longer waiting for it. */
export function markBooked(db, { patientId, serviceId }) {
  return unwrap(
    db.from('waitlist').update({ status: 'booked' }).eq('patient_id', patientId).eq('service_id', serviceId).in('status', ACTIVE).select('id'),
  );
}

/** Entries whose last day has passed (`today` is a clinic day, 'YYYY-MM-DD'). */
export async function expirePast(db, today) {
  const rows = await unwrap(db.from('waitlist').update({ status: 'expired' }).in('status', ACTIVE).lt('date_to', today).select('id'));
  return rows.length;
}
