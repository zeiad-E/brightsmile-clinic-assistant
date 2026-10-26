import { unwrap } from './query.js';

/** Database functions used by the scheduled jobs (service role only). */

/** Marks bookings due a reminder and queues one send_reminder job each; returns how many. */
export function queueDueReminders(db, { skipEmailDomain, limit = 100 }) {
  return unwrap(db.rpc('queue_due_reminders', { p_skip_email_domain: skipEmailDomain, p_limit: limit }));
}

/** Deletes chats past the clinic's retention period (not those with an open escalation). */
export function purgeExpiredConversations(db, limit = 500) {
  return unwrap(db.rpc('purge_expired_conversations', { p_limit: limit }));
}
