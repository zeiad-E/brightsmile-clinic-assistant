import { registerJob, registerRecurringJob } from './jobRunner.js';
import * as memoryService from '../memoryService.js';
import * as reminderService from '../reminderService.js';
import * as retentionService from '../retentionService.js';
import * as waitlistService from '../waitlistService.js';
import { ingestJob } from '../knowledge/knowledgeService.js';
import { clinicBranding } from '../catalogService.js';
import { CLINIC_TIMEZONE, nextClockTime } from '../../utils/clinicTime.js';

const inMinutes = (minutes) => (now) => new Date(now.getTime() + minutes * 60_000);

async function nextNightlyRun(now) {
  const timeZone = (await clinicBranding().catch(() => null))?.timeZone ?? CLINIC_TIMEZONE;
  return nextClockTime(retentionService.NIGHTLY_CLEANUP_TIME, now, timeZone);
}

/** Every background job type and the function that runs it. */
export function registerJobHandlers() {
  registerJob('summarize_conversation', memoryService.summarizeOlderMessages);
  registerJob('finalize_conversation', memoryService.finalizeConversation);
  registerJob('consolidate_memories', memoryService.consolidateMemories);
  registerJob('ingest_knowledge', ingestJob);
  registerJob('send_reminder', reminderService.sendReminder);
  registerJob('waitlist_slot_opened', waitlistService.notifyOpening);

  registerRecurringJob('queue_reminders', reminderService.queueDueReminders, inMinutes(reminderService.REMINDER_SWEEP_MINUTES));
  registerRecurringJob('nightly_cleanup', retentionService.nightlyCleanup, nextNightlyRun);
}
