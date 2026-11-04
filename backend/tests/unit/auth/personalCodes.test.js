import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../../../src/config/index.js';
import { decryptPersonalCode, encryptPersonalCode, generatePersonalCode, hmacPersonalCode } from '../../../src/auth/personalCodes.js';

const PATIENT = '11111111-1111-4111-8111-111111111111';
const OTHER_PATIENT = '22222222-2222-4222-8222-222222222222';
const originalKeys = config.auth.codeKeys;

afterEach(() => {
  config.auth.codeKeys = originalKeys;
});

describe('personal code lookup', () => {
  it('keeps producing the same fingerprint, so codes already issued keep working', () => {
    // Recorded from the code that issued the live codes. If this changes, every patient's code breaks.
    expect(hmacPersonalCode('fixed-test-secret-for-the-vector', 'K7Q4-9M2X')).toBe(
      'b8359b1cd94bae59a52a539e3ed5413ad628b768075a671d8c650ac2e5270319',
    );
  });
});

describe('personal code encryption', () => {
  it('gives back the code, and stores nothing readable', () => {
    const code = generatePersonalCode();
    const stored = encryptPersonalCode(code, PATIENT);

    expect(decryptPersonalCode(stored, PATIENT)).toBe(code);
    expect(stored.ciphertext).not.toContain(code);
    expect(stored.keyId).toBe(originalKeys.current.id);
  });

  it('encrypts the same code differently each time', () => {
    expect(encryptPersonalCode('K7Q4-9M2X', PATIENT).ciphertext).not.toBe(encryptPersonalCode('K7Q4-9M2X', PATIENT).ciphertext);
  });

  it('refuses a stored code copied onto another patient', () => {
    const stored = encryptPersonalCode('K7Q4-9M2X', PATIENT);

    expect(() => decryptPersonalCode(stored, OTHER_PATIENT)).toThrow();
  });

  it('refuses stored data that was changed', () => {
    const stored = encryptPersonalCode('K7Q4-9M2X', PATIENT);
    const bytes = Buffer.from(stored.ciphertext, 'base64url');
    bytes[bytes.length - 1] ^= 1;

    expect(() => decryptPersonalCode({ ...stored, ciphertext: bytes.toString('base64url') }, PATIENT)).toThrow();
  });

  it('refuses when the key is unknown', () => {
    const stored = encryptPersonalCode('K7Q4-9M2X', PATIENT);

    expect(() => decryptPersonalCode({ ...stored, keyId: 'gone' }, PATIENT)).toThrow(/No key/);
  });

  it('can still read codes after the key is rotated', () => {
    const before = encryptPersonalCode('K7Q4-9M2X', PATIENT);

    const fresh = { id: 'k2', key: crypto.randomBytes(32) };
    config.auth.codeKeys = { current: fresh, byId: new Map([...originalKeys.byId, [fresh.id, fresh.key]]) };

    expect(decryptPersonalCode(before, PATIENT)).toBe('K7Q4-9M2X');
    expect(encryptPersonalCode('K7Q4-9M2X', PATIENT).keyId).toBe('k2');
  });
});
