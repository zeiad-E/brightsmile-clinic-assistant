import { Router } from 'express';
import * as catalog from '../controllers/catalogController.js';
import * as availability from '../controllers/availabilityController.js';
import { validate } from '../middlewares/validate.js';
import { IdParams } from '../validators/common.js';
import { AvailabilityDayQuery, AvailabilityRangeQuery, ServiceKeyParams } from '../validators/catalog.js';

/** Public pages: no sign-in needed. */
export function publicRouter() {
  const router = Router();

  router.get('/clinic', catalog.clinic);
  router.get('/services', catalog.services);
  router.get('/services/:idOrSlug', validate({ params: ServiceKeyParams }), catalog.service);
  router.get('/doctors', catalog.doctors);
  router.get('/doctors/:id', validate({ params: IdParams }), catalog.doctor);
  router.get('/availability', validate({ query: AvailabilityDayQuery }), availability.day);
  router.get('/availability/range', validate({ query: AvailabilityRangeQuery }), availability.range);

  return router;
}
