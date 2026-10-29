import * as assistantReportService from '../../services/assistantReportService.js';
import { ctxOf } from '../context.js';

/** "The assistant got this wrong" reports (G4): staff create them, the owner works through them. */

export async function create(req, res) {
  res.status(201).json(await assistantReportService.create(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function list(req, res) {
  res.json(await assistantReportService.list(ctxOf(req), req.valid.query));
}

export async function resolve(req, res) {
  res.json(await assistantReportService.resolve(ctxOf(req), req.valid.params.id, req.valid.body));
}
