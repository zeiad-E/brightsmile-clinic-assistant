import { capacityStatus } from '../../services/capacity/index.js';

/**
 * Owner/viewer: live health of the assistant (/api/admin/agent/status) — turns in progress
 * and waiting, whether the AI circuit breaker is open, and today's token budget use.
 */
export function status(_req, res) {
  res.json(capacityStatus());
}
