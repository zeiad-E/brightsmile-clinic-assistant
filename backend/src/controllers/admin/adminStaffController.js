import * as adminService from '../../services/adminService.js';
import * as scheduleService from '../../services/scheduleService.js';
import { ctxOf } from '../context.js';

/** Owner: doctors, their services and weekly hours (/api/admin/doctors). */

export async function list(req, res) {
  res.json({ data: await adminService.listDoctors(ctxOf(req)) });
}

export async function create(req, res) {
  res.status(201).json(await adminService.createDoctor(ctxOf(req), req.valid.body));
}

export async function update(req, res) {
  res.json(await adminService.updateDoctor(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function deactivate(req, res) {
  res.json(await adminService.deactivateDoctor(ctxOf(req), req.valid.params.id));
}

export async function setServices(req, res) {
  res.json(await scheduleService.replaceStaffServices(ctxOf(req), req.valid.params.id, req.valid.body.service_ids));
}

export async function setWorkingHours(req, res) {
  res.json(await scheduleService.replaceWorkingHours(ctxOf(req), req.valid.params.id, req.valid.body.hours));
}
