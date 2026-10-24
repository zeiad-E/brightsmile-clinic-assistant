import { shortTime } from './doctorView.js';

/**
 * Public clinic info. Opening hours per weekday = earliest start to latest end among the
 * active doctors working that day (the clinic is "open" whenever someone is working).
 */
export function clinicView(settings, shifts = []) {
  const byDay = new Map();
  for (const shift of shifts) {
    const day = byDay.get(shift.weekday) ?? { weekday: shift.weekday, opens: shift.start_time, closes: shift.end_time };
    if (shift.start_time < day.opens) day.opens = shift.start_time;
    if (shift.end_time > day.closes) day.closes = shift.end_time;
    byDay.set(shift.weekday, day);
  }

  return {
    name_en: settings.name_en,
    name_ar: settings.name_ar,
    phone: settings.phone,
    email: settings.email,
    address_en: settings.address_en,
    address_ar: settings.address_ar,
    currency: settings.currency,
    timezone: settings.timezone,
    booking_rules: {
      slot_step_minutes: settings.slot_step_minutes,
      min_lead_minutes: settings.min_lead_minutes,
      booking_horizon_days: settings.booking_horizon_days,
      cancellation_window_hours: settings.cancellation_window_hours,
    },
    opening_hours: [...byDay.values()]
      .sort((a, b) => a.weekday - b.weekday)
      .map((day) => ({ weekday: day.weekday, opens: shortTime(day.opens), closes: shortTime(day.closes) })),
  };
}

/** The full settings row for the owner's settings screen. */
export function settingsView(settings) {
  const { id: _id, created_at: _createdAt, ...rest } = settings;
  return rest;
}
