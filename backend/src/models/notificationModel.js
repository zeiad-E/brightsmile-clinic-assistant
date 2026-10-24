import { pageRange, unwrap, unwrapPage } from './query.js';

/** A log row for every email the system sends: queued → sent | failed. */

export function createQueued(db, { patientId = null, appointmentId = null, template, toAddress }) {
  return unwrap(
    db
      .from('notifications')
      .insert({ patient_id: patientId, appointment_id: appointmentId, template, to_address: toAddress })
      .select('id')
      .single(),
  );
}

export function markSent(db, id) {
  return unwrap(db.from('notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id));
}

export function markFailed(db, id, error) {
  return unwrap(db.from('notifications').update({ status: 'failed', error: String(error).slice(0, 500) }).eq('id', id));
}

/** Owner/viewer list (address masked for the viewer by the view). */
export function list(db, { status, template, limit, offset }) {
  let query = db
    .from('v_notifications')
    .select('id, patient_id, appointment_id, channel, template, to_address, status, error, sent_at, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (template) query = query.eq('template', template);
  return unwrapPage(query.range(...pageRange({ limit, offset })));
}
