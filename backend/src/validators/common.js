import { z } from 'zod';
import { dayInZone, isValidDay } from '../utils/clinicTime.js';

/**
 * Reusable input rules. Every validator builds on these, so "what is a valid phone
 * number" is decided in exactly one place.
 */

export const Uuid = z.uuid('Must be a valid id.');
export const IdParams = z.object({ id: Uuid });

export const Language = z.enum(['en', 'ar']);

export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email('Please enter a valid email address.'));

// "+20 100-123 4567" → "+201001234567" (international E.164 format, as stored in the database)
export const Phone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s().-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +201001234567.'));

export const PersonName = z.string().trim().min(2, 'Please enter the full name.').max(120);

/** A calendar day 'YYYY-MM-DD' (in the clinic's timezone). */
export const Day = z.string().refine(isValidDay, 'Use a real date in YYYY-MM-DD format.');

export const DateOfBirth = Day.refine((day) => day >= '1900-01-01' && day <= dayInZone(), 'Please enter a valid date of birth.');

/** An exact moment with its timezone, e.g. 2026-11-01T10:30:00+02:00 or …Z. */
export const DateTime = z.iso.datetime({ offset: true, message: 'Use an ISO date-time with a timezone, e.g. 2026-11-01T10:30:00+02:00.' });

export const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** For PATCH bodies: at least one field must be sent. */
export const notEmpty = (schema) =>
  schema.refine((value) => Object.keys(value).length > 0, 'Send at least one field to change.');

export const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour), e.g. 09:30.');
