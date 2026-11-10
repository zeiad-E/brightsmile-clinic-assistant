import { z } from 'zod';
import { dayInZone, isValidDay } from '../utils/clinicTime.js';
import { toLatinDigits } from '../utils/text.js';

/**
 * Reusable input rules. Every validator builds on these, so "what is a valid phone
 * number" is decided in exactly one place.
 */

export const Uuid = z.uuid('Must be a valid id.');
export const IdParams = z.object({ id: Uuid });

export const Language = z.enum(['en', 'ar']);

export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email('Please enter a valid email address.'));

/**
 * A phone as people type it → international E.164 format ("+201001234567"), as stored in the database.
 * The clinic is in Egypt, so a number without a country code is read as Egyptian:
 *   "01001234567", "0100 123 4567", "٠١٠٠١٢٣٤٥٦٧" (0 + number), "1001234567" (the 0 left out),
 *   "201001234567" (20 without the +), "00201001234567" (00 instead of +).
 * A number that can't be fixed is returned as typed, so phoneProblem can say what is wrong with it.
 */
export function cleanPhone(value) {
  const compact = toLatinDigits(value).trim().replace(/[\s().\-–]/g, '');
  if (compact.startsWith('+')) return compact;
  if (compact.startsWith('00')) return `+${compact.slice(2)}`;
  if (/^0\d{7,11}$/.test(compact)) return `+20${compact.slice(1)}`;
  if (/^201\d{9}$/.test(compact)) return `+${compact}`;
  if (/^1[0125]\d{8}$/.test(compact)) return `+20${compact}`;
  return compact;
}

/**
 * What is wrong with a cleaned phone, in words a patient understands (null = nothing).
 * Egyptian numbers are checked properly: a mobile is 01 + 9 digits (010, 011, 012 or 015), a
 * landline 0 + 8–9 digits. Other countries only get a length check (7–15 digits): without a big
 * library we can't know every country's rules.
 */
export function phoneProblem(phone) {
  if (!/^\+\d+$/.test(phone)) return 'Enter a phone number like 01001234567 or +201001234567.';
  if (phone.startsWith('+20')) {
    const local = phone.slice(3);
    if (local.startsWith('1')) {
      if (local.length !== 10) return `Egyptian mobile numbers have 11 digits (like 010 1234 5678); this one has ${local.length + 1}.`;
      if (!/^1[0125]/.test(local)) return 'Egyptian mobile numbers start with 010, 011, 012 or 015.';
      return null;
    }
    if (local.length < 8 || local.length > 9) return 'That Egyptian number looks incomplete; please check it.';
    return null;
  }
  const digits = phone.length - 1;
  if (digits < 7) return 'That phone number looks too short; please check it.';
  if (digits > 15) return 'That phone number looks too long; please check it.';
  return null;
}

export const Phone = z
  .string()
  .transform(cleanPhone)
  .check((ctx) => {
    const problem = phoneProblem(ctx.value);
    if (problem) ctx.issues.push({ code: 'custom', message: problem, input: ctx.value });
  });

export const PersonName = z.string().trim().min(2, 'Please enter the full name.').max(120);

/** A full name for a patient file: first and last name at least. */
export const FullName = PersonName.refine((name) => name.split(/\s+/).length >= 2, 'Please write your first and last name.');

/** A calendar day 'YYYY-MM-DD' (in the clinic's timezone). */
export const Day = z.string().refine(isValidDay, 'Use a real date in YYYY-MM-DD format.');

/** Arabic month names as Egyptians write them (with their common spellings) → month number. */
export const ARABIC_MONTHS = {
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, إبريل: 4, مايو: 5, يونيو: 6, يونيه: 6, يوليو: 7, يوليه: 7,
  أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
};
const ENGLISH_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const monthNumber = (word) => ARABIC_MONTHS[word] ?? ENGLISH_MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;

/**
 * A date as people write it → 'YYYY-MM-DD'. Day comes before month, as in Egypt:
 *   "15/3/1990", "15-3-1990", "15.3.1990", "1990-03-15", "1990/3/15",
 *   "15 March 1990", "March 15, 1990", "15 مارس 1990", Arabic digits too.
 * Anything else is returned as typed (and then fails the date check).
 */
export function cleanDate(value) {
  const text = toLatinDigits(value).trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return ymd(m[1], m[2], m[3]);
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/.exec(text);
  if (m) return ymd(m[3], m[2], m[1]);
  m = /^(\d{1,2}) ([\p{L}]+)\.?,? (\d{4})$/u.exec(text);
  if (m && monthNumber(m[2])) return ymd(m[3], monthNumber(m[2]), m[1]);
  m = /^([\p{L}]+)\.? (\d{1,2}),? (\d{4})$/u.exec(text);
  if (m && monthNumber(m[1])) return ymd(m[3], monthNumber(m[1]), m[2]);
  return text;
}

export const DateOfBirth = z
  .string()
  .transform(cleanDate)
  .pipe(Day.refine((day) => day >= '1900-01-01' && day <= dayInZone(), 'Please enter a valid date of birth.'));

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
