import { AppError } from '../utils/AppError.js';
import { anonClient, createUserClient } from '../db/userClient.js';
import { findIdentity } from '../models/profileModel.js';

/**
 * Works out who is calling, from the `Authorization: Bearer <access token>` header.
 *
 * - No header → anonymous visitor (`req.user = null`); public routes still work.
 * - A header → the token MUST be valid, otherwise 401. We never silently fall back to
 *   anonymous, so a broken login is noticed instead of hidden.
 *
 * The token (a JWT issued by Supabase Auth) is checked for a valid signature and expiry.
 * The role then comes from the database (`profiles.role`), not from the token, so a role
 * change takes effect on the next request.
 *
 * Sets:
 *   req.user  = { id, role, email, fullName, preferredLanguage, patientId, staffId }
 *   req.db    = a database client acting AS this user (Row Level Security applies)
 *   req.token = the raw access token (needed to sign out)
 */
const BEARER = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/i;

export async function verifyAccessToken(token) {
  const { data, error } = await anonClient().auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    throw AppError.unauthorized('invalid_token', 'Your session has expired. Please sign in again.');
  }
  return data.claims;
}

export function authenticate() {
  return async (req, _res, next) => {
    req.user = null;
    req.db = null;
    req.token = null;

    const header = req.get('authorization');
    if (!header) return next();

    const match = BEARER.exec(header);
    if (!match) throw AppError.unauthorized('invalid_token', 'The Authorization header must be "Bearer <token>".');

    const token = match[1];
    const claims = await verifyAccessToken(token);
    const db = createUserClient(token);
    const identity = await findIdentity(db, claims.sub);
    if (!identity) throw AppError.unauthorized('account_not_found', 'This account no longer exists.');

    req.user = identity;
    req.db = db;
    req.token = token;
    return next();
  };
}
