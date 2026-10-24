import { anonClient } from '../db/userClient.js';

/**
 * What every service call receives: who is asking, and the database client acting as them.
 * Visitors who aren't signed in get the shared anonymous client.
 */
export function ctxOf(req) {
  return { user: req.user, db: req.db ?? anonClient() };
}
