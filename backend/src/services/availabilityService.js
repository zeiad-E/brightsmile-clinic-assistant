import * as availabilityModel from '../models/availabilityModel.js';
import * as staffModel from '../models/staffModel.js';
import { addDays, dayInZone } from '../utils/clinicTime.js';
import { slotView } from '../views/appointmentView.js';

/**
 * Free times to book. The database computes them (hours − time off − bookings − lead time),
 * this service only asks for the right days and doctors.
 */

export async function forDay(db, { serviceId, staffId, day }) {
  const rows = await availabilityModel.slotsFor(db, { serviceId, staffId, day });
  return { date: day, staff_id: staffId, slots: rows.map(slotView) };
}

/**
 * Several days at once. With a doctor: that doctor's free times per day.
 * Without: one entry per active doctor who offers the service ("any doctor").
 */
export async function forRange(db, { serviceId, staffId, from, days }) {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const doctors = staffId
    ? [{ id: staffId }]
    : await staffModel.listActiveForService(db, serviceId);

  const results = await Promise.all(
    doctors.map(async (doctor) => {
      const perDay = await Promise.all(
        dates.map(async (day) => ({
          date: day,
          slots: (await availabilityModel.slotsFor(db, { serviceId, staffId: doctor.id, day })).map(slotView),
        })),
      );
      return {
        staff_id: doctor.id,
        full_name_en: doctor.full_name_en,
        full_name_ar: doctor.full_name_ar,
        days: perDay,
      };
    }),
  );
  return { from, days, doctors: results };
}

/**
 * The next free times for the same doctor and service, starting at a given moment —
 * offered straight away when the chosen time was just taken (the race-condition re-offer).
 * Looks at most 3 days ahead.
 */
export async function nextFreeSlots(db, { serviceId, staffId, after, count = 5, timeZone }) {
  const firstDay = dayInZone(new Date(after), timeZone);
  const found = [];
  for (let i = 0; i < 3 && found.length < count; i += 1) {
    const rows = await availabilityModel.slotsFor(db, { serviceId, staffId, day: addDays(firstDay, i) });
    for (const row of rows) {
      if (new Date(row.slot_start) > new Date(after) && found.length < count) found.push(slotView(row));
    }
  }
  return found;
}
