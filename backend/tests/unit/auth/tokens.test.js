import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { config } from '../../../src/config/index.js';
import { ACCESS_TOKEN_SECONDS, signAccessToken, verifyAccessToken } from '../../../src/auth/tokens.js';

/** Access tokens: only a token we made, for this purpose, unexpired and unchanged, is accepted. */
const ids = { sub: '11111111-1111-4111-8111-111111111111', sid: '22222222-2222-4222-8222-222222222222', role: 'staff' };
const key = (secret = config.auth.jwtSecret) => new TextEncoder().encode(secret);
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const refused = { status: 401, code: 'invalid_token' };

/** A token built by hand, so each test can get exactly one thing wrong. */
function forge({ alg = 'HS256', secret, claims = {}, issuer = 'brightsmile-api', audience = 'brightsmile-web', exp = '10m' } = {}) {
  return new SignJWT({ sid: ids.sid, role: ids.role, typ: 'access', ...claims })
    .setProtectedHeader({ alg })
    .setSubject(ids.sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key(secret));
}

describe('access tokens', () => {
  it('accepts a token it made, with the session and role inside', async () => {
    const { token, expiresAt } = await signAccessToken(ids);
    const claims = await verifyAccessToken(token);

    expect(claims).toMatchObject({ sub: ids.sub, sid: ids.sid, role: 'staff', typ: 'access' });
    expect(expiresAt - claims.iat).toBe(ACCESS_TOKEN_SECONDS);
  });

  it('agrees with the hand-built token used to test the refusals below', async () => {
    await expect(verifyAccessToken(await forge())).resolves.toMatchObject({ sid: ids.sid });
  });

  it('refuses the "alg: none" trick (no signature at all)', async () => {
    const claims = { ...ids, typ: 'access', iss: 'brightsmile-api', aud: 'brightsmile-web', iat: 1, exp: 9_999_999_999 };
    const unsigned = `${base64url({ alg: 'none' })}.${base64url(claims)}.`;

    await expect(verifyAccessToken(unsigned)).rejects.toMatchObject(refused);
  });

  it('refuses another algorithm, even signed with the right secret', async () => {
    await expect(verifyAccessToken(await forge({ alg: 'HS512' }))).rejects.toMatchObject(refused);
  });

  it('refuses a token signed with a different secret', async () => {
    await expect(verifyAccessToken(await forge({ secret: 'another-secret-another-secret-another' }))).rejects.toMatchObject(refused);
  });

  it('refuses a token made for another issuer or audience', async () => {
    await expect(verifyAccessToken(await forge({ issuer: 'someone-else' }))).rejects.toMatchObject(refused);
    await expect(verifyAccessToken(await forge({ audience: 'some-other-app' }))).rejects.toMatchObject(refused);
  });

  it('refuses an expired token', async () => {
    await expect(verifyAccessToken(await forge({ exp: '-1s' }))).rejects.toMatchObject(refused);
  });

  it('refuses a token that was changed after signing', async () => {
    const { token } = await signAccessToken(ids);
    const [header, , signature] = token.split('.');
    const promoted = base64url({ ...ids, role: 'owner', typ: 'access', iss: 'brightsmile-api', aud: 'brightsmile-web', iat: 1, exp: 9_999_999_999 });

    await expect(verifyAccessToken(`${header}.${promoted}.${signature}`)).rejects.toMatchObject(refused);
  });

  it('refuses a token with no session, or of another type', async () => {
    await expect(verifyAccessToken(await forge({ claims: { sid: undefined } }))).rejects.toMatchObject(refused);
    await expect(verifyAccessToken(await forge({ claims: { typ: 'refresh' } }))).rejects.toMatchObject(refused);
  });

  it('refuses rubbish', async () => {
    await expect(verifyAccessToken('not.a.token')).rejects.toMatchObject(refused);
  });
});
