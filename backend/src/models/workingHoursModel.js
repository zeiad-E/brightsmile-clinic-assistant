import { unwrap } from './query.js';

/** Weekly schedule rows: weekday (0 = Sunday) + start/end time, per doctor. */

/** All shifts of active doctors — used to show the clinic's opening hours. */
export async function listForActiveStaff(db) {
  const rows = await unwrap(
    db.from('working_hours').select('weekday, start_time, end_time, staff:staff_id(is_active)').order('weekday'),
  );
  return rows.filter((row) => row.staff?.is_active);
}

/** Replaces one doctor's whole week in one database transaction (owner only, checked by the DB). */
export function replaceForStaff(db, staffId, hours) {
  return unwrap(db.rpc('set_working_hours', { p_staff_id: staffId, p_hours: hours }));
}
