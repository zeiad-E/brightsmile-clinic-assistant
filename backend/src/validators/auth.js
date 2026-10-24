import { z } from 'zod';
import { DateOfBirth, Email, PersonName, Phone } from './common.js';

export const StaffLoginBody = z.object({
  email: Email,
  password: z.string().min(1, 'Please enter your password.').max(200),
});

export const EmailStartBody = z.object({ email: Email });

export const EmailVerifyBody = z.object({
  email: Email,
  code: z.string().trim().regex(/^\d{6,10}$/, 'Enter the code from the email.'),
});

export const PhoneLoginBody = z.object({
  phone: Phone,
  full_name: PersonName,
  date_of_birth: DateOfBirth,
});

export const CodeLoginBody = z.object({
  code: z.string().trim().min(8, 'Enter your 8-character code.').max(20),
});

export const RefreshBody = z.object({ refresh_token: z.string().min(10).max(500) });

// bcrypt (used by Supabase Auth) only reads the first 72 bytes of a password.
export const PasswordBody = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(10, 'Use at least 10 characters.').max(72),
});
