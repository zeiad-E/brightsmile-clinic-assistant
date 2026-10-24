import * as availabilityService from '../services/availabilityService.js';
import { ctxOf } from './context.js';

/** Free times (/api/availability). No sign-in needed. */

export async function day(req, res) {
  const { service_id: serviceId, staff_id: staffId, date } = req.valid.query;
  res.json(await availabilityService.forDay(ctxOf(req).db, { serviceId, staffId, day: date }));
}

export async function range(req, res) {
  const { service_id: serviceId, staff_id: staffId, from, days } = req.valid.query;
  res.json(await availabilityService.forRange(ctxOf(req).db, { serviceId, staffId, from, days }));
}
