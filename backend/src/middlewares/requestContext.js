import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

/**
 * Gives every request an id and writes one log line when it finishes.
 *
 * The id is returned in the `x-request-id` header and in 500 error bodies, so a
 * user's error report can be matched to the exact server log line.
 *
 * Only the path is logged, never the query string: query strings can carry
 * search terms such as patient names or emails.
 */
const INCOMING_ID = /^[\w-]{8,64}$/;
const QUIET_PATHS = new Set(['/health']); // keep-warm pings every 10 min would flood the log

export function requestContext() {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && INCOMING_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('x-request-id', req.id);

    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      if (QUIET_PATHS.has(req.path)) return;
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info(`${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${ms.toFixed(0)}ms id=${req.id}`);
    });

    next();
  };
}
