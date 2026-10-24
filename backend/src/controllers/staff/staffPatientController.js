import * as patientService from '../../services/patientService.js';
import { ctxOf } from '../context.js';

/** Staff patient screens (/api/staff/patients). */

export async function search(req, res) {
  res.json(await patientService.search(ctxOf(req), req.valid.query));
}

export async function get(req, res) {
  res.json(await patientService.getWithAppointments(ctxOf(req), req.valid.params.id));
}

export async function update(req, res) {
  res.json(await patientService.update(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function unlock(req, res) {
  res.json(await patientService.unlock(ctxOf(req), req.valid.params.id));
}

export async function sendCode(req, res) {
  res.json(await patientService.sendNewCode(ctxOf(req), req.valid.params.id));
}
