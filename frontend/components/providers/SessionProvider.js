'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '@/lib/api/client';
import { dropOldSession, isExpiring, rememberSignedIn, wasSignedIn, watchOtherTabs } from '@/lib/auth/sessionStore';

/**
 * Who is signed in, shared with every component through React context.
 *
 *   const { status, user, signIn, signInWithTicket, signOut, api, refreshUser } = useSession();
 *   status: 'loading' | 'signed-out' | 'signed-in'
 *   user:   GET /api/auth/me → { role: 'patient' | 'staff' | 'owner' | 'viewer', permissions, full_name, … }
 *   api:    apiRequest that adds the token, renews it when it's about to expire, and retries once on 401.
 *
 * The access token lives only in memory here. When it runs out (every 15 minutes) a call to
 * /auth/refresh gets a new one, and the browser sends the refresh cookie by itself.
 *
 * The real lock is on the backend (it checks the token and the permission on every request).
 * The frontend only uses this to decide what to show.
 */
const SessionContext = createContext(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>.');
  return value;
}

/** Only one tab refreshes at a time, so tabs don't trip over each other's new cookie. */
function oneTabAtATime(work) {
  return navigator.locks ? navigator.locks.request('brightsmile-auth-refresh', work) : work();
}

/** Two tabs can still cross. The loser is told `refresh_superseded`: the winner's cookie is good, so ask again. */
async function requestFreshSession() {
  try {
    return await oneTabAtATime(() => apiRequest('/auth/refresh', { method: 'POST' }));
  } catch (err) {
    if (err.code !== 'refresh_superseded') throw err;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return oneTabAtATime(() => apiRequest('/auth/refresh', { method: 'POST' }));
  }
}

export default function SessionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });
  const sessionRef = useRef(null); // { access_token, expires_at }: memory only
  const refreshing = useRef(null); // one shared refresh, even if many requests need it at once

  const forget = useCallback(() => {
    sessionRef.current = null;
    rememberSignedIn(false);
    setState({ status: 'signed-out', user: null });
  }, []);

  const keep = useCallback((session) => {
    sessionRef.current = session;
    rememberSignedIn(true);
  }, []);

  /** A valid access token, renewed first if needed. null when signed out. */
  const getToken = useCallback(
    async ({ force = false } = {}) => {
      const session = sessionRef.current;
      if (!session && !wasSignedIn()) return null;
      if (!force && session && !isExpiring(session)) return session.access_token;

      refreshing.current ??= requestFreshSession()
        .then((fresh) => {
          keep(fresh);
          return fresh.access_token;
        })
        .catch((err) => {
          // A refused refresh means the session is over; a network blip doesn't.
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) forget();
          throw err;
        })
        .finally(() => {
          refreshing.current = null;
        });
      return refreshing.current;
    },
    [forget, keep],
  );

  const api = useCallback(
    async (path, options = {}) => {
      const token = await getToken();
      try {
        return await apiRequest(path, { ...options, token });
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401 || !token) throw err;
        return apiRequest(path, { ...options, token: await getToken({ force: true }) });
      }
    },
    [getToken],
  );

  const loadUser = useCallback(async () => {
    try {
      const user = await api('/auth/me');
      setState({ status: 'signed-in', user });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) forget();
      else setState((current) => (current.user ? current : { status: 'signed-out', user: null }));
    }
  }, [api, forget]);

  /** Call with the session any sign-in endpoint returns. The API has already set the refresh cookie. */
  const signIn = useCallback(
    async (session) => {
      keep(session);
      await loadUser();
    },
    [keep, loadUser],
  );

  /** The chat can't set a cookie, so it gives us a one-time ticket to swap for the session. */
  const signInWithTicket = useCallback(
    async (ticket) => {
      await signIn(await apiRequest('/auth/ticket', { method: 'POST', body: { ticket } }));
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    const token = sessionRef.current?.access_token;
    forget();
    await apiRequest('/auth/logout', { method: 'POST', token }).catch(() => {});
  }, [forget]);

  // On first load: pick up the session if there is one, then follow sign-ins/outs from other tabs.
  useEffect(() => {
    dropOldSession();
    queueMicrotask(() => (wasSignedIn() ? loadUser() : setState({ status: 'signed-out', user: null })));

    return watchOtherTabs((signedIn) => {
      sessionRef.current = null;
      if (signedIn) loadUser();
      else setState({ status: 'signed-out', user: null });
    });
  }, [loadUser]);

  // refreshUser(): reload /auth/me, e.g. after someone edits their own name on their profile page.
  const value = useMemo(
    () => ({ ...state, signIn, signInWithTicket, signOut, api, getToken, refreshUser: loadUser }),
    [state, signIn, signInWithTicket, signOut, api, getToken, loadUser],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}
