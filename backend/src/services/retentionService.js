import { requireAdmin } from '../db/supabase.js';
import * as jobModel from '../models/jobModel.js';
import * as maintenanceModel from '../models/maintenanceModel.js';
import * as waitlistModel from '../models/waitlistModel.js';
import { dayInZone } from '../utils/clinicTime.js';
import { logger } from '../utils/logger.js';
import { clinicBranding } from './catalogService.js';

/**
 * The nightly clean-up (03:00 clinic time, when nobody is chatting):
 *  - chats older than clinic_settings.chat_retention_days are deleted, with their messages,
 *    unless an escalation on them is still open (privacy: keep personal chats no longer
 *    than needed);
 *  - waitlist wishes whose last day has passed are closed as 'expired';
 *  - finished background jobs are cleared out.
 *
 * Agent run statistics stay: they hold no personal data and feed the owner's reports.
 */

export const NIGHTLY_CLEANUP_TIME = '03:00';
const PURGE_BATCH = 500;
const MAX_BATCHES = 20; // 10,000 chats a night is plenty; anything left goes the next night

export async function nightlyCleanup() {
  const db = requireAdmin();
  const brand = await clinicBranding();

  let chats = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const deleted = await maintenanceModel.purgeExpiredConversations(db, PURGE_BATCH);
    chats += deleted;
    if (deleted < PURGE_BATCH) break;
  }
  const waitlist = await waitlistModel.expirePast(db, dayInZone(new Date(), brand.timeZone));
  const jobs = await jobModel.deleteFinished(db);

  logger.info(`Nightly clean-up: ${chats} old chat(s) deleted, ${waitlist} waitlist wish(es) expired, ${jobs} old job(s) cleared`);
  return { chats, waitlist, jobs };
}
