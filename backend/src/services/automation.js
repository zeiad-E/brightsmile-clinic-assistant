import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Optional n8n automation (FR-14..16). Fire-and-log: never blocks the chat reply.
 * If no webhook is configured, these are no-ops.
 */

async function postWebhook(url, payload) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logger.warn(`Automation webhook failed: ${err.message}`);
  }
}

export async function triggerBookingAutomation(appointment) {
  return postWebhook(config.automation.bookingWebhook, { type: 'booking', appointment });
}

export async function triggerEscalationAutomation(escalation) {
  return postWebhook(config.automation.escalationWebhook, { type: 'escalation', escalation });
}
