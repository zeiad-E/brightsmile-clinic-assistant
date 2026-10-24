import { z } from 'zod';
import { DateTime, Email, Language, notEmpty, Pagination, PersonName, Time, Uuid } from './common.js';

const Slug = z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase words joined by dashes, e.g. teeth-cleaning.');
const Text = (max) => z.string().trim().min(1).max(max);
const OptionalText = (max) => z.string().trim().max(max).nullable().optional();

const ServiceFields = {
  slug: Slug,
  name_en: Text(120),
  name_ar: Text(120),
  description_en: OptionalText(2000),
  description_ar: OptionalText(2000),
  duration_minutes: z.number().int().min(5).max(480).multipleOf(5, 'Use steps of 5 minutes.'),
  price_egp: z.number().min(0).max(1_000_000),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
};

export const ServiceBody = z.object(ServiceFields);
export const ServicePatch = notEmpty(z.object(ServiceFields).partial());

const DoctorFields = {
  full_name_en: Text(120),
  full_name_ar: Text(120),
  title: z.enum(['dentist', 'hygienist']),
  bio_en: OptionalText(2000),
  bio_ar: OptionalText(2000),
  photo_url: z.url().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
};

export const DoctorBody = z.object(DoctorFields);
export const DoctorPatch = notEmpty(z.object(DoctorFields).partial());

export const StaffServicesBody = z.object({ service_ids: z.array(Uuid).max(50) });

export const WorkingHoursBody = z.object({
  hours: z
    .array(
      z
        .object({ weekday: z.number().int().min(0).max(6), start_time: Time, end_time: Time })
        .refine((h) => h.end_time > h.start_time, { message: 'The end time must be after the start time.' }),
    )
    .max(21),
});

export const SettingsPatch = notEmpty(
  z.object({
    name_en: Text(120).optional(),
    name_ar: Text(120).optional(),
    phone: OptionalText(40),
    email: Email.nullable().optional(),
    address_en: OptionalText(300),
    address_ar: OptionalText(300),
    slot_step_minutes: z.number().int().min(5).max(60).optional(),
    min_lead_minutes: z.number().int().min(0).max(10080).optional(),
    booking_horizon_days: z.number().int().min(1).max(365).optional(),
    cancellation_window_hours: z.number().int().min(0).max(168).optional(),
  }),
);

// Only staff and viewer accounts are created here; there is exactly one owner.
const TeamRole = z.enum(['staff', 'viewer']);

export const TeamCreateBody = z.object({
  email: Email,
  full_name: PersonName,
  role: TeamRole,
  staff_id: Uuid.optional(),
  preferred_language: Language.default('en'),
});

export const RoleBody = z.object({ role: TeamRole });

export const AuditQuery = Pagination.extend({
  entity: z.string().trim().max(50).optional(),
  entity_id: z.string().trim().max(100).optional(),
  from: DateTime.optional(),
  to: DateTime.optional(),
}).transform(({ entity_id: entityId, ...rest }) => ({ ...rest, entityId }));

export const NotificationQuery = Pagination.extend({
  status: z.enum(['queued', 'sent', 'failed']).optional(),
  template: z.enum(['booking_confirmed', 'login_code', 'booking_cancelled', 'welcome']).optional(),
});
