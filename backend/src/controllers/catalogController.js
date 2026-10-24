import * as catalogService from '../services/catalogService.js';
import { ctxOf } from './context.js';

/** Public catalog (/api/clinic, /api/services, /api/doctors). No sign-in needed. */

export async function clinic(req, res) {
  res.json(await catalogService.clinicInfo(ctxOf(req).db));
}

export async function services(req, res) {
  res.json({ data: await catalogService.listServices(ctxOf(req).db) });
}

export async function service(req, res) {
  res.json(await catalogService.getService(ctxOf(req).db, req.valid.params.idOrSlug));
}

export async function doctors(req, res) {
  res.json({ data: await catalogService.listDoctors(ctxOf(req).db) });
}

export async function doctor(req, res) {
  res.json(await catalogService.getDoctor(ctxOf(req).db, req.valid.params.id));
}
