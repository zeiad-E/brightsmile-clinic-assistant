import { cacheLife } from 'next/cache';
import { apiRequest } from './client.js';

/**
 * Public clinic data for server components, cached by Next.js so pages don't call the API on every
 * visit. 'use cache' remembers the result; cacheLife says for how long. On failure each function
 * returns an empty value and remembers it only briefly, so the page still renders and recovers soon.
 */

/** Name, phone, address, opening hours, booking rules. null if the API is unreachable. */
export async function getClinic() {
  'use cache';
  try {
    const clinic = await apiRequest('/clinic', { timeout: 8000 });
    cacheLife('hours');
    return clinic;
  } catch {
    cacheLife('minutes'); // try again soon instead of remembering the failure for hours
    return null;
  }
}

/** All active services (both languages, price, duration). [] if the API is unreachable. */
export async function getServices() {
  'use cache';
  try {
    const { data } = await apiRequest('/services', { timeout: 8000 });
    cacheLife('hours');
    return data;
  } catch {
    cacheLife('minutes');
    return [];
  }
}

/** All doctors with the services they do, sorted as the clinic lists them (by staff number). */
export async function getDoctors() {
  'use cache';
  try {
    const { data } = await apiRequest('/doctors', { timeout: 8000 });
    cacheLife('hours');
    return data.toSorted((a, b) => a.id.localeCompare(b.id));
  } catch {
    cacheLife('minutes');
    return [];
  }
}

/**
 * The earliest free appointment for a service in the next 7 days, across all its doctors:
 * { starts_at, staff_id } or null. Cached for about a minute: fresh enough for a "next free" label.
 */
export async function getNextFreeSlot(serviceId) {
  'use cache';
  cacheLife('minutes');
  if (!serviceId) return null;
  try {
    const { doctors } = await apiRequest(`/availability/range?service_id=${serviceId}&days=7`, { timeout: 8000 });
    let best = null;
    for (const doctor of doctors) {
      const first = doctor.days.flatMap((day) => day.slots)[0];
      if (first && (!best || first.starts_at < best.starts_at)) best = { starts_at: first.starts_at, staff_id: doctor.staff_id };
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * The earliest free time on each of the next days that have one, across all the service's doctors:
 * [{ starts_at, staff_id }, …] (at most `limit`). Cached for about a minute, like getNextFreeSlot.
 */
export async function getFreeTimes(serviceId, limit = 5) {
  'use cache';
  cacheLife('minutes');
  try {
    const { doctors } = await apiRequest(`/availability/range?service_id=${serviceId}&days=7`, { timeout: 8000 });
    const firstByDay = new Map(); // "2026-10-30" → the earliest slot that day
    for (const doctor of doctors) {
      for (const day of doctor.days) {
        const first = day.slots[0];
        const best = firstByDay.get(day.date);
        if (first && (!best || first.starts_at < best.starts_at)) firstByDay.set(day.date, { starts_at: first.starts_at, staff_id: doctor.staff_id });
      }
    }
    return [...firstByDay.values()].toSorted((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, limit);
  } catch {
    return [];
  }
}
