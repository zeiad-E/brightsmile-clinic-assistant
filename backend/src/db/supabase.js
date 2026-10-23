import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config } from '../config/index.js';

/**
 * Server-side Supabase client (service role).
 * Used for DB access (Postgres + pgvector) and admin auth operations.
 *
 * The container runs Node 20 (shared with the LLM engine), which has no built-in
 * WebSocket; supabase-js requires one for its realtime client, so pass `ws` explicitly.
 */
export const supabase = config.supabase.url
  ? createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false },
      realtime: { transport: WebSocket },
    })
  : null;
