import { describe, expect, it } from 'vitest';
import { dummyVerify, hashPassword, needsRehash, temporaryPassword, verifyPassword } from '../../../src/auth/passwords.js';

describe('team passwords', () => {
  it('stores a salted scrypt hash, never the password', async () => {
    const stored = await hashPassword('correct horse battery');

    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(stored).not.toContain('correct');
  });

  it('accepts the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');

    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterz', stored)).toBe(false);
  });

  it('gives two people with the same password different hashes', async () => {
    expect(await hashPassword('same password here')).not.toBe(await hashPassword('same password here'));
  });

  it('treats the two ways of typing the same letter as the same password', async () => {
    const stored = await hashPassword('café-password');

    expect(await verifyPassword('café-password', stored)).toBe(true);
  });

  it('refuses a damaged or empty stored value instead of crashing', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', 'bcrypt$whatever')).toBe(false);
  });

  it('notices a password hashed with older settings', async () => {
    const stored = await hashPassword('correct horse battery');

    expect(needsRehash(stored)).toBe(false);
    expect(needsRehash(stored.replace('$32768$', '$16384$'))).toBe(true);
  });

  it('still checks a password hashed with older settings', async () => {
    // The settings travel with the stored value, so raising them later breaks nobody's password.
    const { default: crypto } = await import('node:crypto');
    const salt = Buffer.from('fixed-salt-16byt');
    const hash = crypto.scryptSync('old password value', salt, 64, { N: 2 ** 14, r: 8, p: 1 });
    const old = ['scrypt', 2 ** 14, 8, 1, salt.toString('base64url'), hash.toString('base64url')].join('$');

    expect(await verifyPassword('old password value', old)).toBe(true);
  });

  it('does the same slow work for an unknown email, and always says no', async () => {
    expect(await dummyVerify('anything at all')).toBe(false);
  });

  it('makes long, different temporary passwords', () => {
    expect(temporaryPassword().length).toBeGreaterThanOrEqual(16);
    expect(temporaryPassword()).not.toBe(temporaryPassword());
  });
});
