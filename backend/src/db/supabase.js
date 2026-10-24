import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';

/**
 * Server-side Supabase clients that use the service role key.
 *
 * The service role SKIPS Row Level Security, so these clients are only for privileged
 * work the user's own token cannot do (booking RPC, sign-in checks, Auth admin API,
 * writing notifications). Every route that reaches them is guarded by requireRole.
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
