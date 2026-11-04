import crypto from 'node:crypto';

/** Small crypto helpers shared by the sign-in code. Everything here is built into Node. */

/** A long random secret, safe in a URL or a cookie. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** One-way fingerprint for values that are already random, e.g. refresh tokens. */
export const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Keyed fingerprint for guessable values: without the key, nobody can test guesses against it. */
export function hmacHex(key, input) {
  if (!key) throw new Error('A secret is required to fingerprint a value');
  return crypto.createHmac('sha256', key).update(input).digest('hex');
}

/** Compares two strings without leaking, through timing, how many characters matched. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** A 6-digit one-time code. randomInt is unbiased, and padStart keeps leading zeros. */
export const sixDigitCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
