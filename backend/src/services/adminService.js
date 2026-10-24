import * as clinicModel from '../models/clinicModel.js';
import * as serviceModel from '../models/serviceModel.js';
import * as staffModel from '../models/staffModel.js';
import { AppError } from '../utils/AppError.js';
import { adminServiceView } from '../views/serviceView.js';
import { adminDoctorView } from '../views/doctorView.js';
import { settingsView } from '../views/clinicView.js';

/**
 * Owner settings: treatments and prices, doctors, clinic rules.
 *
 * "Delete" means deactivate: past bookings point at these rows (the database refuses to
 * delete them), and history must stay correct. A deactivated item simply disappears
 * from the public site and from booking.
 */

// ----- services -----

export async function listServices({ db }) {
  return (await serviceModel.listAll(db)).map(adminServiceView);
}

export async function createService({ db }, input) {
  try {
    return adminServiceView(await serviceModel.create(db, input));
  } catch (err) {
    if (err?.code === '23505') throw AppError.conflict('slug_taken', 'Another service already uses this slug.');
    throw err;
  }
}

export async function updateService({ db }, id, patch) {
  let service;
  try {
    service = await serviceModel.update(db, id, patch);
  } catch (err) {
    if (err?.code === '23505') throw AppError.conflict('slug_taken', 'Another service already uses this slug.');
    throw err;
  }
  if (!service) throw AppError.notFound('service_not_found', 'Service not found.');
  return adminServiceView(service);
}

export const deactivateService = (ctx, id) => updateService(ctx, id, { is_active: false });

// ----- doctors -----

export async function listDoctors({ db }) {
  return (await staffModel.listAll(db)).map(adminDoctorView);
}

export async function createDoctor({ db }, input) {
  return adminDoctorView(await staffModel.create(db, input));
}

export async function updateDoctor({ db }, id, patch) {
  const doctor = await staffModel.update(db, id, patch);
  if (!doctor) throw AppError.notFound('doctor_not_found', 'Doctor not found.');
  return adminDoctorView(doctor);
}

export const deactivateDoctor = (ctx, id) => updateDoctor(ctx, id, { is_active: false });

// ----- clinic settings -----

export async function getSettings({ db }) {
  return settingsView(await clinicModel.getSettings(db));
}

export async function updateSettings({ db }, patch) {
  const settings = await clinicModel.updateSettings(db, patch);
  if (!settings) throw AppError.forbidden();
  return settingsView(settings);
}
