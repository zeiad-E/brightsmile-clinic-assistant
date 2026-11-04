import crypto from 'node:crypto';
import { config } from '../config/index.js';

/**
 * Personal sign-in codes, e.g. `K7Q4-9M2X`.
 *
 * The alphabet drops look-alike characters (0/O, 1/I/L) so codes are easy to read from a card or
 * an email and type on a phone. 8 characters from 31 symbols ≈ 8.5 × 10^11 combinations, which
 * rate limiting makes impossible to guess.
 *
 * A code is stored in two forms, each for one job:
 *  - `patients.code_hmac`: a keyed fingerprint, to FIND the patient from a typed code.
 *  - `patients.code_ciphertext`: AES-256-GCM encryption, so the code can be SHOWN again in the
 *    patient's profile and printed on their card. Reading the table alone reveals neither: the
 *    keys live only on the server.
 *
 * Encryption is tied to the patient's id, so a stored code can't be copied onto another record.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;

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

/** The fingerprint stored in `patients.code_hmac`, used to look a code up. */
export function hmacPersonalCode(secret, code) {
  if (!secret) throw new Error('A secret is required to fingerprint personal codes');
  return crypto.createHmac('sha256', secret).update(normalizePersonalCode(code)).digest('hex');
}

const boundTo = (patientId) => Buffer.from(`patient:${patientId}`);

/** Returns what to store: `{ ciphertext, keyId }`. */
export function encryptPersonalCode(code, patientId) {
  const { id, key } = config.auth.codeKeys.current;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(boundTo(patientId));
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'), keyId: id };
}

/** Throws if the data was changed, belongs to another patient, or its key is gone. */
export function decryptPersonalCode({ ciphertext, keyId }, patientId) {
  const key = config.auth.codeKeys.byId.get(keyId);
  if (!key) throw new Error(`No key "${keyId}" for personal codes`);
  const data = Buffer.from(ciphertext, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, IV_BYTES));
  decipher.setAAD(boundTo(patientId));
  decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(data.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
}
