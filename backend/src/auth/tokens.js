import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';

/**
 * Access tokens: short-lived signed passes (JWTs) the browser shows with every request.
 *
 * Think of a visitor badge: it says who you are and which visit this is (`sid`, the session), and
 * the stamp (the signature) proves we issued it. It lasts 15 minutes, so a stolen badge is soon
 * useless. The long-lived "stay signed in" part is the refresh token (see sessions.js), which
 * never goes near JavaScript.
 *
 * The checks are strict on purpose. Fixing the algorithm stops the classic `alg: none` trick, and
 * issuer, audience and `typ` stop a token made for something else from being accepted here.
 */
export const ACCESS_TOKEN_SECONDS = 15 * 60;

const ISSUER = 'brightsmile-api';
const AUDIENCE = 'brightsmile-web';
const ALGORITHM = 'HS256';
const TOKEN_TYPE = 'access';

const signingKey = () => new TextEncoder().encode(config.auth.jwtSecret);

/** Makes a token for one session. Returns it with the moment it expires (epoch seconds). */
export async function signAccessToken({ sub, sid, role }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ACCESS_TOKEN_SECONDS;
  const token = await new SignJWT({ sid, role, typ: TOKEN_TYPE })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(signingKey());
  return { token, expiresAt };
}

/** Returns the token's claims, or throws 401. It never says why a token was refused. */
export async function verifyAccessToken(token) {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ['sub', 'sid', 'role', 'typ', 'iat', 'exp'],
    });
    if (payload.typ !== TOKEN_TYPE) throw new Error('wrong token type');
    return payload;
  } catch {
    throw AppError.unauthorized('invalid_token', 'Your session has expired. Please sign in again.');
  }
}
