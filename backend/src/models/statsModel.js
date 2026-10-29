import { unwrap } from './query.js';

/** Dashboard numbers from the reporting views ("today" = the clinic's day). */

export function today(db) {
  return unwrap(db.from('v_stats_today').select('*').maybeSingle());
}

export function aiOutcomes(db) {
  return unwrap(db.from('v_ai_outcomes_7d').select('*'));
}

export function upcomingByDoctor(db) {
  return unwrap(db.from('v_stats_upcoming_by_doctor').select('*').order('full_name_en'));
}

// ----- the owner's numbers for any period (G9). Raw rows; reportService adds them up. -----

/** Bookings whose visit falls in [from, to), with what the treatment costs. */
export function appointmentsStarting(db, { from, to }) {
  return unwrap(
    db
      .from('appointments')
      .select(
        'starts_at, status, source, staff_id, service_id, service:service_id(name_en, name_ar, price_egp), doctor:staff_id(full_name_en, full_name_ar)',
      )
      .gte('starts_at', from)
      .lt('starts_at', to)
      .limit(20000),
  );
}

/** How the assistant's turns ended in [from, to). */
export function runOutcomes(db, { from, to }) {
  return unwrap(
    db.from('agent_runs').select('outcome').eq('assistant', 'patient').gte('created_at', from).lt('created_at', to).limit(50000),
  );
}

/** Rows of `table` created in [from, to) (patients, escalations). */
export async function countCreated(db, table, { from, to }) {
  const { count, error } = await db.from(table).select('id', { count: 'exact', head: true }).gte('created_at', from).lt('created_at', to);
  if (error) throw error;
  return count ?? 0;
}
