import { ACCESS_TOKEN_SECONDS } from '../auth/tokens.js';

/**
 * A sign-in result. The frontend keeps the access token in memory and sends it as "Bearer" on
 * every request. The refresh token never appears here: it travels only in an httpOnly cookie.
 */
export function sessionView({ token, expiresAt }, profile) {
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_SECONDS,
    expires_at: expiresAt,
    user: {
      id: profile.id,
      role: profile.role,
      full_name: profile.full_name ?? null,
      must_change_password: Boolean(profile.must_change_password),
    },
  };
}
