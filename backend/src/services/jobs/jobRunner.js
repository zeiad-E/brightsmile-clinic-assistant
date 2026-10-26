import { supabaseAdmin } from '../../db/supabase.js';
import * as jobModel from '../../models/jobModel.js';
import { logger } from '../../utils/logger.js';

/**
 * A small worker inside the server: every 30 s it takes due jobs from the jobs table and runs
 * them (summaries, memory clean-up; later reminders and waitlist emails).
 *
 * Why a table and not memory: a restart (Render redeploys, free-tier sleep) would lose
 * in-memory work. In Postgres, unfinished jobs simply run after the restart.
 */
const handlers = new Map();

export function registerJob(type, handler) {
  handlers.set(type, handler);
}

/** Runs every due job once. Exported so tests (and a manual trigger) can call it directly. */
export async function processDueJobs(db = supabaseAdmin, limit = 5) {
  const jobs = await jobModel.claim(db, limit);
  for (const job of jobs) {
    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(job.payload, job);
      await jobModel.complete(db, job.id);
    } catch (err) {
      logger.warn(`Job ${job.id} (${job.type}) failed: ${err.message}`);
      await jobModel.fail(db, job, err.message).catch(() => {});
    }
  }
  return jobs.length;
}

let timer = null;
let running = false;

export function startJobRunner({ intervalMs = 30_000 } = {}) {
  if (!supabaseAdmin || timer) return;
  jobModel.releaseStale(supabaseAdmin).catch((err) => logger.warn(`Could not release stale jobs: ${err.message}`));
  timer = setInterval(async () => {
    if (running) return; // never overlap two passes
    running = true;
    try {
      await processDueJobs();
    } catch (err) {
      logger.warn(`Job runner pass failed: ${err.message}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  logger.info('Background job runner started');
}

export function stopJobRunner() {
  clearInterval(timer);
  timer = null;
}
