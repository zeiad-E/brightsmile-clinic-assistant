import * as reportService from '../../services/reportService.js';
import { ctxOf } from '../context.js';

/** Owner/viewer: who changed what (/api/admin/audit-log). */
export async function list(req, res) {
  res.json(await reportService.auditLog(ctxOf(req), req.valid.query));
}
