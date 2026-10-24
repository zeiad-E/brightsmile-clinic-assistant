import { z } from 'zod';
import { dayInZone } from '../utils/clinicTime.js';
import { Day, Uuid } from './common.js';

export const ServiceKeyParams = z.object({ idOrSlug: z.string().trim().min(1).max(80) });

export const AvailabilityDayQuery = z.object({
  service_id: Uuid,
  staff_id: Uuid,
  date: Day,
});

export const AvailabilityRangeQuery = z.object({
  service_id: Uuid,
  staff_id: Uuid.optional(),
  from: Day.default(() => dayInZone()),
  days: z.coerce.number().int().min(1).max(14).default(7),
});
