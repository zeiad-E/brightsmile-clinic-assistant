import { capacityStatus } from '../../services/capacity/index.js';

/**
 * Owner/viewer: live health of the assistant (/api/admin/agent/status) — turns in progress
 * and waiting, whether the AI circuit breaker is open, and today's token budget use.
 * `request` shows how the server sees the caller's address (to verify per-person limits).
 */
export function status(req, res) {
  res.json({
    ...capacityStatus(),
    request: {
      ip: req.ip,
      forwarded_for: req.get('x-forwarded-for') ?? null,
      cf_connecting_ip: req.get('cf-connecting-ip') ?? null,
      true_client_ip: req.get('true-client-ip') ?? null,
    },
  });
}
