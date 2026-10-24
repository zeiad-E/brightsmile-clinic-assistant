import * as appointmentService from '../services/appointmentService.js';
import * as patientService from '../services/patientService.js';
import { ctxOf } from './context.js';

/** The signed-in patient's own profile and bookings (/api/me). */

export async function profile(req, res) {
  res.json(await patientService.myProfile(ctxOf(req)));
}

export async function updateProfile(req, res) {
  res.json(await patientService.updateMyLanguage(ctxOf(req), req.valid.body));
}

export async function appointments(req, res) {
  res.json(await appointmentService.listMine(ctxOf(req), req.valid.query));
}

export async function appointment(req, res) {
  res.json(await appointmentService.getMine(ctxOf(req), req.valid.params.id));
}

export async function cancel(req, res) {
  res.json(await appointmentService.cancel(ctxOf(req), req.valid.params.id, req.valid.body.reason));
}

export async function reschedule(req, res) {
  res.json(await appointmentService.reschedule(ctxOf(req), req.valid.params.id, req.valid.body));
}
