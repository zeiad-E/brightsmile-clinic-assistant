import { capacityStatus } from '../../services/capacity/index.js';

/**
 * Owner/viewer: live health of the assistant (/api/admin/agent/status) — turns in progress
 * and waiting, whether the AI circuit breaker is open, and today's token budget use.
 * `your_ip` is how the server sees the caller — a quick check that per-visitor limits work.
 */
export function status(req, res) {
  res.json({ ...capacityStatus(), your_ip: req.ip });
}
