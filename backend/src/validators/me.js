import { z } from 'zod';
import { Email, Language, Phone } from './common.js';

export const UpdateMeBody = z.object({ preferred_language: Language });

/** Step 1: the new email or phone. A code goes to the new email (or, for a phone, to the email on file). */
export const ContactStartBody = z.discriminatedUnion('field', [
  z.object({ field: z.literal('email'), value: Email }),
  z.object({ field: z.literal('phone'), value: Phone }),
]);

/** Step 2: the 6-digit code from that email. */
export const ContactVerifyBody = z.object({
  field: z.enum(['email', 'phone']),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
});
