import * as adminService from '../../services/adminService.js';
import { ctxOf } from '../context.js';

/** Owner: clinic name, contact details and booking rules (/api/admin/settings). */

export async function get(req, res) {
  res.json(await adminService.getSettings(ctxOf(req)));
}

export async function update(req, res) {
  res.json(await adminService.updateSettings(ctxOf(req), req.valid.body));
}
