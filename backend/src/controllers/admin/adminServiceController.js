import * as adminService from '../../services/adminService.js';
import { ctxOf } from '../context.js';

/** Owner: treatments and prices (/api/admin/services). */

export async function list(req, res) {
  res.json({ data: await adminService.listServices(ctxOf(req)) });
}

export async function create(req, res) {
  res.status(201).json(await adminService.createService(ctxOf(req), req.valid.body));
}

export async function update(req, res) {
  res.json(await adminService.updateService(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function deactivate(req, res) {
  res.json(await adminService.deactivateService(ctxOf(req), req.valid.params.id));
}
