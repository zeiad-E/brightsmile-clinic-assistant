import { z } from 'zod';
import { addDays, startOfDayInZone } from '../utils/clinicTime.js';
import { DateOfBirth, DateTime, Day, Email, Language, notEmpty, Pagination, PersonName, Phone, Uuid } from './common.js';

/**
 * Appointment list filters. `date` (a clinic day) is turned into an exact from/to range,
 * so "appointments on 2026-11-01" means midnight-to-midnight in Cairo, not in UTC.
 */
export const StaffAppointmentsQuery = Pagination.extend({
  date: Day.optional(),
  from: DateTime.optional(),
  to: DateTime.optional(),
  staff_id: Uuid.optional(),
  status: z.enum(['booked', 'cancelled', 'completed', 'no_show']).optional(),
}).transform(({ date, staff_id: staffId, ...rest }) => {
  const range = date
    ? { from: startOfDayInZone(date).toISOString(), to: startOfDayInZone(addDays(date, 1)).toISOString() }
    : {};
  return { ...rest, ...range, staffId };
});

export const StatusBody = z.object({ status: z.enum(['completed', 'no_show']) });

export const PatientSearchQuery = Pagination.extend({ q: z.string().trim().max(100).optional() });

export const PatientUpdateBody = notEmpty(
  z.object({
    full_name: PersonName.optional(),
    date_of_birth: DateOfBirth.optional(),
    email: Email.nullable().optional(),
    phone: Phone.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    preferred_language: Language.optional(),
  }),
);

export const EscalationQuery = Pagination.extend({ status: z.enum(['open', 'resolved']).optional() });

/** staff_id=clinic → only clinic-wide closures; a uuid → that doctor plus clinic-wide ones. */
export const TimeOffQuery = Pagination.extend({
  from: DateTime.optional(),
  to: DateTime.optional(),
  staff_id: z.union([Uuid, z.literal('clinic')]).optional(),
}).transform(({ staff_id: staffId, ...rest }) => ({
  ...rest,
  staffId: staffId === 'clinic' ? null : staffId,
}));

const endsAfterStart = (body) => !body.starts_at || !body.ends_at || new Date(body.ends_at) > new Date(body.starts_at);

export const TimeOffBody = z
  .object({
    staff_id: Uuid.nullable(), // null = the whole clinic is closed
    starts_at: DateTime,
    ends_at: DateTime,
    reason: z.string().trim().max(200).optional(),
  })
  .refine(endsAfterStart, { message: 'The end must be after the start.', path: ['ends_at'] });

export const TimeOffPatch = notEmpty(
  z.object({
    starts_at: DateTime.optional(),
    ends_at: DateTime.optional(),
    reason: z.string().trim().max(200).nullable().optional(),
  }),
).refine(endsAfterStart, { message: 'The end must be after the start.', path: ['ends_at'] });

export { StaffBookBody } from './appointments.js';
