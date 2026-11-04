import { identityFor } from '../auth/sessions.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { dbFor } from '../db/supabase.js';
import { AppError } from '../utils/AppError.js';

/**
 * Works out who is calling, from the `Authorization: Bearer <access token>` header.
 *
 * - No header → anonymous visitor (`req.user = null`); public routes still work.
 * - A header → the token MUST be valid, otherwise 401. We never silently fall back to
 *   anonymous, so a broken login is noticed instead of hidden.
 *
 * Two checks: the token's signature and expiry (auth/tokens.js), then that its session still stands
 * (auth/sessions.js). So signing out or disabling an account works from the next request on.
 *
 * Sets:
 *   req.user = { id, role, sessionId, email, fullName, preferredLanguage, patientId, staffId, mustChangePassword }
 *   req.db   = the database client for this user (audited as them; masked for the viewer)
 */
const BEARER = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/i;

export function authenticate() {
  return async (req, _res, next) => {
    req.user = null;
    req.db = null;

    const header = req.get('authorization');
    if (!header) return next();

    const match = BEARER.exec(header);
    if (!match) throw AppError.unauthorized('invalid_token', 'The Authorization header must be "Bearer <token>".');

    const identity = await identityFor(await verifyAccessToken(match[1]));
    req.user = identity;
    req.db = dbFor(identity);
    return next();
  };
}
