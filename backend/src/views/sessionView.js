/**
 * A sign-in result. The frontend keeps the access token (sent as "Bearer" on every
 * request, valid ~1 hour) and uses the refresh token to get a new one without asking
 * the user to sign in again.
 */
export function sessionView(session, user = null) {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: 'bearer',
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    user: user ?? (session.user ? { id: session.user.id, email: session.user.email } : null),
  };
}
