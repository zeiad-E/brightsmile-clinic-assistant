import { Router } from 'express';
import * as me from '../controllers/meController.js';
import * as chat from '../controllers/chatController.js';
import { ConversationListQuery } from '../validators/chat.js';
import { validate } from '../middlewares/validate.js';
import { requireRole } from '../middlewares/requireRole.js';
import { ROLES } from '../utils/roles.js';
import { IdParams } from '../validators/common.js';
import { CancelBody, MyAppointmentsQuery, RescheduleBody } from '../validators/appointments.js';
import { ContactStartBody, ContactVerifyBody, UpdateMeBody } from '../validators/me.js';

/** /api/me — the signed-in patient's own profile and bookings. */
export function meRouter(limits) {
  const router = Router();
  router.use(requireRole(ROLES.PATIENT));

  router.get('/', me.profile);
  router.patch('/', validate({ body: UpdateMeBody }), me.updateProfile);
  router.get('/appointments', validate({ query: MyAppointmentsQuery }), me.appointments);
  router.get('/appointments/:id', validate({ params: IdParams }), me.appointment);
  router.post('/appointments/:id/cancel', validate({ params: IdParams, body: CancelBody }), me.cancel);
  router.post('/appointments/:id/reschedule', validate({ params: IdParams, body: RescheduleBody }), me.reschedule);
  router.get('/conversations', validate({ query: ConversationListQuery }), chat.mine);
  router.delete('/memory', me.forgetMe);

  // New email / phone, confirmed with a code (G10).
  router.post('/contact', limits.auth, validate({ body: ContactStartBody }), me.startContactChange);
  router.post('/contact/verify', limits.code, validate({ body: ContactVerifyBody }), me.verifyContactChange);

  return router;
}
