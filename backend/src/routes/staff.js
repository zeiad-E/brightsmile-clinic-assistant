import { Router } from 'express';
import * as appointments from '../controllers/staff/staffAppointmentController.js';
import * as patients from '../controllers/staff/staffPatientController.js';
import * as escalations from '../controllers/staff/escalationController.js';
import * as timeOff from '../controllers/staff/timeOffController.js';
import * as stats from '../controllers/staff/statsController.js';
import * as conversations from '../controllers/staff/conversationController.js';
import * as reports from '../controllers/staff/assistantReportController.js';
import { StaffConversationQuery } from '../validators/chat.js';
import { validate } from '../middlewares/validate.js';
import { PersonalCodeQuery } from '../validators/me.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { idempotencyKey } from '../middlewares/idempotencyKey.js';
import { IdParams } from '../validators/common.js';
import { CancelBody, RescheduleBody } from '../validators/appointments.js';
import {
  EscalationQuery,
  PatientCreateBody,
  PatientSearchQuery,
  PatientUpdateBody,
  ReportBody,
  ReviewBody,
  StaffAppointmentsQuery,
  StaffBookBody,
  StaffReplyBody,
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
  const id = validate({ params: IdParams });

  router.get('/appointments', requirePermission('appointments.read'), validate({ query: StaffAppointmentsQuery }), appointments.list);
  router.get('/appointments/:id', requirePermission('appointments.read'), id, appointments.get);
  router.post('/appointments', requirePermission('appointments.write'), limits.booking, idempotencyKey(), validate({ body: StaffBookBody }), appointments.book);
  router.post('/appointments/:id/cancel', requirePermission('appointments.write'), validate({ params: IdParams, body: CancelBody }), appointments.cancel);
  router.post('/appointments/:id/reschedule', requirePermission('appointments.write'), validate({ params: IdParams, body: RescheduleBody }), appointments.reschedule);
  router.patch('/appointments/:id/status', requirePermission('appointments.write'), validate({ params: IdParams, body: StatusBody }), appointments.setStatus);

  router.get('/patients', requirePermission('patients.read'), validate({ query: PatientSearchQuery }), patients.search);
  router.post('/patients', requirePermission('patients.write'), validate({ body: PatientCreateBody }), patients.create);
  router.get('/patients/:id', requirePermission('patients.read'), id, patients.get);
  router.patch('/patients/:id', requirePermission('patients.write'), validate({ params: IdParams, body: PatientUpdateBody }), patients.update);
  router.post('/patients/:id/unlock', requirePermission('patients.login.manage'), id, patients.unlock);
  router.post('/patients/:id/send-code', requirePermission('patients.login.manage'), limits.auth, id, patients.sendCode);
  router.get('/patients/:id/personal-code', requirePermission('patients.code.view'), validate({ params: IdParams, query: PersonalCodeQuery }), patients.personalCode);
  router.post('/patients/:id/personal-code', requirePermission('patients.code.regenerate'), limits.auth, id, patients.newPersonalCode);

  router.get('/escalations', requirePermission('escalations.read'), validate({ query: EscalationQuery }), escalations.list);
  router.post('/escalations/:id/resolve', requirePermission('escalations.resolve'), id, escalations.resolve);

  router.get('/time-off', requirePermission('time_off.read'), validate({ query: TimeOffQuery }), timeOff.list);
  router.post('/time-off', requirePermission('time_off.write'), validate({ body: TimeOffBody }), timeOff.create);
  router.patch('/time-off/:id', requirePermission('time_off.write'), validate({ params: IdParams, body: TimeOffPatch }), timeOff.update);
  router.delete('/time-off/:id', requirePermission('time_off.write'), id, timeOff.remove);

  router.get('/stats/today', requirePermission('stats.read'), stats.today);
  router.get('/stats/upcoming-by-doctor', requirePermission('stats.read'), stats.upcomingByDoctor);
  router.get('/stats/ai-outcomes', requirePermission('stats.read'), stats.aiOutcomes);

  router.get('/conversations', requirePermission('conversations.read'), validate({ query: StaffConversationQuery }), conversations.list);
  router.get('/conversations/:id', requirePermission('conversations.read'), id, conversations.get);
  // The team in the patient's chat (G1), review (G2), "the assistant got this wrong" (G4).
  router.post('/conversations/:id/take-over', requirePermission('conversations.respond'), id, conversations.takeOver);
  router.post('/conversations/:id/hand-back', requirePermission('conversations.respond'), id, conversations.handBack);
  router.post('/conversations/:id/messages', requirePermission('conversations.respond'), validate({ params: IdParams, body: StaffReplyBody }), conversations.reply);
  router.post('/conversations/:id/review', requirePermission('conversations.respond'), validate({ params: IdParams, body: ReviewBody }), conversations.review);
  router.post('/conversations/:id/reports', requirePermission('assistant_reports.create'), validate({ params: IdParams, body: ReportBody }), reports.create);
  // The owner deletes a chat for good (its messages, reports and traces go with it).
  router.delete('/conversations/:id', requirePermission('conversations.delete'), id, conversations.remove);

  return router;
}
