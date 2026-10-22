import { supabase } from '../db/supabase.js';

/**
 * Booking service. TODO: implement against Supabase.
 * The slot's unique/status constraint enforces no double-booking at the DB level.
 */

export async function getOpenSlots({ date, service }) {
  // TODO: query availability_slots where status = 'open' and date matches.
  // Returning mock data for now so the agent loop is runnable end-to-end.
  return [
    { id: 'slot_demo_1', start_time: `${date} 10:00`, end_time: `${date} 10:30` },
    { id: 'slot_demo_2', start_time: `${date} 14:30`, end_time: `${date} 15:00` },
  ];
}

export async function createBooking({ patient_name, contact, service, slot_id, patient_id, source }) {
  // TODO: transaction — mark slot booked (fails if already taken) + insert appointment.
  if (!supabase) {
    return {
      ok: true,
      appointment: { id: 'appt_demo', slot_id, start_time: 'demo', patient_name, service },
    };
  }
  // Placeholder for real implementation.
  return {
    ok: true,
    appointment: { id: 'appt_demo', slot_id, start_time: 'demo', patient_name, service },
  };
}
