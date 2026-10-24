import * as appointmentModel from '../models/appointmentModel.js';
import * as staffModel from '../models/staffModel.js';
import * as timeOffModel from '../models/timeOffModel.js';
import * as workingHoursModel from '../models/workingHoursModel.js';
import { AppError } from '../utils/AppError.js';
import { listView } from '../views/listView.js';
import { adminDoctorView } from '../views/doctorView.js';

/**
 * Time off, weekly hours and who-offers-what. All run as the signed-in user, so the
 * database enforces "staff manage time off, only the owner changes hours/services"
 * and the audit log records who did it.
 */

export async function listTimeOff({ db }, filters) {
  return listView(await timeOffModel.list(db, filters), filters);
}

/**
 * Adding time off does NOT cancel existing bookings in that period (a person should decide
 * what to tell those patients), so we report how many clash.
 */
export async function createTimeOff({ user, db }, input) {
  const row = await timeOffModel.create(db, { ...input, created_by: user.id });
  const clashing = await appointmentModel.countBookedBetween(db, {
    from: row.starts_at,
    to: row.ends_at,
    staffId: row.staff_id,
  });
  return { time_off: row, clashing_bookings: clashing };
}

export async function updateTimeOff({ db }, id, patch) {
  const existing = await timeOffModel.findById(db, id);
  if (!existing) throw AppError.notFound('time_off_not_found', 'Time off not found.');
  const startsAt = patch.starts_at ?? existing.starts_at;
  const endsAt = patch.ends_at ?? existing.ends_at;
  if (new Date(endsAt) <= new Date(startsAt)) throw AppError.badRequest('invalid_range', 'The end must be after the start.');
  return timeOffModel.update(db, id, patch);
}

export async function removeTimeOff({ db }, id) {
  if (!(await timeOffModel.remove(db, id))) throw AppError.notFound('time_off_not_found', 'Time off not found.');
}

const SCHEDULE_ERRORS = {
  not_found: [404, 'Doctor not found.'],
  overlapping_shifts: [422, 'Two shifts on the same day overlap.'],
  invalid_hours: [422, 'Each shift needs a weekday (0–6) and an end time after its start time.'],
  unknown_service: [422, 'One of the services does not exist.'],
};

function scheduleResult(result) {
  if (result.ok) return;
  const [status, message] = SCHEDULE_ERRORS[result.error] ?? [500, 'The schedule could not be saved.'];
  throw new AppError(status, result.error, message);
}

export async function replaceWorkingHours({ db }, staffId, hours) {
  scheduleResult(await workingHoursModel.replaceForStaff(db, staffId, hours));
  return adminDoctorView(await staffModel.findById(db, staffId));
}

export async function replaceStaffServices({ db }, staffId, serviceIds) {
  scheduleResult(await staffModel.setServices(db, staffId, serviceIds));
  return adminDoctorView(await staffModel.findById(db, staffId));
}
