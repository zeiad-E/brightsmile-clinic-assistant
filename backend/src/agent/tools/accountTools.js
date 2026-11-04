import { z } from 'zod';
import * as authService from '../../services/authService.js';
import * as registrationService from '../../services/registrationService.js';
import { AppError } from '../../utils/AppError.js';
import { DateOfBirth, Email, PersonName, Phone } from '../../validators/common.js';
import { LIMITS } from '../guardrails.js';
import { defineTool, toolError } from './define.js';

/**
 * Signing in by chatting. The values arrive as placeholders ([PHONE_1], [CODE_1]…) and are
 * swapped back by the code, so the AI never sees them. Anything that signs the patient in goes
 * only to their browser; the AI only learns "signed in" and the first name.
 */

function attemptsLeft(ctx) {
  ctx.state.signInAttempts = (ctx.state.signInAttempts ?? 0) + 1;
  return Math.max(0, LIMITS.maxSignInAttempts - ctx.state.signInAttempts);
}

function guard(ctx) {
  if (ctx.isPatient) return { already_signed_in: true };
  if (ctx.state.firstVisit) {
    return toolError(
      'first_visit',
      'This patient said it is their first visit, so they have no account to sign in to. Collect full name, date of birth and email or phone, then use check_availability and propose_booking — booking creates their account.',
    );
  }
  if ((ctx.state.signInAttempts ?? 0) >= LIMITS.maxSignInAttempts) {
    return toolError('too_many_attempts', 'Too many sign-in attempts in this chat. Offer to connect them with staff, or to try again later.');
  }
  return null;
}

async function finish(ctx, verified) {
  const identity = await ctx.signIn(verified);
  if (!identity) return toolError('login_unavailable', 'Online sign-in is not available for this person here. Offer to connect them with staff.');
  ctx.state.signInAttempts = 0;
  return { signed_in: true, first_name: identity?.fullName?.split(' ')[0] ?? null };
}

function signInFailure(ctx, err) {
  if (!(err instanceof AppError)) throw err;
  if (err.code === 'account_locked') return toolError('locked', 'Too many wrong tries; the account is locked for 15 minutes. Offer staff help.');
  return toolError(err.code, 'The details did not match.', { attempts_left: attemptsLeft(ctx) });
}

export const signInWithPhone = defineTool({
  name: 'sign_in_with_phone',
  description: 'RETURNING patients only (they said they visited before). Sign in with phone number + full name + date of birth (pass the placeholders exactly as written).',
  schema: z.object({ phone: z.string().max(40), full_name: z.string().min(2).max(120), date_of_birth: z.string().max(40) }),
  run: async ({ phone, full_name: fullName, date_of_birth: dob }, ctx) => {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    const parsedPhone = Phone.safeParse(phone);
    const parsedDob = DateOfBirth.safeParse(dob);
    if (!parsedPhone.success) return toolError('invalid_phone', 'Ask for the phone number with country code.');
    if (!parsedDob.success) return toolError('invalid_date_of_birth', 'Ask for the date of birth as day, month and year.');
    try {
      return await finish(ctx, await authService.phoneLogin({ phone: parsedPhone.data, full_name: fullName, date_of_birth: parsedDob.data }, { visitor: ctx.visitor }));
    } catch (err) {
      return signInFailure(ctx, err);
    }
  },
});

export const signInWithCode = defineTool({
  name: 'sign_in_with_code',
  description: 'RETURNING patients only. Sign in with the personal code from their confirmation email (pass the placeholder exactly as written).',
  schema: z.object({ code: z.string().min(4).max(30) }),
  run: async ({ code }, ctx) => {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    try {
      return await finish(ctx, await authService.codeLogin({ code }, { visitor: ctx.visitor }));
    } catch (err) {
      return signInFailure(ctx, err);
    }
  },
});

export const sendEmailCode = defineTool({
  name: 'send_email_code',
  description: 'RETURNING patients only (never for a first visit). Email a one-time sign-in code. Then ask them to type the code here.',
  schema: z.object({ email: z.string().max(254) }),
  run: async ({ email }, ctx) => {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    const parsed = Email.safeParse(email);
    if (!parsed.success) return toolError('invalid_email', 'That email address looks wrong; ask again.');
    await authService.startEmailCode({ email: parsed.data });
    ctx.state.emailForCode = parsed.data;
    return { sent: true, note: 'If this email is registered, a code was sent. Ask the patient to type it here.' };
  },
});

