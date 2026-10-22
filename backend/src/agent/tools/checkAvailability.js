import { getOpenSlots } from '../../services/booking.js';

/** Return open appointment slots for a date/range and optional service. */
export async function checkAvailability({ date, service }) {
  const slots = await getOpenSlots({ date, service });
  return {
    date,
    service: service ?? null,
    slots: slots.map((s) => ({ slot_id: s.id, start: s.start_time, end: s.end_time })),
  };
}
