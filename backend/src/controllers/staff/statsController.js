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

/** The owner's numbers for a period (/api/admin/stats?from&to). */
export async function range(req, res) {
  res.json(await reportService.rangeStats(ctxOf(req), req.valid.query));
}

/** What the assistant did (/api/admin/agent/activity). */
export async function activity(req, res) {
  res.json(await reportService.assistantActivity(ctxOf(req), req.valid.query));
}
