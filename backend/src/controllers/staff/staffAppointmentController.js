import * as appointmentService from '../../services/appointmentService.js';
import * as bookingService from '../../services/bookingService.js';
import { ctxOf } from '../context.js';

/** Staff dashboard bookings (/api/staff/appointments). */

export async function list(req, res) {
  res.json(await appointmentService.listForStaff(ctxOf(req), req.valid.query));
}

export async function get(req, res) {
  res.json(await appointmentService.getForStaff(ctxOf(req), req.valid.params.id));
}

export async function book(req, res) {
  const { status, body } = await bookingService.bookAsStaff(ctxOf(req), req.valid.body, req.idempotencyKey);
  res.status(status).json(body);
}

export async function cancel(req, res) {
  res.json(await appointmentService.cancel(ctxOf(req), req.valid.params.id, req.valid.body.reason));
}

export async function reschedule(req, res) {
  res.json(await appointmentService.reschedule(ctxOf(req), req.valid.params.id, req.valid.body));
}

export async function setStatus(req, res) {
  res.json(await appointmentService.setStatus(ctxOf(req), req.valid.params.id, req.valid.body.status));
}
