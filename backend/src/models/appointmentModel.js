import { pageRange, unwrap, unwrapPage } from './query.js';

/**
 * Bookings. Creating, cancelling and moving a booking go through database functions,
 * because each must happen as ONE transaction (check + change together) — that is what
 * makes them safe when two people act at the same moment.
 */

const DETAIL_COLUMNS = `id, patient_id, staff_id, service_id, starts_at, ends_at, status, source, notes,
  cancelled_at, cancel_reason, created_at,
  doctor:staff_id(id, full_name_en, full_name_ar, title),
  service:service_id(id, slug, name_en, name_ar, duration_minutes, price_egp)`;

const STAFF_VIEW_COLUMNS = `id, starts_at, ends_at, status, source, staff_id, doctor_name_en, doctor_name_ar,
  service_id, service_name_en, service_name_ar, patient_id, patient_name, notes, cancelled_at, created_at`;

/** book_appointment → { ok, error?, appointment_id, patient_id, is_new_patient, replayed, … } */
export function book(db, input) {
  return unwrap(
    db.rpc('book_appointment', {
      p_service_id: input.serviceId,
      p_staff_id: input.staffId,
      p_starts_at: input.startsAt,
      p_full_name: input.fullName,
      p_date_of_birth: input.dateOfBirth,
      p_email: input.email ?? null,
      p_phone: input.phone ?? null,
      p_preferred_language: input.preferredLanguage ?? 'en',
      p_source: input.source,
      p_idempotency_key: input.idempotencyKey,
      p_created_by: input.createdBy ?? null,
      p_notes: input.notes ?? null,
    }),
  );
}

/** cancel_appointment → { ok, error?, window_hours? }. The database applies the role rules. */
export function cancel(db, { id, reason = null }) {
  return unwrap(db.rpc('cancel_appointment', { p_appointment_id: id, p_reason: reason }));
}

/** reschedule_appointment → { ok, error?, starts_at, ends_at, staff_id }. */
export function reschedule(db, { id, startsAt, staffId = null }) {
  return unwrap(
    db.rpc('reschedule_appointment', { p_appointment_id: id, p_new_starts_at: startsAt, p_new_staff_id: staffId }),
  );
}

/** One booking with doctor and service. Row Level Security decides who can see it. */
export function findById(db, id) {
  return unwrap(db.from('appointments').select(DETAIL_COLUMNS).eq('id', id).maybeSingle());
}

/** For emails: the booking plus the patient's contact details (service role only). */
export function findForNotification(db, id) {
  return unwrap(
    db
      .from('appointments')
      .select(`${DETAIL_COLUMNS}, patient:patient_id(id, full_name, email, preferred_language)`)
      .eq('id', id)
      .maybeSingle(),
  );
}

export function listForPatient(db, patientId, { scope = 'upcoming', limit, offset, now = new Date() }) {
  const nowIso = now.toISOString();
  let query = db.from('appointments').select(DETAIL_COLUMNS, { count: 'exact' }).eq('patient_id', patientId);
  query =
    scope === 'past'
      ? query.lt('starts_at', nowIso).order('starts_at', { ascending: false })
      : query.gte('starts_at', nowIso).order('starts_at', { ascending: true });
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}

/** Staff dashboard list (masked for the viewer by the v_appointments view). */
export function listForStaff(db, { from, to, staffId, status, patientId, limit, offset }) {
  let query = db.from('v_appointments').select(STAFF_VIEW_COLUMNS, { count: 'exact' }).order('starts_at');
  if (from) query = query.gte('starts_at', from);
  if (to) query = query.lt('starts_at', to);
  if (staffId) query = query.eq('staff_id', staffId);
  if (status) query = query.eq('status', status);
  if (patientId) query = query.eq('patient_id', patientId);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}

export function findForStaff(db, id) {
  return unwrap(db.from('v_appointments').select(STAFF_VIEW_COLUMNS).eq('id', id).maybeSingle());
}

/** Count bookings that clash with a period (used to warn when adding time off). */
export async function countBookedBetween(db, { from, to, staffId }) {
  let query = db
    .from('v_appointments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'booked')
    .lt('starts_at', to)
    .gt('ends_at', from);
  if (staffId) query = query.eq('staff_id', staffId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Marks a past booking as completed / no_show — only if it is still 'booked'. */
export function updateStatus(db, id, status) {
  return unwrap(
    db
      .from('appointments')
      .update({ status })
      .eq('id', id)
      .eq('status', 'booked')
      .select('id, status')
      .maybeSingle(),
  );
}
