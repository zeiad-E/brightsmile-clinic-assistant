import { createBooking } from '../../services/booking.js';
import { triggerBookingAutomation } from '../../services/automation.js';

/**
 * Book an appointment. The DB enforces no-double-booking at the slot level.
 * On success, fires the (optional) booking automation without blocking the reply.
 */
export async function bookAppointment({ patient_name, contact, service, slot_id }, context = {}) {
  const booking = await createBooking({
    patient_name,
    contact,
    service,
    slot_id,
    patient_id: context.patientId ?? null,
    source: 'ai',
  });

  if (!booking.ok) {
    return { booked: false, reason: booking.reason }; // e.g. 'slot_taken'
  }

  // Fire-and-forget automation (optional feature).
  triggerBookingAutomation(booking.appointment).catch(() => {});

  return {
    booked: true,
    appointment: {
      id: booking.appointment.id,
      service,
      start: booking.appointment.start_time,
    },
  };
}
