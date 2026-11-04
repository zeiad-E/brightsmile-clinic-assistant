/**
 * What the browser remembers about signing in: only a "signed in" flag.
 *
 * The real sign-in lives in two places, neither of them here:
 *   - the access token stays in memory (SessionProvider), so it's gone when the tab closes;
 *   - the refresh token sits in an httpOnly cookie that JavaScript can't read at all, so a script
 *     injected into a page can't steal it.
 *
 * The flag only saves a pointless refresh call for visitors who were never signed in, and tells
 * other tabs when someone signs in or out. It proves nothing and opens nothing.
 * Browser-only (localStorage doesn't exist on the server).
 */
const FLAG = 'brightsmile.signedIn';
const OLD_SESSION = 'brightsmile.session'; // from before sign-in moved to the backend; held tokens

export function dropOldSession() {
  try {
    localStorage.removeItem(OLD_SESSION);
  } catch {
    // nothing to clear
  }
}

export function wasSignedIn() {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

export function rememberSignedIn(signedIn) {
  try {
    if (signedIn) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    // Private mode or storage full: this tab still works.
  }
}

/** True when the access token has expired or will within `marginSeconds`. */
export function isExpiring(session, marginSeconds = 60) {
  if (!session?.expires_at) return true;
  return session.expires_at * 1000 - Date.now() < marginSeconds * 1000;
}

/** Fires `onChange(signedIn)` when another tab signs in or out. Returns a function that stops listening. */
export function watchOtherTabs(onChange) {
  const listener = (event) => {
    if (event.key === FLAG) onChange(event.newValue === '1');
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
