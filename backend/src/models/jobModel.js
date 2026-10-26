import { unwrap } from './query.js';

/**
 * Background jobs, stored in Postgres so they survive a restart.
 * claim_jobs hands each due job to exactly one worker (SKIP LOCKED).
 */

export function enqueue(db, { type, payload = {}, runAt = new Date(), maxAttempts = 5 }) {
  return unwrap(
    db
      .from('jobs')
      .insert({ type, payload, run_at: runAt.toISOString(), max_attempts: maxAttempts })
      .select('id')
      .single(),
  );
}

/** One waiting job per (type, conversation): move it later instead of piling up duplicates. */
export async function enqueueOrDelay(db, { type, key, payload, runAt }) {
  const existing = await unwrap(
    db.from('jobs').select('id').eq('type', type).eq('status', 'queued').contains('payload', { key }).limit(1).maybeSingle(),
  );
  if (existing) {
    return unwrap(db.from('jobs').update({ run_at: runAt.toISOString(), payload: { ...payload, key } }).eq('id', existing.id));
  }
  return enqueue(db, { type, payload: { ...payload, key }, runAt });
}

export async function claim(db, limit = 5) {
  return (await unwrap(db.rpc('claim_jobs', { p_limit: limit }))) ?? [];
}

export function complete(db, id) {
  return unwrap(db.from('jobs').update({ status: 'done', last_error: null }).eq('id', id));
}

/** Failed: try again later (1, 4, 9… minutes), or give up after max_attempts. */
export function fail(db, job, error) {
  const giveUp = job.attempts >= job.max_attempts;
  const retryAt = new Date(Date.now() + job.attempts ** 2 * 60_000);
  return unwrap(
    db
      .from('jobs')
      .update({
        status: giveUp ? 'failed' : 'queued',
        run_at: giveUp ? job.run_at : retryAt.toISOString(),
        last_error: String(error).slice(0, 500),
        locked_at: null,
      })
      .eq('id', job.id),
  );
}

/** Jobs stuck in "running" (the server restarted mid-job) go back to the queue. */
export function releaseStale(db, olderThanMinutes = 10) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  return unwrap(db.from('jobs').update({ status: 'queued', locked_at: null }).eq('status', 'running').lt('locked_at', cutoff));
}
