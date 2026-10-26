import { supabaseAdmin } from '../../db/supabase.js';
import * as jobModel from '../../models/jobModel.js';
import { logger } from '../../utils/logger.js';

/**
 * A small worker inside the server: every 30 s it takes due jobs from the jobs table and runs
 * them (summaries, memory clean-up, reminders, waitlist emails, the nightly clean-up).
 *
 * Why a table and not memory: a restart (Render redeploys, free-tier sleep) would lose
 * in-memory work. In Postgres, unfinished jobs simply run after the restart.
 *
 * Recurring jobs (the reminder sweep, the nightly clean-up) are ordinary rows too: when one
 * finishes, the runner queues the next run. A unique index keeps one waiting copy per type.
 */
const handlers = new Map();
const recurring = new Map(); // type → (now) => Date of the next run

export function registerJob(type, handler) {
  handlers.set(type, handler);
}

/** A job that repeats: `nextRunAt(now)` says when the next run is due (may be async). */
export function registerRecurringJob(type, handler, nextRunAt) {
  handlers.set(type, handler);
  recurring.set(type, nextRunAt);
}

async function scheduleNext(db, type) {
  try {
    await jobModel.ensureRecurring(db, { type, runAt: await recurring.get(type)(new Date()) });
  } catch (err) {
    logger.warn(`Could not schedule the next ${type} run: ${err.message}`);
  }
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
    // A failed run that will be retried is still waiting, so this adds nothing then.
    if (recurring.has(job.type)) await scheduleNext(db, job.type);
  }
  return jobs.length;
}

/**
 * Hourly safety net: jobs stuck in "running" after a crash go back to the queue, and every
 * recurring job is scheduled (in case a database hiccup broke its chain).
 */
export async function maintainJobs(db = supabaseAdmin) {
  await jobModel.releaseStale(db).catch((err) => logger.warn(`Could not release stale jobs: ${err.message}`));
  for (const type of recurring.keys()) await scheduleNext(db, type);
}

const MAINTENANCE_EVERY_MS = 60 * 60_000;
let timer = null;
let running = false;
let lastMaintenance = 0;

export function startJobRunner({ intervalMs = 30_000 } = {}) {
  if (!supabaseAdmin || timer) return;
  timer = setInterval(async () => {
    if (running) return; // never overlap two passes
    running = true;
    try {
      if (Date.now() - lastMaintenance >= MAINTENANCE_EVERY_MS) {
        lastMaintenance = Date.now();
        await maintainJobs();
      }
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
