import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';
import { serverClientOptions } from './supabase.js';

/**
 * Clients that use the public (anon) key — the database treats them as a normal visitor
 * or as the signed-in user, so Row Level Security, the masked views and the audit log
 * all apply. This is the "second wall" behind our own role checks.
 */
function requireAnonConfig() {
  if (!config.supabase.url || !config.supabase.anonKey) {
    throw new AppError(503, 'database_unavailable', 'The database is not configured.');
  }
}

/** Acts as the signed-in user: every query carries their access token (JWT). */
export function createUserClient(accessToken) {
  requireAnonConfig();
  return createClient(config.supabase.url, config.supabase.anonKey, {
    ...serverClientOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * A fresh, throwaway client for one sign-in call (password, email code, refresh).
 *
 * Why fresh: a sign-in stores the new session inside the client object. A shared client
 * could hand one user's session to another user's request. One form per patient,
 * never a shared clipboard.
 */
export function createAuthClient() {
  requireAnonConfig();
  return createClient(config.supabase.url, config.supabase.anonKey, serverClientOptions);
}

let shared = null;

/**
 * One long-lived anonymous client, used to verify access tokens and for public reads
 * (catalog, free slots) by visitors who aren't signed in.
 *
 * It never signs anyone in, so sharing it is safe. It also caches the project's public
 * signing keys (JWKS), so most token checks need no network call.
 */
export function anonClient() {
  requireAnonConfig();
  shared ??= createClient(config.supabase.url, config.supabase.anonKey, serverClientOptions);
  return shared;
}