export const verifyEmailCode = defineTool({
  name: 'verify_email_code',
  description: 'Check the code the patient received by email. Pass the email and the code placeholders exactly as written.',
  schema: z.object({ email: z.string().max(254).optional(), code: z.string().min(4).max(30) }),
  run: async ({ email, code }, ctx) => {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    const target = Email.safeParse(email ?? ctx.state.emailForCode ?? '');
    if (!target.success) return toolError('invalid_email', 'Ask for the email address the code was sent to.');
    try {
      return await finish(ctx, await authService.verifyEmailCode({ email: target.data, code: String(code).replace(/\s/g, '') }));
    } catch (err) {
      return signInFailure(ctx, err);
    }
  },
});

/** Creating an account is for new patients, so "first visit" doesn't block it. */
function signUpGuard(ctx) {
  if (ctx.isPatient) return { already_signed_in: true };
  if ((ctx.state.signInAttempts ?? 0) >= LIMITS.maxSignInAttempts) {
    return toolError('too_many_attempts', 'Too many tries in this chat. Offer to connect them with staff, or to try again later.');
  }
  return null;
}

export const startSignUp = defineTool({
  name: 'start_sign_up',
  description: 'NEW patients who want an account now, without booking yet. Needs full name, date of birth, phone and email (pass the placeholders exactly as written). Emails a 6-digit code; then ask them to type it here and call finish_sign_up.',
  schema: z.object({ full_name: z.string().min(2).max(120), date_of_birth: z.string().max(40), phone: z.string().max(40), email: z.string().max(254) }),
  run: async ({ full_name: fullName, date_of_birth: dob, phone, email }, ctx) => {
    const blocked = signUpGuard(ctx);
    if (blocked) return blocked;
    const name = PersonName.safeParse(fullName);
    const parsedDob = DateOfBirth.safeParse(dob);
    const parsedPhone = Phone.safeParse(phone);
    const parsedEmail = Email.safeParse(email);
    if (!name.success) return toolError('invalid_name', 'Ask for their full name.');
    if (!parsedDob.success) return toolError('invalid_date_of_birth', 'Ask for the date of birth as day, month and year.');
    if (!parsedPhone.success) return toolError('invalid_phone', 'Ask for the phone number with country code.');
    if (!parsedEmail.success) return toolError('invalid_email', 'That email address looks wrong; ask again.');
    await registrationService.startRegistration({
      full_name: name.data,
      date_of_birth: parsedDob.data,
      phone: parsedPhone.data,
      email: parsedEmail.data,
      preferred_language: ctx.language,
    });
    ctx.state.emailForSignUp = parsedEmail.data;
    return { sent: true, note: 'A code was sent to their email. Ask the patient to type it here.' };
  },
});

export const finishSignUp = defineTool({
  name: 'finish_sign_up',
  description: 'Second step of start_sign_up: check the code the patient received by email (pass the code placeholder exactly as written). Creates the account and signs them in.',
  schema: z.object({ code: z.string().min(4).max(30) }),
  run: async ({ code }, ctx) => {
    const blocked = signUpGuard(ctx);
    if (blocked) return blocked;
    if (!ctx.state.emailForSignUp) return toolError('sign_up_not_started', 'Collect their details and call start_sign_up first.');
    try {
      const { personalCode, ...verified } = await registrationService.finishRegistration(
        { email: ctx.state.emailForSignUp, code: String(code).replace(/\s/g, '') },
        { via: 'patient_assistant', visitor: ctx.visitor },
      );
      const result = await finish(ctx, verified);
      if (result.error) return result;
      delete ctx.state.emailForSignUp;
      // The patient's screen shows their code; it never goes into the AI's result.
      if (personalCode) ctx.emit({ type: 'personal_code', code: personalCode });
      return { ...result, note: personalCode ? 'Their account is ready. Their personal code is shown on their screen and emailed: never repeat it.' : 'They already had an account, and are now signed in to it.' };
    } catch (err) {
      if (err instanceof AppError && err.code === 'phone_in_use') {
        delete ctx.state.emailForSignUp;
        return toolError('phone_in_use', 'This phone number is already on another account. Offer to sign them in with it, or to connect them with staff.');
      }
      return signInFailure(ctx, err);
    }
  },
});
