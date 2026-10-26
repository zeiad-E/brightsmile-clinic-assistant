import * as reportService from '../../services/reportService.js';
import { ctxOf } from '../context.js';

/** Dashboard numbers (/api/staff/stats). */

export async function today(req, res) {
  res.json(await reportService.statsToday(ctxOf(req)));
}

export async function upcomingByDoctor(req, res) {
  res.json({ data: await reportService.upcomingByDoctor(ctxOf(req)) });
}

export async function aiOutcomes(req, res) {
  res.json({ data: await reportService.aiOutcomes(ctxOf(req)) });
}
