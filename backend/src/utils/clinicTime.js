/**
 * Calendar-day helpers in the clinic's timezone (Africa/Cairo by default).
 *
 * Why: "today" and "which weekday" depend on where the clinic is, not on the
 * server's clock (Render runs in UTC). Days are plain 'YYYY-MM-DD' strings so they
 * can go straight into the `get_available_slots(p_date)` database function.
 */
export const CLINIC_TIMEZONE = 'Africa/Cairo';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day of `instant` in `timeZone`, e.g. '2026-10-24'. */
export function dayInZone(instant = new Date(), timeZone = CLINIC_TIMEZONE) {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  );
}

/** True for a real calendar day in 'YYYY-MM-DD' form (rejects '2026-02-30'). */
export function isValidDay(day) {
  if (typeof day !== 'string' || !DAY_PATTERN.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** Adds whole days to a 'YYYY-MM-DD' day (works across months and years). */
export function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** How many minutes `timeZone` is ahead of UTC at a given moment (Cairo: +120 or +180 with DST). */
function zoneOffsetMinutes(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asIfUtc - instant.getTime()) / 60000);
}

/** The exact moment a clinic day starts (midnight in Cairo), e.g. for "appointments on this date". */
export function startOfDayInZone(day, timeZone = CLINIC_TIMEZONE) {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  const guess = new Date(utcMidnight.getTime() - zoneOffsetMinutes(utcMidnight, timeZone) * 60000);
  // Second pass: the offset at the real moment can differ when daylight saving starts that night.
  return new Date(utcMidnight.getTime() - zoneOffsetMinutes(guess, timeZone) * 60000);
}

/** A human date + time in the patient's language, e.g. "Sunday, 25 October 2026 at 10:30". */
export function formatDateTime(instant, language = 'en', timeZone = CLINIC_TIMEZONE) {
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(instant));
}

/** "10:30" for an instant, in the clinic's timezone. */
export function timeInZone(instant, timeZone = CLINIC_TIMEZONE) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(instant),
  );
}

/** "Sunday" for a 'YYYY-MM-DD' day. */
export function weekdayName(day) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/** A clinic day + "HH:MM" clock time → the exact moment (ISO, UTC). */
export function zonedDateTime(day, time, timeZone = CLINIC_TIMEZONE) {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(startOfDayInZone(day, timeZone).getTime() + (hours * 60 + minutes) * 60_000).toISOString();
}

/** 0 = Sunday … 6 = Saturday, the same numbering as the `working_hours.weekday` column. */
export function weekdayOf(day) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}
