import { Router } from 'express';
import * as me from '../controllers/meController.js';
import * as chat from '../controllers/chatController.js';
import { ConversationListQuery } from '../validators/chat.js';
import { validate } from '../middlewares/validate.js';
import { requirePermission } from '../middlewares/requirePermission.js';
import { IdParams } from '../validators/common.js';
import { CancelBody, MyAppointmentsQuery, RescheduleBody } from '../validators/appointments.js';
import { ContactStartBody, ContactVerifyBody, UpdateMeBody } from '../validators/me.js';

/** /api/me — the signed-in patient's own profile and bookings. */
export function meRouter(limits) {
  const router = Router();
  const profile = requirePermission('self.profile');
  const bookings = requirePermission('self.appointments');
  const contact = requirePermission('self.contact');

  router.get('/', profile, me.profile);
  router.patch('/', profile, validate({ body: UpdateMeBody }), me.updateProfile);
  router.get('/appointments', bookings, validate({ query: MyAppointmentsQuery }), me.appointments);
  router.get('/appointments/:id', bookings, validate({ params: IdParams }), me.appointment);
  router.post('/appointments/:id/cancel', bookings, validate({ params: IdParams, body: CancelBody }), me.cancel);
  router.post('/appointments/:id/reschedule', bookings, validate({ params: IdParams, body: RescheduleBody }), me.reschedule);
  router.get('/conversations', requirePermission('self.conversations'), validate({ query: ConversationListQuery }), chat.mine);
  router.delete('/memory', requirePermission('self.memory'), me.forgetMe);

  // New email / phone, confirmed with a code (G10).
  router.post('/contact', contact, limits.auth, validate({ body: ContactStartBody }), me.startContactChange);
  router.post('/contact/verify', contact, limits.code, validate({ body: ContactVerifyBody }), me.verifyContactChange);

  return router;
}
