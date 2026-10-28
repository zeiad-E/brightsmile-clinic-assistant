/**
 * Keeps the sign-in session in the browser's localStorage, so a reload doesn't sign you out.
 * Browser-only (localStorage doesn't exist on the server).
 *
 * A session (from the API) = { access_token, refresh_token, expires_at, user }:
 *   access_token  → sent as "Authorization: Bearer …" on every request; lasts ~1 hour
 *   refresh_token → swapped for a fresh session when the access token is about to expire
 */
const KEY = 'brightsmile.session';

export function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(KEY));
    return session?.access_token && session?.refresh_token ? session : null;
  } catch {
    return null;
  }
}

export function writeSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Private mode or storage full: the session still works until the tab closes.
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/** True when the access token has expired or will within `marginSeconds`. */
export function isExpiring(session, marginSeconds = 60) {
  if (!session?.expires_at) return true;
  return session.expires_at * 1000 - Date.now() < marginSeconds * 1000;
}

/** Fires `onChange` when another tab signs in or out. Returns a function that stops listening. */
export function watchOtherTabs(onChange) {
  const listener = (event) => {
    if (event.key === KEY) onChange(readSession());
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
