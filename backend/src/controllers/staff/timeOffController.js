import * as scheduleService from '../../services/scheduleService.js';
import { ctxOf } from '../context.js';

/** Time off and clinic closures (/api/staff/time-off). */

export async function list(req, res) {
  res.json(await scheduleService.listTimeOff(ctxOf(req), req.valid.query));
}

export async function create(req, res) {
  res.status(201).json(await scheduleService.createTimeOff(ctxOf(req), req.valid.body));
}

export async function update(req, res) {
  res.json(await scheduleService.updateTimeOff(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function remove(req, res) {
  await scheduleService.removeTimeOff(ctxOf(req), req.valid.params.id);
  res.status(204).end();
}
