import { unwrap } from './query.js';

/**
 * Free start times, computed by the database function get_available_slots from working
 * hours, time off, existing bookings, lead time and the booking horizon.
 * `day` is a 'YYYY-MM-DD' calendar day in the clinic's timezone.
 */
export async function slotsFor(db, { serviceId, staffId, day, ignoreBookings = false }) {
  const rows = await unwrap(
    db.rpc('get_available_slots', {
      p_service_id: serviceId,
      p_staff_id: staffId,
      p_date: day,
      p_ignore_bookings: ignoreBookings,
    }),
  );
  return rows ?? [];
}
