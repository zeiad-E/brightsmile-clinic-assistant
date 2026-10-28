'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '@/lib/api/client';
import { clearSession, isExpiring, readSession, watchOtherTabs, writeSession } from '@/lib/auth/sessionStore';

/**
 * Who is signed in, shared with every component through React context.
 *
 *   const { status, user, signIn, signOut, api } = useSession();
 *   status: 'loading' | 'signed-out' | 'signed-in'
 *   user:   GET /api/auth/me → { role: 'patient' | 'staff' | 'owner' | 'viewer', full_name, … }
 *   api:    apiRequest that adds the token, renews it when it's about to expire, and retries once on 401.
 *
 * The real lock is on the backend (it checks the token and the database rules on every request).
 * The frontend only uses this to decide what to show.
 */
const SessionContext = createContext(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>.');
  return value;
}

export default function SessionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });
  const sessionRef = useRef(null);
  const refreshing = useRef(null); // one shared refresh, even if many requests need it at once

  const forget = useCallback(() => {
    sessionRef.current = null;
    clearSession();
    setState({ status: 'signed-out', user: null });
  }, []);

  const keep = useCallback((session) => {
    sessionRef.current = session;
    writeSession(session);
  }, []);

  /** A valid access token, renewed first if needed. null when signed out. */
  const getToken = useCallback(
    async ({ force = false } = {}) => {
      const session = sessionRef.current;
      if (!session) return null;
      if (!force && !isExpiring(session)) return session.access_token;

      refreshing.current ??= apiRequest('/auth/refresh', { method: 'POST', body: { refresh_token: session.refresh_token } })
        .then((fresh) => {
          keep(fresh);
          return fresh.access_token;
        })
        .catch((err) => {
          // A rejected refresh token means the session is over; a network blip doesn't.
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

  /** Call with the session object any sign-in endpoint (or the chat assistant) returns. */
  const signIn = useCallback(
    async (session) => {
      keep(session);
      await loadUser();
    },
    [keep, loadUser],
  );

  const signOut = useCallback(async () => {
    const token = sessionRef.current?.access_token;
    forget();
    if (token) await apiRequest('/auth/logout', { method: 'POST', token }).catch(() => {});
  }, [forget]);

  // On first load: pick up a saved session, then follow sign-ins/outs from other tabs.
  useEffect(() => {
    sessionRef.current = readSession();
    if (sessionRef.current) loadUser();
    else setState({ status: 'signed-out', user: null });

    return watchOtherTabs((session) => {
      sessionRef.current = session;
      if (session) loadUser();
      else setState({ status: 'signed-out', user: null });
    });
  }, [loadUser]);

  const value = useMemo(() => ({ ...state, signIn, signOut, api, getToken }), [state, signIn, signOut, api, getToken]);
  return <SessionContext value={value}>{children}</SessionContext>;
}
