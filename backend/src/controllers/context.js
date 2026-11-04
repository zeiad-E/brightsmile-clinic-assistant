import { publicDb } from '../db/supabase.js';

/**
 * What every service call receives: who is asking, and the database client for them.
 * Visitors who aren't signed in get the public client.
 */
export function ctxOf(req) {
  return { user: req.user, db: req.db ?? publicDb() };
}
