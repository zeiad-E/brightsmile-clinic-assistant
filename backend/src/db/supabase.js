import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config } from '../config/index.js';
import { can } from '../auth/permissions.js';
import { AppError } from '../utils/AppError.js';

/**
 * Server-side Supabase clients that use the service role key.
 *
 * The database stores data; it doesn't know who is asking. So the service role skips Row Level
 * Security, and who may do what is decided here in the backend: route guards, ownership checks
 * in the services, and the personal-data switch below.
 *
 * `db.piiAccess`: may this client read personal data? Only a client marked `true` gets the plain
 * views; any other gets the masked twins (see `viewName` in models/query.js). System work is
 * marked true; each request's client depends on the caller.
 *
 * The container runs Node 20 (shared with the LLM engine), which has no built-in
 * WebSocket; supabase-js requires one for its realtime client, so pass `ws` explicitly.
 */
export const serverClientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { transport: WebSocket },
};

export const supabaseAdmin = config.supabase.url
  ? createClient(config.supabase.url, config.supabase.serviceRoleKey, serverClientOptions)
  : null;
if (supabaseAdmin) supabaseAdmin.piiAccess = true;

// Old name, still imported by the chatbot code (agent/, rag/) until Part 2 rewires it.
export const supabase = supabaseAdmin;

/** The admin client, or a clear 503 when the database isn't configured (e.g. local tests). */
export function requireAdmin() {
  if (!supabaseAdmin) throw new AppError(503, 'database_unavailable', 'The database is not configured.');
  return supabaseAdmin;
}

/**
 * An admin client that tells the audit log who the change is for.
 *
 * Writes made with the service role have no logged-in user, so the audit trigger reads
 * the `x-actor-id` / `x-change-via` headers instead (see the audit migration).
 * via: 'dashboard' | 'staff_assistant' | 'patient_assistant' | 'system'
 */
export function adminAs(actorId, via = 'dashboard') {
  requireAdmin();
  const headers = { 'x-change-via': via };
  if (actorId) headers['x-actor-id'] = actorId;
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    ...serverClientOptions,
    global: { headers },
  });
}

/** The database client for one signed-in caller: writes are audited as them. */
export function dbFor(user, via = 'dashboard') {
  const db = adminAs(user.id, via);
  db.piiAccess = can(user, 'pii.read');
  return db;
}

let visitorClient = null;

/** For visitors who aren't signed in: public reads only, and never personal data. */
export function publicDb() {
  requireAdmin();
  visitorClient ??= createClient(config.supabase.url, config.supabase.serviceRoleKey, serverClientOptions);
  return visitorClient;
}
