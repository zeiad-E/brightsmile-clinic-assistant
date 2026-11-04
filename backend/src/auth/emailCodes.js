import { config } from '../config/index.js';
import { hmacHex } from './secrets.js';

/**
 * Rules and fingerprints for the 6-digit codes we email for sign-up and sign-in.
 *
 * The database keeps a keyed fingerprint, never the code. The purpose and the email are part of
 * what is fingerprinted, so a code made for one person or one flow is useless anywhere else.
 */
export const EMAIL_CODE = Object.freeze({
  validMinutes: 10,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxSendsPerHour: 5,
});

export const emailCodeFingerprint = (purpose, email, code) =>
  hmacHex(config.auth.personalCodeSecret, `email-code:${purpose}:${String(email).trim().toLowerCase()}:${code}`);
