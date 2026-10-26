import { Router } from 'express';
import * as appointments from '../controllers/staff/staffAppointmentController.js';
import * as patients from '../controllers/staff/staffPatientController.js';
import * as escalations from '../controllers/staff/escalationController.js';
import * as timeOff from '../controllers/staff/timeOffController.js';
import * as stats from '../controllers/staff/statsController.js';
import * as conversations from '../controllers/staff/conversationController.js';
import { StaffConversationQuery } from '../validators/chat.js';
import { validate } from '../middlewares/validate.js';
import { requireRole } from '../middlewares/requireRole.js';
import { idempotencyKey } from '../middlewares/idempotencyKey.js';
import { ROLES } from '../utils/roles.js';
import { IdParams } from '../validators/common.js';
import { CancelBody, RescheduleBody } from '../validators/appointments.js';
import {
  EscalationQuery,
  PatientSearchQuery,
  PatientUpdateBody,
  StaffAppointmentsQuery,
  StaffBookBody,
  StatusBody,
  TimeOffBody,
  TimeOffPatch,
  TimeOffQuery,
} from '../validators/staff.js';

/**
 * /api/staff — the clinic's daily dashboard.
 * Reads: staff, owner and viewer (the viewer sees masked data). Writes: staff and owner.
 */
export function staffRouter(limits) {
  const router = Router();
  const read = requireRole(ROLES.STAFF_READ);
  const write = requireRole(ROLES.STAFF_WRITE);
  const id = validate({ params: IdParams });

  router.get('/appointments', read, validate({ query: StaffAppointmentsQuery }), appointments.list);
  router.get('/appointments/:id', read, id, appointments.get);
  router.post('/appointments', write, limits.booking, idempotencyKey(), validate({ body: StaffBookBody }), appointments.book);
  router.post('/appointments/:id/cancel', write, validate({ params: IdParams, body: CancelBody }), appointments.cancel);
  router.post('/appointments/:id/reschedule', write, validate({ params: IdParams, body: RescheduleBody }), appointments.reschedule);
  router.patch('/appointments/:id/status', write, validate({ params: IdParams, body: StatusBody }), appointments.setStatus);

  router.get('/patients', read, validate({ query: PatientSearchQuery }), patients.search);
  router.get('/patients/:id', read, id, patients.get);
  router.patch('/patients/:id', write, validate({ params: IdParams, body: PatientUpdateBody }), patients.update);
  router.post('/patients/:id/unlock', write, id, patients.unlock);
  router.post('/patients/:id/send-code', write, limits.auth, id, patients.sendCode);

  router.get('/escalations', read, validate({ query: EscalationQuery }), escalations.list);
  router.post('/escalations/:id/resolve', write, id, escalations.resolve);

  router.get('/time-off', read, validate({ query: TimeOffQuery }), timeOff.list);
  router.post('/time-off', write, validate({ body: TimeOffBody }), timeOff.create);
  router.patch('/time-off/:id', write, validate({ params: IdParams, body: TimeOffPatch }), timeOff.update);
  router.delete('/time-off/:id', write, id, timeOff.remove);

  router.get('/stats/today', read, stats.today);
  router.get('/stats/upcoming-by-doctor', read, stats.upcomingByDoctor);
  router.get('/stats/ai-outcomes', read, stats.aiOutcomes);

  router.get('/conversations', read, validate({ query: StaffConversationQuery }), conversations.list);
  router.get('/conversations/:id', read, id, conversations.get);

  return router;
}
