import { requireAdmin } from '../db/supabase.js';
import * as clinicModel from '../models/clinicModel.js';
import * as serviceModel from '../models/serviceModel.js';
import * as staffModel from '../models/staffModel.js';
import * as workingHoursModel from '../models/workingHoursModel.js';
import { AppError } from '../utils/AppError.js';
import { clinicView } from '../views/clinicView.js';
import { serviceView } from '../views/serviceView.js';
import { doctorView } from '../views/doctorView.js';

/** The public catalog: clinic info, treatments, doctors. Only active items are shown. */

export async function clinicInfo(db) {
  const [settings, shifts] = await Promise.all([clinicModel.getSettings(db), workingHoursModel.listForActiveStaff(db)]);
  return clinicView(settings, shifts);
}

export async function listServices(db) {
  return (await serviceModel.listActive(db)).map(serviceView);
}

export async function getService(db, idOrSlug) {
  const service = await serviceModel.findByIdOrSlug(db, idOrSlug);
  if (!service?.is_active) throw AppError.notFound('service_not_found', 'This service does not exist.');
  return serviceView(service);
}

export async function listDoctors(db) {
  return (await staffModel.listActive(db)).map(doctorView);
}

export async function getDoctor(db, id) {
  const doctor = await staffModel.findById(db, id);
  if (!doctor?.is_active) throw AppError.notFound('doctor_not_found', 'This doctor does not exist.');
  return doctorView(doctor);
}

// Clinic name, timezone, phone and change window are needed by every email; cache them
// briefly instead of reading the settings row for each one.
let branding = null;
let brandingAt = 0;
const BRANDING_TTL_MS = 5 * 60 * 1000;

export async function clinicBranding() {
  if (!branding || Date.now() - brandingAt > BRANDING_TTL_MS) {
    const settings = await clinicModel.getSettings(requireAdmin());
    branding = {
      nameEn: settings.name_en,
      nameAr: settings.name_ar,
      timeZone: settings.timezone,
      phone: settings.phone,
      cancellationWindowHours: settings.cancellation_window_hours,
    };
    brandingAt = Date.now();
  }
  return branding;
}

export const clinicNameIn = (brand, language) => (language === 'ar' ? brand.nameAr : brand.nameEn);
