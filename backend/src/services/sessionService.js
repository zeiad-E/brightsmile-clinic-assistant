import { requireAdmin } from '../db/supabase.js';
import { createAuthClient } from '../db/userClient.js';
import * as profileModel from '../models/profileModel.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/**
 * Turning "we have verified this person" into a real Supabase session.
 *
 * Supabase can't natively sign someone in with "phone + name + date of birth" or with our
 * personal code. So after OUR checks pass, we ask Supabase (as the server) for a one-time
 * login token for that user, and immediately exchange it for a session. No email is sent.
 *
 * The result is a normal Supabase access token, so every sign-in method looks the same to
 * the rest of the system (and to the database's security rules).
 *
 * PATIENTS ONLY. This skips any password, so it must never open a clinic team account: the
 * owner and staff sign in with their password (POST /api/auth/staff/login) and nothing else.
 * The role is checked here, at the one place every server-made session passes through.
 */
export async function mintSession(email) {
  const profile = await profileModel.findByEmail(requireAdmin(), email);
  if (profile?.role !== 'patient') {
    logger.warn(`Refused to make a session for a ${profile?.role ?? 'missing'} login.`);
    throw AppError.forbidden('login_unavailable', 'Online sign-in is not available for this record. Please call the clinic.');
  }

  const { data: link, error: linkError } = await requireAdmin().auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError) throw linkError;

  const { data, error } = await createAuthClient().auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  });
  if (error || !data.session) throw error ?? new Error('Supabase returned no session');
  return data.session;
}

/** Trades a refresh token for a fresh access token (when the old one expires after ~1 hour). */
export async function refreshSession(refreshToken) {
  const { data, error } = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    throw AppError.unauthorized('invalid_refresh_token', 'Your session has ended. Please sign in again.');
  }
  return data.session;
}

/** Ends this session on the server, so its refresh token stops working. */
export async function revokeSession(accessToken) {
  const { error } = await requireAdmin().auth.admin.signOut(accessToken, 'local');
  if (error) logger.warn(`Sign-out failed: ${error.message}`);
}
