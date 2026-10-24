import crypto from 'node:crypto';

/**
 * Personal sign-in codes, e.g. `K7Q4-9M2X`.
 *
 * The alphabet drops look-alike characters (0/O, 1/I/L) so codes are easy to read
 * from an email and type on a phone. 8 characters from 31 symbols ≈ 8.5 × 10^11
 * combinations, which rate limiting makes impossible to guess.
 *
 * The database never stores the code itself, only an HMAC fingerprint of it
 * (`patients.code_hmac`). Even someone who reads the table cannot sign in with it.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generatePersonalCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // randomInt is unbiased, unlike `randomBytes % alphabet.length`.
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Forgives how people type it: lowercase, spaces and dashes are all accepted. */
export function normalizePersonalCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

/** The fingerprint stored in `patients.code_hmac` and sent to `find_patient_by_code`. */
export function hmacPersonalCode(secret, code) {
  if (!secret) throw new Error('A secret is required to fingerprint personal codes');
  return crypto.createHmac('sha256', secret).update(normalizePersonalCode(code)).digest('hex');
}
