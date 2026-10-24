import * as reportService from '../../services/reportService.js';
import { ctxOf } from '../context.js';

/** Owner/viewer: emails the system sent (/api/admin/notifications). */
export async function list(req, res) {
  res.json(await reportService.notifications(ctxOf(req), req.valid.query));
}
