import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

/**
 * Server-side Supabase client (service role).
 * Used for DB access (Postgres + pgvector) and admin auth operations.
 */
export const supabase = config.supabase.url
  ? createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    })
  : null;
