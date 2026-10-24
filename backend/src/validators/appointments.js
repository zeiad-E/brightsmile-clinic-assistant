import { z } from 'zod';
import { DateOfBirth, DateTime, Email, Language, Pagination, PersonName, Phone, Uuid } from './common.js';

const Notes = z.string().trim().max(500);

/**
 * Website booking. Identity fields are optional here because a signed-in patient doesn't
 * send them (their own record is used); the service requires them from guests.
 */
export const BookBody = z.object({
  service_id: Uuid,
  staff_id: Uuid,
  starts_at: DateTime,
  full_name: PersonName.optional(),
  date_of_birth: DateOfBirth.optional(),
  email: Email.optional(),
  phone: Phone.optional(),
  preferred_language: Language.default('en'),
  notes: Notes.optional(),
});

/** Staff booking: staff always type the patient's details. */
export const StaffBookBody = z
  .object({
    service_id: Uuid,
    staff_id: Uuid,
    starts_at: DateTime,
    full_name: PersonName,
    date_of_birth: DateOfBirth,
    email: Email.optional(),
    phone: Phone.optional(),
    preferred_language: Language.default('en'),
    notes: Notes.optional(),
  })
  .refine((body) => body.email || body.phone, { message: 'Enter an email or a phone number.', path: ['email'] });

export const CancelBody = z.object({ reason: z.string().trim().max(300).optional() });

export const RescheduleBody = z.object({
  starts_at: DateTime,
  staff_id: Uuid.optional(),
});

export const MyAppointmentsQuery = Pagination.extend({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
});
