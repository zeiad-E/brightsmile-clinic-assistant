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

/** A new patient record without a booking (G5). Email or phone is required, like for bookings. */
export const PatientCreateBody = z
  .object({
    full_name: PersonName,
    date_of_birth: DateOfBirth,
    email: Email.optional(),
    phone: Phone.optional(),
    preferred_language: Language.default('en'),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((body) => body.email || body.phone, { message: 'Enter an email or a phone number.', path: ['email'] });

/** A team member's message in a patient's chat (G1). */
export const StaffReplyBody = z.object({ message: z.string().trim().min(1, 'Type a message.').max(2000) });

/** Mark a conversation reviewed (or undo it), with an optional note for the owner (G2). */
export const ReviewBody = z.object({
  reviewed: z.boolean().default(true),
  note: z.string().trim().max(1000).nullable().optional(),
});

/** "The assistant got this wrong" (G4): which answer, what kind of mistake, what should have happened. */
export const ReportBody = z.object({
  message_id: z.number().int().positive().optional(),
  kind: z.enum(['wrong_answer', 'wrong_action', 'tone', 'missed_handover', 'other']),
  note: z.string().trim().min(3, 'Say what went wrong.').max(1000),
});

export { StaffBookBody } from './appointments.js';
