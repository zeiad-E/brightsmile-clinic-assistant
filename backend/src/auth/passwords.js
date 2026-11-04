import crypto from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Team passwords, hashed with scrypt (built into Node).
 *
 * A hash is a one-way scramble: we can check a password but never read it back. scrypt is slow and
 * memory-hungry on purpose, so someone who stole the table can only try a handful of guesses per
 * second instead of billions. The stored value carries its own settings
 * (`scrypt$N$r$p$salt$hash`), so the settings can be raised later without breaking old passwords.
 *
 * It runs on Node's background threads, so hashing never blocks other requests.
 */
const scrypt = promisify(crypto.scrypt);

const SETTINGS = Object.freeze({ N: 2 ** 15, r: 8, p: 1 });
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024; // scrypt needs about 128 × N × r bytes

export const PASSWORD_LIMITS = Object.freeze({ min: 10, max: 128 });

// The same password can be typed as different Unicode sequences (é as one or two characters).
const derive = (password, salt, { N, r, p }) => scrypt(String(password).normalize('NFKC'), salt, KEY_BYTES, { N, r, p, maxmem: MAX_MEMORY });

export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, SETTINGS);
  return ['scrypt', SETTINGS.N, SETTINGS.r, SETTINGS.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

function parse(stored) {
  const [scheme, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return null;
  return { N: Number(N), r: Number(r), p: Number(p), salt: Buffer.from(salt, 'base64url'), hash: Buffer.from(hash, 'base64url') };
}

export async function verifyPassword(password, stored) {
  const parsed = parse(stored);
  if (!parsed) return false;
  const derived = await derive(password, parsed.salt, parsed);
  return derived.length === parsed.hash.length && crypto.timingSafeEqual(derived, parsed.hash);
}

/** True when a password was hashed with older settings and should be re-hashed at sign-in. */
export function needsRehash(stored) {
  const parsed = parse(stored);
  return !parsed || parsed.N !== SETTINGS.N || parsed.r !== SETTINGS.r || parsed.p !== SETTINGS.p;
}

let dummyHash = null;

/**
 * Does the same slow work as a real check. Used when the email is unknown, so the time a sign-in
 * takes can't reveal whether an account exists.
 */
export async function dummyVerify(password) {
  dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(password, dummyHash);
  return false;
}

/** The one-time password in a new team member's welcome email. */
export const temporaryPassword = () => crypto.randomBytes(12).toString('base64url');
