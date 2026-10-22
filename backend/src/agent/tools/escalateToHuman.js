import { createEscalation } from '../../services/escalations.js';
import { triggerEscalationAutomation } from '../../services/automation.js';

/** Create an escalation record and notify staff (optional automation). */
export async function escalateToHuman({ reason, urgency }, context = {}) {
  const escalation = await createEscalation({
    reason,
    urgency,
    conversation_id: context.conversationId ?? null,
  });

  triggerEscalationAutomation(escalation).catch(() => {});

  return { escalated: true, urgency, id: escalation.id };
}
